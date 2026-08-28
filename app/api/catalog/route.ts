import { NextResponse } from 'next/server';
import { readProducts, readResults, updateProductAttributes, readCategoryOverlay } from '@/lib/store';
import { loadSkill } from '@/lib/skill';
import { gate } from '@/lib/validate';
import type { Attributes } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [products, results, skill, overlay] = await Promise.all([
      readProducts(), readResults(), loadSkill(), readCategoryOverlay(),
    ]);
    // The skill's schema plus any category the user declared. Merged here so the gate
    // judges a custom-category product by the list its author gave, not by nothing.
    const categories = { ...skill.config.categories, ...overlay };
    const cfg = { ...skill.config, categories };
    const withGate = products.map((p) => ({ ...p, held: gate(p.category, p.attributes, cfg) }));
    // Every column any product uses, so the editor can show a known-but-blank attribute
    // as a gap to fill rather than hiding it because this row happens to be empty.
    const columns = [...new Set(products.flatMap((p) => Object.keys(p.attributes)))].sort();
    return NextResponse.json({
      products: withGate,
      results,
      categories: Object.keys(categories),
      schema: categories,
      customCategories: Object.keys(overlay),
      columns,
      hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed to read catalogue' }, { status: 500 });
  }
}

/** Correct a product's record in data/input/products.csv. This is the only write path
 *  for source attributes: copy is never generated from an attribute the CSV lacks, so
 *  filling a gap has to change the record the checker reads, not just this request. */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const sku = String(body?.sku ?? '').trim();
    const patch = body?.attributes;
    if (!sku) return NextResponse.json({ error: 'sku is required' }, { status: 400 });
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return NextResponse.json({ error: 'attributes must be an object' }, { status: 400 });
    }

    const clean: Attributes = {};
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const key = k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (key && key !== 'sku' && key !== 'category' && key !== 'source') clean[key] = String(v ?? '');
    }

    const [product, skill, overlay] = await Promise.all([
      updateProductAttributes(sku, clean), loadSkill(), readCategoryOverlay(),
    ]);
    const cfg = { ...skill.config, categories: { ...skill.config.categories, ...overlay } };
    const held = gate(product.category, product.attributes, cfg);
    return NextResponse.json({ product: { ...product, held } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed to update the record' }, { status: 500 });
  }
}
