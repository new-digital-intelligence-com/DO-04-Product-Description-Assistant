import type { Copy } from './types';

const API = () => `${process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1/messages`;
const DEFAULT_MODEL = 'claude-sonnet-4-5';

export class MissingKeyError extends Error {}

/** One streamed call to the Messages API. `onToken` fires with each text delta so the
 *  UI can show the description being written rather than a spinner. */
export async function generateCopy(
  system: string,
  prompt: string,
  onToken: (t: string) => void,
  signal?: AbortSignal,
): Promise<Copy> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new MissingKeyError('ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key.');

  const res = await fetch(API(), {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 1500,
      stream: true,
      system,
      messages: [
        { role: 'user', content: prompt },
        // Prefill: forces the reply to open as JSON, so there is no prose to strip.
        { role: 'assistant', content: '{' },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = '{', buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt: any;
      try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        raw += evt.delta.text;
        onToken(evt.delta.text);
      }
      if (evt.type === 'error') throw new Error(evt.error?.message ?? 'stream error');
    }
  }

  return parseCopy(raw);
}

/** The model returns JSON. Trailing prose is tolerated by cutting at the last brace. */
export function parseCopy(raw: string): Copy {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('model returned no JSON object');
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return {
    title: String(parsed.title ?? ''),
    bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String) : [],
    long_copy: String(parsed.long_copy ?? ''),
    meta_description: String(parsed.meta_description ?? ''),
    keywords_used: Array.isArray(parsed.keywords_used) ? parsed.keywords_used.map(String) : [],
    claims: Array.isArray(parsed.claims)
      ? parsed.claims.map((c: any) => ({ text: String(c?.text ?? ''), attribute: String(c?.attribute ?? ''), value: String(c?.value ?? '') }))
      : [],
  };
}
