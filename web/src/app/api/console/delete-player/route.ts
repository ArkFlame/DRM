import { boundedJson } from '@/lib/bounded-json.mjs';
import { NextRequest, NextResponse } from 'next/server';
import { authenticated, sameOrigin } from '@/lib/auth';
import { backend } from '@/lib/backend';
export async function POST(req: NextRequest) {
  if (!await authenticated()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  try {
    const value = await boundedJson(req) as { uuid?: unknown };
    if (typeof value?.uuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.uuid)) return NextResponse.json({ error: 'invalid_uuid' }, { status: 400 });
    await backend('/api/admin/v2/delete-player', { method: 'POST', body: { uuid: value.uuid } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: 'delete_failed' }, { status: 400 }); }
}
