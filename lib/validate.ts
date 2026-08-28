import type { Attributes, Copy, Finding } from './types';
import type { SkillConfig } from './skill';

const NUM = /\b\d+(?:[.,]\d+)?\b/g;
const NOISE = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '100']);

const norm = (s: unknown) =>
  String(s ?? '').normalize('NFKD').toLowerCase().replace(/[''']/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

/** Canonical form of a figure: separators stripped, so 10.000 / 10,000 / 10000 are one
 *  number. Collapses 10.5 onto 105 — accepted, because this check exists to catch
 *  invented numbers and a false failure on every localised batch costs more. */
const canonNum = (n: string) => n.replace(/[.,]/g, '').replace(/^0+/, '') || '0';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay: string, word: string) => new RegExp(`\\b${escapeRe(norm(word))}\\b`).test(hay);

export function allText(c: Copy): string {
  return [c.title, c.meta_description, c.long_copy, ...(c.bullets ?? [])].join(' ');
}

/** The five checks, in descending order of how much damage they prevent. */
export function validate(copy: Copy, attrs: Attributes, cfg: SkillConfig, locale = 'en'): Finding[] {
  const out: Finding[] = [];
  const master = locale === 'en';
  // Regulated terms are language-specific. Checking German copy against the English list
  // passes everything, which looks like a clean result and is not one.
  const regulated = master ? cfg.regulated_terms : (cfg.regulated_terms_by_locale?.[locale] ?? {});
  const text = allText(copy);
  const hay = norm(text);

  // 0. Required fields
  if (!copy.title?.trim()) out.push({ check: 'empty_field', detail: 'title is empty' });
  if (!copy.long_copy?.trim()) out.push({ check: 'empty_field', detail: 'long_copy is empty' });
  if (!copy.meta_description?.trim()) out.push({ check: 'empty_field', detail: 'meta_description is empty' });
  if (!copy.bullets?.length) out.push({ check: 'empty_field', detail: 'no bullets' });

  // 1. Regulated claims — a term used without the attribute that backs it
  for (const [term, backing] of Object.entries(regulated)) {
    if (hasWord(hay, term) && !backing.some((b) => b in attrs)) {
      out.push({
        check: 'regulated_claim',
        detail: `copy says "${term}" but the record carries none of: ${backing.join(', ')}`,
      });
    }
  }

  // 2. Claim traceability
  const claims = copy.claims ?? [];
  if (!claims.length) {
    out.push({ check: 'claims_missing', detail: 'no claims map — copy cannot be traced back to the record' });
  }
  for (const c of claims) {
    if (!c || typeof c !== 'object') { out.push({ check: 'claim_malformed', detail: JSON.stringify(c) }); continue; }
    if (!(c.attribute in attrs)) {
      out.push({ check: 'claim_unbacked', detail: `claim "${c.text}" cites attribute "${c.attribute}" which the record does not have` });
    } else if (c.value != null && !norm(attrs[c.attribute]).includes(norm(c.value)) && !norm(c.value).includes(norm(attrs[c.attribute]))) {
      out.push({ check: 'claim_value_mismatch', detail: `claim "${c.text}" says ${c.attribute}="${c.value}", record says "${attrs[c.attribute]}"` });
    }
    // 3. Orphan claim — the map declares something the copy does not actually say.
    //    Master locale only: claim text is not translated, so on a locale variant the
    //    map is English against translated copy and every claim would read as orphaned.
    if (master && c?.text && !hay.includes(norm(c.text))) {
      out.push({ check: 'orphan_claim', detail: `claims map declares "${c.text}" but the copy does not say it` });
    }
  }

  // 4. Ungrounded figures
  const recordDigits = new Set(
    (Object.values(attrs).join(' ').match(NUM) ?? []).map(canonNum)
  );
  for (const n of new Set(norm(text).match(NUM) ?? [])) {
    if (NOISE.has(n) || recordDigits.has(canonNum(n))) continue;
    out.push({ check: 'ungrounded_figure', detail: `the figure "${n}" appears in the copy but in no source attribute` });
  }

  // 5. Length — held back, never truncated
  const L = cfg.limits;
  if (copy.title && copy.title.length > L.title) out.push({ check: 'over_length', detail: `title is ${copy.title.length} chars, limit ${L.title}` });
  if (copy.meta_description && copy.meta_description.length > L.meta_description) out.push({ check: 'over_length', detail: `meta_description is ${copy.meta_description.length} chars, limit ${L.meta_description}` });
  if (copy.long_copy && copy.long_copy.length > L.long_copy) out.push({ check: 'over_length', detail: `long_copy is ${copy.long_copy.length} chars, limit ${L.long_copy}` });
  (copy.bullets ?? []).forEach((b, i) => {
    if (b.length > L.bullet) out.push({ check: 'over_length', detail: `bullet ${i + 1} is ${b.length} chars, limit ${L.bullet}` });
  });
  if ((copy.bullets ?? []).length > L.bullets_count) {
    out.push({ check: 'over_length', detail: `${copy.bullets.length} bullets, limit ${L.bullets_count}` });
  }

  // 6. Banned words — the supplied list is English, so it only applies to the master.
  if (master) for (const w of cfg.banned_words) {
    if (hasWord(hay, w)) out.push({ check: 'banned_word', detail: `copy contains banned term "${w}"` });
  }

  return out;
}

/** The gate: a record missing a mandatory attribute is never written around. */
/** Which checks could not run in this locale, so the UI never presents a translated
 *  batch as fully checked when half the checks were silently skipped. */
export function checksOff(cfg: SkillConfig, locale: string): string[] {
  if (locale === 'en') return [];
  const off: string[] = ['banned_word (English list only)', 'orphan_claim (master locale only)'];
  if (!cfg.regulated_terms_by_locale?.[locale]) off.unshift('regulated_claim (no term list for this language)');
  return off;
}

export function gate(category: string, attrs: Attributes, cfg: SkillConfig): string[] {
  const spec = cfg.categories[category];
  if (!spec) return [`unknown category "${category}" — not in the skill's category schema`];
  const blank = (v: string) => !v || !v.trim() || ['n/a', 'na', 'null', 'none', '-', 'tbd'].includes(v.trim().toLowerCase());
  return spec.required.filter((k) => !(k in attrs) || blank(attrs[k])).map((k) => `missing required attribute: ${k}`);
}
