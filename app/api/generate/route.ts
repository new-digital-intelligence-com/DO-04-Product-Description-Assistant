import { loadSkill, buildPrompt } from '@/lib/skill';
import { generateCopy, MissingKeyError } from '@/lib/anthropic';
import { validate, gate } from '@/lib/validate';
import { readProducts, writeResult, appendProduct, skuExists, readCategoryOverlay, addCategoryOverlay } from '@/lib/store';
import type { Attributes, Finding, Product, Result, Step } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** One product, start to finish: gate, generate, check, retry once, save.
 *  Every stage emits a step so the client can render the work as it happens. */
async function runOne(
  p: Product,
  emit: (s: Step) => void,
  signal: AbortSignal,
): Promise<Result | null> {
  const base = await loadSkill();
  const overlay = await readCategoryOverlay();
  // A user-declared category is part of the schema for this run, so the gate has a real
  // required list to enforce instead of rejecting the category outright.
  const skill = { ...base, config: { ...base.config, categories: { ...base.config.categories, ...overlay } } };
  const id = p.sku;

  emit({ type: 'step', id: `${id}:gate`, label: `${id} · checking mandatory attributes`, state: 'running' });
  const held = gate(p.category, p.attributes, skill.config);
  if (held.length) {
    emit({ type: 'step', id: `${id}:gate`, label: `${id} · held back`, state: 'fail', detail: held.join('; ') });
    return null;
  }
  emit({ type: 'step', id: `${id}:gate`, label: `${id} · record complete`, state: 'done', detail: `${Object.keys(p.attributes).length} attributes` });

  // Say it out loud rather than letting a narrower run look like a full one.
  if (!(p.category in base.config.categories)) {
    emit({
      type: 'step', id: `${id}:offschema`,
      label: `${id} · "${p.category}" is not in the skill's own schema`,
      state: 'skip',
      detail: skill.config.keyword_plan[p.category]
        ? 'gated on the required list you declared'
        : 'gated on the required list you declared · no keyword plan for this category, so the copy is written without keyword targeting',
    });
  }

  let copy = null as Awaited<ReturnType<typeof generateCopy>> | null;
  let findings: Finding[] = [];
  let attempts = 0;
  let extra = '';

  for (attempts = 1; attempts <= 2; attempts++) {
    emit({
      type: 'step', id: `${id}:gen${attempts}`,
      label: attempts === 1 ? `${id} · writing description` : `${id} · rewriting to clear ${findings.length} finding(s)`,
      state: 'running',
    });
    copy = await generateCopy(skill.instructions, buildPrompt(skill, p.category, p.sku, p.attributes) + extra, (t) => emit({ type: 'token', text: t }), signal);
    emit({ type: 'step', id: `${id}:gen${attempts}`, label: `${id} · description written`, state: 'done', detail: `${copy.claims.length} claims mapped` });

    emit({ type: 'step', id: `${id}:qa${attempts}`, label: `${id} · running the five checks`, state: 'running' });
    findings = validate(copy, p.attributes, skill.config);
    if (!findings.length) {
      emit({ type: 'step', id: `${id}:qa${attempts}`, label: `${id} · passed all checks`, state: 'done' });
      break;
    }
    emit({
      type: 'step', id: `${id}:qa${attempts}`,
      label: `${id} · ${findings.length} finding(s)`,
      state: attempts === 2 ? 'fail' : 'skip',
      detail: findings.map((f) => `${f.check}: ${f.detail}`).join(' · '),
    });
    if (attempts === 2) break;
    // Fix the copy, never the check.
    extra = `\n\n## Your previous attempt failed validation\n${findings.map((f) => `- ${f.check}: ${f.detail}`).join('\n')}\n\nRewrite the description so none of these apply. Remove the offending claim rather than softening it. Return the JSON object only.`;
  }

  const result: Result = {
    sku: p.sku, category: p.category, attributes: p.attributes,
    copy: copy!, status: findings.length ? 'FAIL' : 'PASS', findings,
    source: p.source, generated_at: new Date().toISOString(), attempts,
  };
  emit({ type: 'step', id: `${id}:save`, label: `${id} · saved to the output folder`, state: 'done' });
  await writeResult(result);
  emit({ type: 'result', result });
  return result;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (s: Step) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(s)}\n\n`)); } catch { /* client gone */ }
      };
      const ac = new AbortController();
      req.signal.addEventListener('abort', () => ac.abort());

      let passed = 0, failed = 0;
      try {
        let queue: Product[] = [];

        if (body.product) {
          // A user's own product: validate the shape, then join it to the catalogue.
          const sku = String(body.product.sku ?? '').trim();
          const category = String(body.product.category ?? '').trim();
          const attributes = (body.product.attributes ?? {}) as Attributes;
          if (!sku) throw new Error('a SKU is required');
          if (!category) throw new Error('a category is required');
          if (await skuExists(sku)) throw new Error(`SKU "${sku}" is already in the catalogue — pick another`);

          // A category the skill does not know needs its own required list, declared by
          // whoever invented it. Persisted before the run so the gate — which reads the
          // schema from disk — sees it, and so the row is not held back on reload.
          const known = { ...(await loadSkill()).config.categories, ...(await readCategoryOverlay()) };
          if (!(category in known)) {
            const spec = body.product.schema ?? {};
            const req = Array.isArray(spec.required) ? spec.required.map(String).filter(Boolean) : [];
            const opt = Array.isArray(spec.optional) ? spec.optional.map(String).filter(Boolean) : [];
            if (!req.length) {
              throw new Error(
                `"${category}" is a new category, so mark at least one attribute required — ` +
                'a category with no required attributes has no gate, and an ungated record is exactly what this assistant refuses to write around.',
              );
            }
            await addCategoryOverlay(category, { required: req, optional: opt });
            emit({
              type: 'step', id: 'newcat',
              label: `New category "${category}" declared`, state: 'done',
              detail: `required: ${req.join(', ')} — saved to data/input/categories.json`,
            });
          }

          queue = [{ sku, category, attributes, source: 'user' }];
        } else {
          const all = await readProducts();
          const want: string[] | undefined = Array.isArray(body.skus) && body.skus.length ? body.skus : undefined;
          queue = want ? all.filter((p) => want.includes(p.sku)) : all;
        }

        emit({ type: 'step', id: 'load', label: `Loaded the DO-04 skill and ${queue.length} product(s)`, state: 'done' });

        for (const p of queue) {
          if (ac.signal.aborted) break;
          const r = await runOne(p, emit, ac.signal);
          if (!r) { failed++; continue; }
          r.status === 'PASS' ? passed++ : failed++;
          // Only a product that survived the checks joins the sample catalogue.
          if (body.product && r.status === 'PASS') {
            await appendProduct(p);
            emit({ type: 'step', id: `${p.sku}:append`, label: `${p.sku} · added to the sample catalogue`, state: 'done' });
          }
        }
        emit({ type: 'done', passed, failed });
      } catch (e: any) {
        emit({
          type: 'error',
          message: e instanceof MissingKeyError ? e.message : (e?.message ?? 'generation failed'),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
}
