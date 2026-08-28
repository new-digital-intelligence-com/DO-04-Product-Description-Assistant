'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result, Step } from '@/lib/types';
import styles from './page.module.css';

type Held = { held: string[] };
type Prod = { sku: string; category: string; attributes: Record<string, string>; source: 'sample' | 'user' } & Held;
type Catalog = {
  products: Prod[]; results: Result[]; categories: string[];
  schema: Record<string, { required: string[]; optional: string[] }>;
  columns: string[]; customCategories?: string[]; hasKey: boolean;
};
type LogStep = { id: string; label: string; state: string; detail?: string };

export default function Page() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [steps, setSteps] = useState<LogStep[]>([]);
  const [stream, setStream] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openProd, setOpenProd] = useState<string | null>(null);
  const [langs, setLangs] = useState<{ code: string; name: string }[]>([]);
  const [langReason, setLangReason] = useState<string | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [lang, setLang] = useState<Record<string, string>>({});
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/catalog', { cache: 'no-store' });
    const j = await r.json();
    if (j.error) setError(j.error); else setCat(j);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/languages', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { setLangs(j.languages ?? []); setLangReason(j.reason ?? null); })
      .catch(() => setLangReason('could not reach the language list'));
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [steps, stream]);

  /** Read the SSE stream and fold each event into the step list. */
  const run = useCallback(async (body: unknown, endpoint = '/api/generate') => {
    setBusy(true); setError(null); setSteps([]); setStream('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.body) throw new Error('no stream from the server');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let e: Step;
          try { e = JSON.parse(line.slice(5)); } catch { continue; }
          if (e.type === 'step') {
            setSteps((s) => {
              const i = s.findIndex((x) => x.id === e.id);
              const next = { id: e.id, label: e.label, state: e.state, detail: e.detail };
              return i >= 0 ? [...s.slice(0, i), next, ...s.slice(i + 1)] : [...s, next];
            });
            if (e.state !== 'running') setStream('');
          } else if (e.type === 'token') {
            setStream((t) => (t + e.text).slice(-600));
          } else if (e.type === 'result') {
            setOpen(e.result.sku);
            // A translation arrives as the whole product record, so showing the language
            // that was just produced is a matter of selecting it, not of adding a card.
            if (e.locale) setLang((l) => ({ ...l, [e.result.sku]: e.locale! }));
            setCat((c) => c && ({
              ...c,
              results: [...c.results.filter((r) => r.sku !== e.result.sku), e.result]
                .sort((a, b) => a.sku.localeCompare(b.sku)),
            }));
          } else if (e.type === 'error') {
            setError(e.message);
          }
        }
      }
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'request failed');
    } finally {
      setBusy(false); setStream('');
    }
  }, [load]);

  if (error && !cat) return <main className={styles.wrap}><p className={styles.error}>{error}</p></main>;
  if (!cat) return <main className={styles.wrap}><p className={styles.muted}>Loading…</p></main>;

  const ready = cat.products.filter((p) => !p.held.length);
  const heldBack = cat.products.filter((p) => p.held.length);
  const done = new Set(cat.results.map((r) => r.sku));
  // The bulk action covers only what the output folder does not already hold. Rewriting a
  // description that passed is a paid call that replaces a reviewed result with a
  // different one, so it is a deliberate act, not the default button.
  const pending = ready.filter((p) => !done.has(p.sku));
  const passed = cat.results.filter((r) => r.status === 'PASS').length;
  const variantCount = cat.results.reduce((n, r) => n + Object.keys(r.locales ?? {}).length, 0);

  return (
    <main className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1>DO-04 · Product Description Assistant</h1>
          <p className={styles.muted}>
            Raw attributes in, grounded descriptions out. Every claim traces to a source attribute.
          </p>
        </div>
        <div className={styles.stats}>
          <b>{ready.length}</b> ready · <b>{heldBack.length}</b> held ·{' '}
          <b>{cat.results.length}</b> generated · <b>{passed}</b> passed QA ·{' '}
          <b>{variantCount}</b> translation(s)
        </div>
      </header>

      {!cat.hasKey && (
        <p className={styles.warn}>
          No <code>ANTHROPIC_API_KEY</code> found. Copy <code>.env.example</code> to{' '}
          <code>.env.local</code>, add your key, and restart. Nothing will generate until you do.
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.cols}>
        <section className={styles.panel}>
          <h2>Input folder <span className={styles.muted}>data/input/products.csv</span></h2>
          <div className={styles.list}>
            {cat.products.map((p) => (
              <div key={p.sku}>
                <div className={styles.row}>
                  <div className={styles.rowLeft} onClick={() => setOpenProd(openProd === p.sku ? null : p.sku)}>
                    <span className={styles.caret}>{openProd === p.sku ? '▾' : '▸'}</span>
                    <span className={styles.sku}>{p.sku}</span>
                    <span className={styles.chip}>{p.category || '—'}</span>
                    {p.source === 'user' && <span className={styles.chip}>yours</span>}
                    <span className={styles.muted}>
                      {Object.keys(p.attributes).length} attributes
                      {p.held.length ? ` · ${p.held.length} missing` : ''}
                    </span>
                  </div>
                  <div className={styles.rowRight}>
                    {p.held.length
                      ? <span className={styles.hold} title={p.held.join('; ')}>held</span>
                      : done.has(p.sku)
                        ? <span className={styles.pass}>written</span>
                        : <span className={styles.muted}>ready</span>}
                    <button disabled={busy || !!p.held.length} onClick={() => run({ skus: [p.sku] })}>Generate</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.actions}>
            <button
              className="primary"
              disabled={busy || !pending.length}
              onClick={() => run({ skus: pending.map((p) => p.sku) })}
            >
              {busy
                ? 'Working…'
                : pending.length
                  ? `Generate ${pending.length} not yet written`
                  : 'Nothing left to generate'}
            </button>
            {!busy && !pending.length && ready.length > 0 && (
              <span className={styles.muted}>
                all {ready.length} ready product(s) are already in the output folder
              </span>
            )}
            {ready.length > pending.length && (
              <button
                disabled={busy}
                title="Rewrites descriptions that already exist, replacing them"
                onClick={() => run({ skus: ready.map((p) => p.sku) })}
              >
                Regenerate all {ready.length}
              </button>
            )}
          </div>
          {heldBack.length > 0 && (
            <div className={styles.heldBox}>
              <b>{heldBack.length} held back and never written:</b>
              <ul>{heldBack.map((p) => (
                <li key={p.sku}>
                  <span className={styles.sku}>{p.sku}</span> — {p.held.join('; ')}{' '}
                  <button className={styles.linkBtn} onClick={() => setOpenProd(p.sku)}>fix</button>
                </li>
              ))}</ul>
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <h2>Activity</h2>
          <div className={styles.log} ref={logRef}>
            {steps.length === 0 && !busy && <p className={styles.muted}>Nothing running. Press Generate.</p>}
            {steps.map((s) => (
              <div key={s.id} className={styles.step}>
                <span className={styles[`dot_${s.state}`] ?? styles.dot_done} />
                <div>
                  <div>{s.label}</div>
                  {s.detail && <div className={styles.stepDetail}>{s.detail}</div>}
                </div>
              </div>
            ))}
            {stream && <pre className={styles.stream}>{stream}</pre>}
          </div>
        </section>
      </div>

      {openProd && (() => {
        const p = cat.products.find((x) => x.sku === openProd);
        if (!p) return null;
        return (
          <RecordEditor
            product={p}
            spec={cat.schema[p.category]}
            columns={cat.columns ?? []}
            busy={busy}
            onClose={() => setOpenProd(null)}
            onSaved={load}
            onGenerate={() => { setOpenProd(null); run({ skus: [p.sku] }); }}
          />
        );
      })()}

      <AddProduct
        schema={cat.schema}
        categories={cat.categories}
        customCategories={cat.customCategories ?? []}
        busy={busy}
        onRun={run}
      />

      <section className={styles.panel}>
        <h2>Output folder <span className={styles.muted}>data/output/</span></h2>
        {cat.results.length === 0 && <p className={styles.muted}>Empty. Generated descriptions land here.</p>}
        {langReason && <p className={styles.muted}>Translation off: {langReason}</p>}
        {cat.results.map((r) => {
          const variants = r.locales ?? {};
          const codes = Object.keys(variants).sort();
          const active = lang[r.sku] ?? 'en';
          const v = active === 'en' ? null : variants[active];
          // One card per product. The language buttons switch which view of the same
          // record is shown; there is never a second card for a translation.
          const view = v
            ? { copy: v.copy, status: v.status, findings: v.findings, checksOff: v.checks_off, stale: v.stale, when: v.generated_at }
            : { copy: r.copy, status: r.status, findings: r.findings, checksOff: [] as string[], stale: false, when: r.generated_at };
          const nameOf = (code: string) => langs.find((l) => l.code.toLowerCase() === code.toLowerCase())?.name ?? code.toUpperCase();
          return (
          <article key={r.sku} className={styles.result}>
            <div className={styles.resultHead} onClick={() => setOpen(open === r.sku ? null : r.sku)}>
              <span className={styles.sku}>{r.sku}</span>
              <span className={styles.chip}>{r.category}</span>
              {r.source === 'user' && <span className={styles.chip}>yours</span>}
              <span className={r.status === 'PASS' ? styles.pass : styles.fail}>EN {r.status}</span>
              {r.attempts > 1 && <span className={styles.chip}>rewritten {r.attempts - 1}×</span>}
              {codes.length > 0 && (
                <span className={styles.chip}>
                  +{codes.length} language{codes.length > 1 ? 's' : ''}: {codes.map((c) => c.toUpperCase()).join(' ')}
                </span>
              )}
              {codes.some((c) => variants[c].stale) && <span className={styles.hold}>stale translation(s)</span>}
              <span className={styles.grow} />
              {r.status === 'PASS' && (
                <span className={styles.translate} onClick={(ev) => ev.stopPropagation()}>
                  <select
                    value={target[r.sku] ?? ''}
                    disabled={busy || !langs.length}
                    onChange={(e) => setTarget((t) => ({ ...t, [r.sku]: e.target.value }))}
                  >
                    <option value="">add a language…</option>
                    {langs.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}{codes.includes(l.code.toLowerCase()) ? ' · redo' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || !target[r.sku]}
                    onClick={() => run({ sku: r.sku, target: target[r.sku] }, '/api/translate')}
                  >Go</button>
                </span>
              )}
              <span className={styles.muted}>{open === r.sku ? 'hide' : 'show'}</span>
            </div>

            {open === r.sku && (
              <>
                <div className={styles.langBar}>
                  <span className={styles.muted}>language</span>
                  <button
                    className={active === 'en' ? styles.langOn : styles.langOff}
                    onClick={() => setLang((l) => ({ ...l, [r.sku]: 'en' }))}
                  >
                    EN <span className={styles.muted}>master</span>
                  </button>
                  {codes.map((c) => (
                    <button
                      key={c}
                      className={active === c ? styles.langOn : styles.langOff}
                      title={nameOf(c)}
                      onClick={() => setLang((l) => ({ ...l, [r.sku]: c }))}
                    >
                      {c.toUpperCase()}
                      <span className={variants[c].status === 'PASS' ? styles.pass : styles.fail}>
                        {' '}{variants[c].status}
                      </span>
                      {variants[c].stale && <span className={styles.hold}> stale</span>}
                    </button>
                  ))}
                  {codes.length === 0 && (
                    <span className={styles.muted}>
                      only English so far — add a language above and it lands in this same record
                    </span>
                  )}
                </div>

                <div className={styles.resultBody}>
                  <div>
                    <h3>Source record</h3>
                    <table className={styles.attrs}><tbody>
                      {Object.entries(r.attributes).map(([k, val]) => (
                        <tr key={k}><td>{k}</td><td>{val}</td></tr>
                      ))}
                    </tbody></table>
                  </div>
                  <div dir={active === 'ar' || active === 'he' ? 'rtl' : undefined}>
                    <h3>
                      {v ? `${nameOf(active)} · machine-translated` : 'Generated copy'}{' '}
                      <span className={view.status === 'PASS' ? styles.pass : styles.fail}>QA {view.status}</span>
                    </h3>
                    {v && (
                      <p className={styles.hold}>
                        {v.review_status}
                        {v.stale && ' — the English master has been rewritten since; retranslate before using this'}
                      </p>
                    )}
                    <p className={styles.title}>{view.copy.title}</p>
                    <ul>{view.copy.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                    <p>{view.copy.long_copy}</p>
                    <p className={styles.meta}><b>meta</b> {view.copy.meta_description}</p>
                    <p className={styles.claims}>
                      <b>Claims traced:</b>{' '}
                      {view.copy.claims.map((c, i) => (
                        <span key={i}>{c.text} → <code>{c.attribute}</code>{i < view.copy.claims.length - 1 ? ' · ' : ''}</span>
                      ))}
                      {v && <span className={styles.muted}> (claims stay in English — they point at the record, and a record has no language)</span>}
                    </p>
                    {view.findings.length > 0 && (
                      <div className={styles.findings}>
                        {view.findings.map((f, i) => <div key={i}><b>{f.check}</b> — {f.detail}</div>)}
                      </div>
                    )}
                    {view.checksOff.length > 0 && (
                      <div className={styles.offBox}>
                        <b>Not checked in this language:</b> {view.checksOff.join(' · ')}. A pass here
                        is narrower than a pass in English — do not report it as fully checked.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </article>
          );
        })}
      </section>
    </main>
  );
}

/** The full record for one product, full screen: what the schema asks for, what the CSV
 *  holds, and what is missing — in one grid wide enough to read every column at once.
 *  A required attribute left blank still holds the product back; this fills the gap in
 *  the record rather than waiving the gate, because copy may only cite what the record
 *  actually says. */
function RecordEditor({
  product, spec, columns, busy, onClose, onSaved, onGenerate,
}: {
  product: Prod;
  spec?: { required: string[]; optional: string[] };
  columns: string[];
  busy: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onGenerate: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(product.attributes);
  const [extra, setExtra] = useState<{ key: string; value: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [onlyGaps, setOnlyGaps] = useState(false);

  useEffect(() => { setDraft(product.attributes); setSaved(false); }, [product]);

  // Esc closes, and the page behind must not scroll under an overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const required = spec?.required ?? [];
  const optional = spec?.optional ?? [];
  // Every attribute worth showing: the schema's, plus any column another product in the
  // catalogue uses, plus anything this record already carries off-schema.
  const known = [...new Set([...required, ...optional, ...columns, ...Object.keys(product.attributes)])];
  const rest = known.filter((k) => !required.includes(k) && !optional.includes(k));

  const blank = (v?: string) =>
    !v || !v.trim() || ['n/a', 'na', 'null', 'none', '-', 'tbd'].includes(v.trim().toLowerCase());
  const stillMissing = required.filter((k) => blank(draft[k]));
  const filled = known.filter((k) => !blank(draft[k])).length;
  const dirty =
    known.some((k) => (draft[k] ?? '') !== (product.attributes[k] ?? '')) ||
    extra.some((r) => r.key.trim() && r.value.trim());

  const set = (k: string, v: string) => { setDraft((d) => ({ ...d, [k]: v })); setSaved(false); };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const attributes: Record<string, string> = {};
      for (const k of known) if ((draft[k] ?? '') !== (product.attributes[k] ?? '')) attributes[k] = draft[k] ?? '';
      for (const { key, value } of extra) if (key.trim() && value.trim()) attributes[key] = value;
      const res = await fetch('/api/catalog', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku: product.sku, attributes }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setExtra([]);
      setSaved(true);
      await onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'could not save');
    } finally {
      setSaving(false);
    }
  };

  const field = (k: string, kind: 'required' | 'optional' | 'other') => {
    const isBlank = blank(draft[k]);
    const missing = kind === 'required' && isBlank;
    if (onlyGaps && !isBlank) return null;
    return (
      <label key={k} className={missing ? styles.fieldMissing : undefined}>
        <span>
          {k}
          {kind === 'required' && <span className={styles.req} title="required by the category schema"> *</span>}
          {missing && <span className={styles.missingTag}> missing</span>}
        </span>
        <input
          value={draft[k] ?? ''}
          placeholder={kind === 'required' ? 'required — the gate blocks this product' : 'blank — stays out of the copy'}
          onChange={(e) => set(k, e.target.value)}
        />
      </label>
    );
  };

  const group = (title: string, note: string, keys: string[], kind: 'required' | 'optional' | 'other') => {
    const rendered = keys.map((k) => field(k, kind)).filter(Boolean);
    if (!rendered.length) return null;
    return (
      <>
        <h4>{title} <span className={styles.muted}>{note}</span></h4>
        <div className={styles.form}>{rendered}</div>
      </>
    );
  };

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={`Source record for ${product.sku}`}>
        <header className={styles.sheetHead}>
          <div>
            <h2>
              <span className={styles.sku}>{product.sku}</span>
              <span className={styles.chip}>{product.category || '—'}</span>
              {product.source === 'user' && <span className={styles.chip}>yours</span>}
              {stillMissing.length
                ? <span className={styles.hold}>{stillMissing.length} required attribute(s) missing</span>
                : <span className={styles.pass}>record complete</span>}
            </h2>
            <p className={styles.muted}>
              {filled} of {known.length} attributes filled. Editing here rewrites the row in{' '}
              <code>data/input/products.csv</code> — the record the checker reads, so a claim
              can only be grounded once the fact is really there.
            </p>
          </div>
          <div className={styles.sheetHeadRight}>
            <label className={styles.toggle}>
              <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />
              only blanks
            </label>
            <button onClick={onClose} title="Esc">close</button>
          </div>
        </header>

        <div className={styles.sheetBody}>
          {group('Required', 'the gate', required, 'required')}
          {group('Optional', 'blank means the subject stays out of the copy', optional, 'optional')}
          {group('Other columns', 'used elsewhere in the catalogue', rest, 'other')}

          {extra.length > 0 && <h4>New attributes</h4>}
          {extra.map((row, i) => (
            <div key={i} className={styles.customRow}>
              <input
                placeholder="new attribute name, e.g. insulation_fill"
                value={row.key}
                onChange={(e) => setExtra((c) => c.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
              />
              <input
                placeholder="value"
                value={row.value}
                onChange={(e) => setExtra((c) => c.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
              />
              <button onClick={() => setExtra((c) => c.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
          {err && <p className={styles.error}>{err}</p>}
        </div>

        <footer className={styles.sheetFoot}>
          <button onClick={() => setExtra((c) => [...c, { key: '', value: '' }])}>+ Add attribute</button>
          <span className={styles.grow} />
          {stillMissing.length > 0 && (
            <span className={styles.hold}>still missing: {stillMissing.join(', ')}</span>
          )}
          {saved && <span className={styles.pass}>record updated</span>}
          {saved && !stillMissing.length && !product.held.length && (
            <button disabled={busy} onClick={onGenerate}>Generate now</button>
          )}
          <button className="primary" disabled={saving || !dirty} onClick={save}>
            {saving ? 'Saving…' : 'Save to record'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function AddProduct({
  schema, categories, customCategories, busy, onRun,
}: {
  schema: Catalog['schema']; categories: string[]; customCategories: string[];
  busy: boolean; onRun: (b: unknown) => void;
}) {
  const CUSTOM = '__custom__';
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState(categories[0] ?? '');
  const [newCat, setNewCat] = useState('');
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<{ key: string; value: string; required: boolean }[]>([]);

  const isNew = category === CUSTOM;
  // A category name is a PIM key, so it is normalised the same way an attribute is —
  // "Bike Helmets" and "bike_helmets" must not become two categories.
  const catKey = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const effectiveCat = isNew ? catKey(newCat) : category;
  const spec = isNew ? undefined : schema[category];
  const collides = isNew && Boolean(effectiveCat) && effectiveCat in schema;

  const set = (k: string, v: string) => setAttrs((a) => ({ ...a, [k]: v }));

  const attrKey = (k: string) => k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const declaredRequired = custom.filter((c) => c.required && attrKey(c.key)).map((c) => attrKey(c.key));
  const declaredOptional = custom.filter((c) => !c.required && attrKey(c.key)).map((c) => attrKey(c.key));

  const missing = isNew
    ? custom.filter((c) => c.required && attrKey(c.key) && !c.value.trim()).map((c) => attrKey(c.key))
    : (spec?.required ?? []).filter((k) => !attrs[k]?.trim());

  const setCustomAt = (i: number, patch: Partial<{ key: string; value: string; required: boolean }>) =>
    setCustom((c) => c.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  /** Schema fields plus whatever the user invented, keys normalised to the snake_case
   *  the PIM uses. Anything blank is dropped: an empty attribute is not a fact. */
  const collect = () => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) if (v.trim()) out[k] = v.trim();
    for (const { key, value } of custom) {
      const k = attrKey(key);
      if (k && value.trim()) out[k] = value.trim();
    }
    return out;
  };

  const blocked =
    busy || !sku.trim() || !effectiveCat || collides ||
    (isNew && !declaredRequired.length);

  return (
    <section className={styles.panel}>
      <h2>Test it on your own product</h2>
      <p className={styles.muted}>
        Fill in the attributes. Required fields are the gate — leave one blank and the
        assistant refuses to write, which is the behaviour worth seeing. A product that
        passes QA joins the catalogue above.
      </p>
      <div className={styles.form}>
        <label>SKU<input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="FW-2001" /></label>
        <label>Category
          <select value={category} onChange={(e) => { setCategory(e.target.value); setAttrs({}); }}>
            {categories.map((c) => (
              <option key={c} value={c}>{c}{customCategories.includes(c) ? ' (yours)' : ''}</option>
            ))}
            <option value={CUSTOM}>+ new category…</option>
          </select>
        </label>
        {isNew && (
          <label>New category name
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="bike helmet" />
          </label>
        )}
      </div>

      {isNew && (
        <div className={styles.newCatBox}>
          <b>A new category needs its own required list.</b> The skill's schema does not
          know <code>{effectiveCat || '…'}</code>, and a category with no required
          attributes has no gate — which is the one thing this assistant will not do.
          Add the attributes below and tick the ones a product of this kind must always
          have. It is saved to <code>data/input/categories.json</code>, so the skill's own
          config is left alone.
          {collides && (
            <p className={styles.error} style={{ marginTop: 8 }}>
              <code>{effectiveCat}</code> already exists — pick it from the dropdown instead.
            </p>
          )}
          {!collides && Boolean(effectiveCat) && (
            <p className={styles.muted} style={{ marginTop: 6 }}>
              No keyword plan exists for this category, so the copy is written without
              keyword targeting and the run says so.
            </p>
          )}
        </div>
      )}

      {spec && (
        <>
          <h3>Required</h3>
          <div className={styles.form}>
            {spec.required.map((k) => (
              <label key={k}>{k}
                <input value={attrs[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              </label>
            ))}
          </div>
          <h3>Optional <span className={styles.muted}>anything you leave blank stays out of the copy</span></h3>
          <div className={styles.form}>
            {[...spec.optional, 'membrane', 'waterproof_rating', 'certification'].map((k) => (
              <label key={k}>{k}
                <input value={attrs[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              </label>
            ))}
          </div>
        </>
      )}

      <h3>
        {isNew ? 'Attributes for this category' : 'Your own attributes'}{' '}
        <span className={styles.muted}>
          {isNew
            ? 'tick "required" for the ones the gate must enforce'
            : 'anything the schema does not list — the assistant may ground a claim in any of these'}
        </span>
      </h3>
      {custom.map((row, i) => (
        <div key={i} className={isNew ? styles.customRowReq : styles.customRow}>
          <input placeholder="attribute name, e.g. insulation_fill" value={row.key} onChange={(e) => setCustomAt(i, { key: e.target.value })} />
          <input placeholder="value, e.g. 700-fill down" value={row.value} onChange={(e) => setCustomAt(i, { value: e.target.value })} />
          {isNew && (
            <label className={styles.toggle}>
              <input type="checkbox" checked={row.required} onChange={(e) => setCustomAt(i, { required: e.target.checked })} />
              required
            </label>
          )}
          <button onClick={() => setCustom((c) => c.filter((_, j) => j !== i))}>remove</button>
        </div>
      ))}
      <div className={styles.actions}>
        <button onClick={() => setCustom((c) => [...c, { key: '', value: '', required: isNew }])}>+ Add attribute</button>
      </div>

      <div className={styles.actions}>
        <button
          className="primary"
          disabled={blocked}
          onClick={() => onRun({
            product: {
              sku: sku.trim(),
              category: effectiveCat,
              attributes: collect(),
              ...(isNew ? { schema: { required: declaredRequired, optional: declaredOptional } } : {}),
            },
          })}
        >
          {busy ? 'Working…' : 'Generate description'}
        </button>
        {isNew && !declaredRequired.length && (
          <span className={styles.hold}>tick at least one attribute as required — no gate, no run</span>
        )}
        {missing.length > 0 && (
          <span className={styles.muted}>
            {missing.length} required field(s) blank — it will be held back, on purpose.
          </span>
        )}
      </div>
    </section>
  );
}
