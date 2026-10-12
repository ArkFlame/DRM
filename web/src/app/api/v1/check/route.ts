import { NextRequest, NextResponse } from 'next/server';
import { drmService } from '@/server/service.mjs';
import { clientIp, readJson } from '@/server/http.mjs';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const ip = clientIp(req, process.env.DRM_TRUST_PROXY === 'true');
  if (!ip) return NextResponse.json({ error: 'invalid_transport_address' }, { status: 400 });
  const parsed = await readJson(req, 4096);
  if (parsed.status) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  try {
    const result = await drmService().reportV1(parsed.data, ip);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) { console.error('v1 ingest:', error); return NextResponse.json({ error: 'server_error' }, { status: 500 }); }
}
