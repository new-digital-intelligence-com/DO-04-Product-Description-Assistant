import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Product, Result, Attributes, LocaleVariant } from './types';

const BASE_INPUT = path.join(process.cwd(), 'data', 'input', 'products.csv');
const BASE_CATEGORIES = path.join(process.cwd(), 'data', 'input', 'categories.json');
const BASE_OUTPUT = path.join(process.cwd(), 'data', 'output');

const TMP_DIR = path.join(os.tmpdir(), 'do04-data');
const TMP_INPUT = path.join(TMP_DIR, 'input', 'products.csv');
const TMP_CATEGORIES = path.join(TMP_DIR, 'input', 'categories.json');
const TMP_OUTPUT = path.join(TMP_DIR, 'output');

async function safeReadFile(primaryPath: string, fallbackPath?: string): Promise<string> {
  try {
    return await readFile(primaryPath, 'utf8');
  } catch (err: any) {
    if (fallbackPath) {
      return await readFile(fallbackPath, 'utf8');
    }
    throw err;
  }
}

async function safeWriteFile(primaryPath: string, fallbackPath: string, content: string): Promise<void> {
  try {
    await mkdir(path.dirname(primaryPath), { recursive: true });
    await writeFile(primaryPath, content, 'utf8');
  } catch {
    // If writing to project dir fails (e.g. read-only filesystem on Vercel), write to /tmp
    await mkdir(path.dirname(fallbackPath), { recursive: true });
    await writeFile(fallbackPath, content, 'utf8');
  }
}

/** Minimal RFC-4180 CSV parser — quoted fields, doubled quotes, embedded commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export async function readProducts(): Promise<Product[]> {
  let raw = '';
  try {
    raw = await safeReadFile(TMP_INPUT, BASE_INPUT);
  } catch {
    return [];
  }
  const rows = parseCsv(raw);
  const header = rows[0];
  if (!header) return [];
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (r[i] ?? '').trim(); });
    const attributes: Attributes = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k !== 'sku' && k !== 'category' && k !== 'source' && v) attributes[k] = v;
    }
    return {
      sku: rec.sku, category: rec.category, attributes,
      source: rec.source === 'user' ? 'user' : 'sample',
    } as Product;
  });
}

/** Append a user's product to the sample catalogue so successful tests join the set. */
export async function appendProduct(p: Product): Promise<void> {
  let raw = '';
  try {
    raw = await safeReadFile(TMP_INPUT, BASE_INPUT);
  } catch {
    raw = 'sku,category,source\n';
  }
  const rows = parseCsv(raw);
  const header = rows[0] || ['sku', 'category', 'source'];
  const extras = Object.keys(p.attributes).filter((k) => !header.includes(k));
  const newHeader = [...header, ...extras];

  const line = (rec: Record<string, string>) =>
    newHeader.map((h) => quote(rec[h] ?? '')).join(',');

  const existing = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ''; });
    return line(rec);
  });
  const added = line({ sku: p.sku, category: p.category, source: 'user', ...p.attributes });
  await safeWriteFile(BASE_INPUT, TMP_INPUT, [newHeader.join(','), ...existing, added].join('\n') + '\n');
}

/** Rewrite one product's attributes in place. The CSV is the record of what is known
 *  about a product, so filling a gap here is a correction to the record — not a
 *  per-run override that would let generated copy cite a fact the record never gained.
 *  A key not already a column becomes one; a blank value clears the cell, because an
 *  empty attribute is the absence of a fact rather than a fact that is empty. */
export async function updateProductAttributes(sku: string, patch: Attributes): Promise<Product> {
  const raw = await safeReadFile(TMP_INPUT, BASE_INPUT);
  const rows = parseCsv(raw);
  const header = rows[0];
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ''; });
    return rec;
  });

  const target = records.find((r) => r.sku.toLowerCase() === sku.toLowerCase());
  if (!target) throw new Error(`no product with SKU ${sku} in the input folder`);

  const extras = Object.keys(patch).filter((k) => !header.includes(k));
  const newHeader = [...header, ...extras];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'sku' || k === 'category' || k === 'source') continue;
    target[k] = v.trim();
  }

  const lines = records.map((rec) => newHeader.map((h) => quote(rec[h] ?? '')).join(','));
  await safeWriteFile(BASE_INPUT, TMP_INPUT, [newHeader.join(','), ...lines].join('\n') + '\n');

  const attributes: Attributes = {};
  for (const [k, v] of Object.entries(target)) {
    if (k !== 'sku' && k !== 'category' && k !== 'source' && v) attributes[k] = v;
  }
  return {
    sku: target.sku, category: target.category, attributes,
    source: target.source === 'user' ? 'user' : 'sample',
  };
}

export type CategorySpec = { required: string[]; optional: string[] };

/** Categories the user invented, kept beside the products rather than inside the skill.
 *  They have to persist: the gate reads the category schema on every catalogue load, so
 *  a custom category that vanished after the run would leave its own product held back
 *  for a category that "does not exist" the moment the page reloaded. The skill's own
 *  config stays untouched — a client's schema is not ours to rewrite from a test form. */
