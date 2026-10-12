import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, sameOrigin } from '@/lib/auth';
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
