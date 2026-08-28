import { loadSkill } from '@/lib/skill';
import { translateCopy, MissingDeeplKeyError } from '@/lib/deepl';
import { validate, checksOff } from '@/lib/validate';
import { readResult, writeLocale } from '@/lib/store';
import type { LocaleVariant, Step } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Translate an existing English result into one target language, then re-check it.
 *  Re-checking matters: text expansion routinely pushes a translated title over a
 *  channel's limit, and only a per-locale length check catches that. */
export async function POST(req: Request) {
  const { sku, target } = await req.json().catch(() => ({}));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (s: Step) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(s)}\n\n`)); } catch { /* client gone */ }
      };
      try {
        if (!sku || !target) throw new Error('sku and target language are required');
        const skill = await loadSkill();
        const loc = String(target).toLowerCase();

        emit({ type: 'step', id: `${sku}:src`, label: `${sku} · loading the English master`, state: 'running' });
        const master = await readResult(sku);
        if (!master) throw new Error(`${sku} has no English description yet — generate that first`);
        if (master.status !== 'PASS') throw new Error(`${sku} did not pass QA in English. Fix the master before translating it.`);
        emit({ type: 'step', id: `${sku}:src`, label: `${sku} · English master loaded`, state: 'done' });

        emit({ type: 'step', id: `${sku}:tr`, label: `${sku} · translating to ${target.toUpperCase()} via DeepL`, state: 'running', detail: 'field by field, claims map left in English' });
        const copy = await translateCopy(master.copy, loc);
        emit({ type: 'step', id: `${sku}:tr`, label: `${sku} · translated`, state: 'done', detail: copy.title });

        emit({ type: 'step', id: `${sku}:qa`, label: `${sku} · re-checking in ${target.toUpperCase()}`, state: 'running' });
        const findings = validate(copy, master.attributes, skill.config, loc);
        const off = checksOff(skill.config, loc);
        emit({
          type: 'step', id: `${sku}:qa`,
          label: findings.length ? `${sku} · ${findings.length} finding(s) in ${target.toUpperCase()}` : `${sku} · passed the checks that apply`,
          state: findings.length ? 'fail' : 'done',
          detail: [findings.map((f) => `${f.check}: ${f.detail}`).join(' · '), off.length ? `not checked: ${off.join(', ')}` : ''].filter(Boolean).join(' — '),
        });

        const variant: LocaleVariant = {
          locale: loc,
          copy,
          status: findings.length ? 'FAIL' : 'PASS',
          findings,
          checks_off: off,
          translated_from: 'en',
          review_status: 'machine-translated, pending native review',
          generated_at: new Date().toISOString(),
        };
        // The variant goes inside the product's own file, beside its master and its
        // siblings — one product, one record, whatever it has been translated into.
        const result = await writeLocale(sku, variant);
        emit({
          type: 'step', id: `${sku}:save`,
          label: `${sku} · ${loc.toUpperCase()} saved into ${sku}.json`, state: 'done',
          detail: `${Object.keys(result.locales ?? {}).length} language(s) now in this record`,
        });
        emit({ type: 'result', result, locale: loc });
        emit({ type: 'done', passed: findings.length ? 0 : 1, failed: findings.length ? 1 : 0 });
      } catch (e: any) {
        emit({ type: 'error', message: e instanceof MissingDeeplKeyError ? e.message : (e?.message ?? 'translation failed') });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform' },
  });
}