export async function readCategoryOverlay(): Promise<Record<string, CategorySpec>> {
  try {
    const raw = JSON.parse(await safeReadFile(TMP_CATEGORIES, BASE_CATEGORIES));
    const out: Record<string, CategorySpec> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const spec = v as Partial<CategorySpec>;
      out[k] = {
        required: Array.isArray(spec?.required) ? spec.required.map(String) : [],
        optional: Array.isArray(spec?.optional) ? spec.optional.map(String) : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function addCategoryOverlay(name: string, spec: CategorySpec): Promise<void> {
  const all = await readCategoryOverlay();
  all[name] = { required: [...new Set(spec.required)], optional: [...new Set(spec.optional)] };
  await safeWriteFile(BASE_CATEGORIES, TMP_CATEGORIES, JSON.stringify(all, null, 2) + '\n');
}

/** One product, one file: <sku>.json holds the English master and every locale variant
 *  under `locales`. */
export function resultFile(sku: string): string {
  return `${sku}.json`;
}

const samePath = (a: Result['copy'], b: Result['copy']) =>
  a?.title === b?.title && a?.long_copy === b?.long_copy &&
  a?.meta_description === b?.meta_description &&
  JSON.stringify(a?.bullets ?? []) === JSON.stringify(b?.bullets ?? []);

/** Write the English master, carrying any existing translations across. A regenerated
 *  master leaves them describing copy that no longer exists, so each is marked stale
 *  rather than quietly presented as current. */
export async function writeResult(r: Result): Promise<void> {
  const prev = await readResult(r.sku);
  // Union, not either-or: a caller holding a Result it read before a translation landed
  // would otherwise delete that translation just by saving the master again.
  const union = { ...(prev?.locales ?? {}), ...(r.locales ?? {}) };
  let locales: Record<string, LocaleVariant> | undefined =
    Object.keys(union).length ? union : undefined;
  if (locales && prev && !samePath(prev.copy, r.copy)) {
    locales = Object.fromEntries(
      Object.entries(locales).map(([k, v]) => [k, { ...v, stale: true }]),
    );
  }
  const next: Result = { ...r, ...(locales && Object.keys(locales).length ? { locales } : {}) };
  await safeWriteFile(
    path.join(BASE_OUTPUT, resultFile(r.sku)),
    path.join(TMP_OUTPUT, resultFile(r.sku)),
    JSON.stringify(next, null, 2),
  );
}

/** Add or replace one locale variant inside its product's file. */
export async function writeLocale(sku: string, variant: LocaleVariant): Promise<Result> {
  const master = await readResult(sku);
  if (!master) throw new Error(`${sku} has no English description to attach a translation to`);
  const next: Result = {
    ...master,
    locales: { ...(master.locales ?? {}), [variant.locale]: variant },
  };
  await safeWriteFile(
    path.join(BASE_OUTPUT, resultFile(sku)),
    path.join(TMP_OUTPUT, resultFile(sku)),
    JSON.stringify(next, null, 2),
  );
  return next;
}

export async function readResult(sku: string): Promise<Result | null> {
  try {
    return JSON.parse(await safeReadFile(path.join(TMP_OUTPUT, resultFile(sku)), path.join(BASE_OUTPUT, resultFile(sku))));
  } catch {
    return null;
  }
}

/** Fold a pre-split <sku>.<locale>.json written by an earlier version into its master,
 *  then remove it. Done on read so an existing output folder is not left half in one
 *  layout and half in the other; the variant itself is preserved, only relocated. */
async function migrateSplitFile(file: string, baseDir: string, byKey: Map<string, Result>): Promise<void> {
  const [sku, locale] = file.replace(/\.json$/, '').split('.');
  const master = byKey.get(sku);
  if (!master || !locale) return;
  let old: any;
  try { old = JSON.parse(await readFile(path.join(baseDir, file), 'utf8')); } catch { return; }
  if (!old?.copy) return;
  master.locales = {
    ...(master.locales ?? {}),
    [locale]: {
      locale,
      copy: old.copy,
      status: old.status ?? 'FAIL',
      findings: old.findings ?? [],
      checks_off: old.checks_off ?? [],
      translated_from: old.translated_from ?? 'en',
      review_status: old.review_status ?? 'machine-translated, pending native review',
      generated_at: old.generated_at ?? new Date().toISOString(),
      ...(old.stale ? { stale: true } : {}),
    },
  };
  await safeWriteFile(
    path.join(BASE_OUTPUT, resultFile(sku)),
    path.join(TMP_OUTPUT, resultFile(sku)),
    JSON.stringify(master, null, 2),
  );
  await unlink(path.join(baseDir, file)).catch(() => { /* leave it if it cannot be removed */ });
}

export async function readResults(): Promise<Result[]> {
  const byKey = new Map<string, Result>();

  const loadFromDir = async (dirPath: string) => {
    let files: string[] = [];
    try {
      files = (await readdir(dirPath)).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    const masters = files.filter((f) => f.split('.').length === 2);
    const split = files.filter((f) => f.split('.').length > 2);

    for (const f of masters) {
      try {
        const r = JSON.parse(await readFile(path.join(dirPath, f), 'utf8')) as Result;
        if (r?.sku) byKey.set(r.sku, r);
      } catch { /* skip unreadable */ }
    }
    for (const f of split) await migrateSplitFile(f, dirPath, byKey);
  };

  await loadFromDir(BASE_OUTPUT);
  await loadFromDir(TMP_OUTPUT);

  return [...byKey.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

export async function skuExists(sku: string): Promise<boolean> {
  return (await readProducts()).some((p) => p.sku.toLowerCase() === sku.toLowerCase());
}
