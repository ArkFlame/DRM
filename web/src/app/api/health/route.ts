import { NextResponse } from 'next/server';
import { drmService } from '@/server/service.mjs';
export const runtime = 'nodejs';
export async function GET() {
  try { await drmService().query('/api/admin/config'); return NextResponse.json({ ok: true, mode: 'advisory', protocol: [1, 2] }); }
  catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}
