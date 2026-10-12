import { boundedJson } from '@/lib/bounded-json.mjs';
import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, createSession, sameOrigin, validPassword } from '@/lib/auth';
import { secureCookieForRequest } from '@/lib/auth-validation.mjs';
const attempts = new Map<string, { count: number; since: number }>();
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  const ip = `ip:${req.headers.get('x-real-ip') || 'unknown'}`; // trusted only behind configured reverse proxy
  const now = Date.now(), global = attempts.get('global');
  const shared = !global || now - global.since > 60000 ? { count:0, since:now } : global;
  attempts.set('global', shared);
  if (++shared.count > 60) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const prev = attempts.get(ip);
  const value = !prev || now - prev.since > 60000 ? { count: 0, since: now } : prev;
  attempts.set(ip, value);
  if (attempts.size > 10000) attempts.clear();
  if (++value.count > 8) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  let input: unknown;
  try { input = await boundedJson(req); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }); }
  const password = input && typeof input === 'object' && 'password' in input ? input.password : undefined;
  if (!validPassword(password)) return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  attempts.delete(ip);
  const response = NextResponse.json({ ok: true });
  const secureOverride = process.env.DRM_SECURE_COOKIE;
  response.cookies.set(COOKIE_NAME, createSession(), { httpOnly: true, sameSite: 'strict', secure: secureCookieForRequest(req, process.env.NODE_ENV === 'production', process.env.DRM_TRUST_PROXY === 'true', secureOverride === undefined ? undefined : secureOverride === 'true'), path: '/', maxAge: 8 * 3600 });
  return response;
}
