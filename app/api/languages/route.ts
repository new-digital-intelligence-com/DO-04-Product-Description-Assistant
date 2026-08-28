import { NextResponse } from 'next/server';
import { listTargets, MissingDeeplKeyError } from '@/lib/deepl';

export const dynamic = 'force-dynamic';

/** The live DeepL target list, so the dropdown never offers a language this account
 *  cannot reach. No key configured is not an error — translation is optional. */
export async function GET() {
  try {
    return NextResponse.json({ languages: await listTargets() });
  } catch (e: any) {
    if (e instanceof MissingDeeplKeyError) return NextResponse.json({ languages: [], reason: e.message });
    return NextResponse.json({ languages: [], reason: e?.message ?? 'DeepL unavailable' });
  }
}
