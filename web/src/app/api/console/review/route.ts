import { boundedJson } from '@/lib/bounded-json.mjs';
import { NextRequest, NextResponse } from 'next/server';
import { authenticated, sameOrigin } from '@/lib/auth';
import { backend } from '@/lib/backend';
export async function POST(req: NextRequest) {
  if (!await authenticated()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  try {
    const v = await boundedJson(req) as Record<string, unknown>;
    if (!v || typeof v.productId !== 'string' || typeof v.installationId !== 'string' ||
        !['NONE','ALLOW','BLOCK','REVIEW'].includes(String(v.status)) || typeof v.reason !== 'string' || v.reason.length > 500)
      return NextResponse.json({ error: 'invalid_review' }, { status: 400 });
    await backend('/api/admin/review', { method: 'POST', body: v });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: 'review_failed' }, { status: 400 }); }
}
