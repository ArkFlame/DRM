import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { equalSecret, makeCookie, verifyCookie } from './session-crypto.mjs';
export const COOKIE_NAME = 'arkflame_drm_auth';
function secret() { const v=process.env.DRM_WEB_SESSION_SECRET; if(!v || v.length<32) throw Error('DRM_WEB_SESSION_SECRET must have >=32 characters'); return v; }
export function validPassword(password: unknown) { const expected=process.env.DRM_WEB_PASSWORD; return typeof password==='string' && password.length<=1024 && !!expected && expected.length>=20 && equalSecret(password,expected); }
export function createSession() { return makeCookie(secret()); }
export async function authenticated() { const value=(await cookies()).get(COOKIE_NAME)?.value || ''; return verifyCookie(value, secret()); }
export async function requireAuth() { if (!await authenticated()) redirect('/login'); }
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const configured = process.env.DRM_PUBLIC_ORIGIN;
  if (!origin || !configured) return false;
  try { return new URL(origin).origin === new URL(configured).origin; }
  catch { return false; }
}
