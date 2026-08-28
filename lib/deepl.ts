import type { Copy } from './types';

const API = () => process.env.DEEPL_API_URL
  ?? (process.env.DEEPL_API_KEY?.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');

export class MissingDeeplKeyError extends Error {}

function key(): string {
  const k = process.env.DEEPL_API_KEY;
  if (!k) throw new MissingDeeplKeyError('DEEPL_API_KEY is not set. Add it to .env.local and restart.');
  return k;
}

async function call(path: string, init?: RequestInit) {
  // DeepL rejects a GET that declares a JSON content-type with no body, so the header
  // is set only when there is something to send.
  const headers: Record<string, string> = { Authorization: `DeepL-Auth-Key ${key()}` };
  if (init?.body) headers['content-type'] = 'application/json';
  const res = await fetch(`${API()}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

export type Language = { code: string; name: string };

/** The live target list from DeepL, so the dropdown never offers a language the
 *  account cannot actually reach. */
export async function listTargets(): Promise<Language[]> {
  const raw = (await call('/v2/languages?type=target')) as { language: string; name: string }[];
  return raw
    .filter((l) => !l.language.toUpperCase().startsWith('EN'))
    .map((l) => ({ code: l.language, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Translate field by field, never as one blob: joining the fields and splitting the
 *  result back is where locale pipelines lose their structure.
 *  The claims map is NOT translated — traceability points at the product record, and a
 *  record has no language. A claim label translated in isolation also comes back worded
 *  differently from the same claim inside a translated sentence, which would orphan
 *  every claim on every locale. */
export async function translateCopy(copy: Copy, target: string): Promise<Copy> {
  const fields = ['title', 'meta_description', 'long_copy'] as const;
  const batch = [...fields.map((f) => copy[f] ?? ''), ...(copy.bullets ?? [])];

  const out = (await call('/v2/translate', {
    method: 'POST',
    body: JSON.stringify({ text: batch, target_lang: target.toUpperCase(), source_lang: 'EN' }),
  })) as { translations: { text: string }[] };

  const t = out.translations.map((x) => x.text);
  return {
    ...copy,
    title: t[0], meta_description: t[1], long_copy: t[2],
    bullets: t.slice(3),
    claims: copy.claims,
  };
}

export async function usage(): Promise<{ character_count: number; character_limit: number }> {
  return call('/v2/usage');
}
