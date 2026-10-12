import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
export const sessionTtlSeconds = 8 * 3600;
export function equalSecret(a, b) {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}
function sign(stamp, secret) { return createHmac('sha256', secret).update(stamp).digest('hex'); }
export function makeCookie(secret, epoch = Math.floor(Date.now()/1000)) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('Missing session signing secret');
  const expiry = String(epoch + sessionTtlSeconds);
  return `${expiry}.${sign(expiry,secret)}`;
}
export function verifyCookie(cookie, secret, epoch = Math.floor(Date.now()/1000)) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof cookie !== 'string') return false;
  const [stamp, signature, extra] = cookie.split('.');
  if (extra || !stamp || !/^[0-9]{10,11}$/.test(stamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expiry = Number(stamp);
  return expiry > epoch && expiry <= epoch + sessionTtlSeconds && equalSecret(signature,sign(stamp,secret));
}
