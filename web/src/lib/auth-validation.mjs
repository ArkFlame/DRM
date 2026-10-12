import { equalSecret } from './session-crypto.mjs';

// A configured password must be accepted exactly as written, including short
// legacy values and special characters. Password strength is a configuration
// concern, not a reason to reject the administrator's correct credential.
export function matchesConfiguredPassword(candidate, expected) {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 1024
    && typeof expected === 'string' && expected.length > 0 && expected.length <= 1024
    && equalSecret(candidate, expected);
}

// Compare Origin against either the explicitly configured public origin or the
// effective public Host at the trusted ingress. Never trust X-Forwarded-Host;
// only accept X-Forwarded-Proto when the deployment explicitly trusts its proxy.
export function allowedRequestOrigin(req, configuredOrigin, trustProxy = false) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || origin !== parsed.origin) return false;
    if (configuredOrigin && parsed.origin === new URL(configuredOrigin).origin) return true;
    const host = req.headers.get('host');
    if (!host || /[\s/@]/.test(host)) return false;
    const proxyProtocol = trustProxy ? req.headers.get('x-forwarded-proto') : null;
    const protocol = proxyProtocol || new URL(req.url).protocol.replace(':', '');
    if (protocol !== 'http' && protocol !== 'https') return false;
    return parsed.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

// Secure cookies must match the browser-facing scheme, which may be provided
// by a trusted TLS-terminating proxy rather than the app's internal URL.
export function secureCookieForRequest(req, production, trustProxy = false, override) {
  if (override !== undefined) return override;
  let protocol = new URL(req.url).protocol;
  if (trustProxy) protocol = (req.headers.get('x-forwarded-proto') || protocol).split(',', 1)[0].trim() + ':';
  return production && protocol === 'https:';
}
