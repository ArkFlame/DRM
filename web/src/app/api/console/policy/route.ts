import { boundedJson } from '@/lib/bounded-json.mjs';
import { NextRequest, NextResponse } from 'next/server';
import { authenticated, sameOrigin } from '@/lib/auth';
import { backend } from '@/lib/backend';
export async function POST(req: NextRequest) {
  if (!await authenticated()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  try {
    const v: unknown = await boundedJson(req);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return NextResponse.json({ error: 'invalid_policy' }, { status: 400 });
    const { scope, id, status, reason } = v as Record<string, unknown>;
    if (!['node','network'].includes(String(scope)) || typeof id !== 'string' || id.length > 128 ||
        !['NONE','ALLOW','BLOCK','REVIEW'].includes(String(status)) || typeof reason !== 'string' || reason.length > 500)
      return NextResponse.json({ error: 'invalid_policy' }, { status: 400 });
    await backend('/api/admin/v2/policy', { method: 'POST', body: { scope, id, status, reason } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: 'policy_update_failed' }, { status: 400 }); }
}
