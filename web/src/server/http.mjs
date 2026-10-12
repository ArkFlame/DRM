import { isIP } from 'node:net';

export function clientIp(request, trustProxy = false) {
  const direct = request.headers.get('x-real-ip') || '';
  // x-real-ip must be set by a trusted reverse proxy that strips incoming headers.
  const forwarded = trustProxy ? direct : '';
  return isIP(forwarded) ? forwarded : '';
}

export async function readJson(request, max) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > max) return { status: 413, error: 'payload_too_large' };
  const ct = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|\s*$)/i.test(ct)) return { status: 415, error: 'json_required' };
  const reader = request.body?.getReader();
  if (!reader) return { status: 400, error: 'empty_body' };
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); return { status: 413, error: 'payload_too_large' }; }
      chunks.push(value);
    }
    // Reject malformed UTF-8 instead of silently storing replacement characters.
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size));
    return { data: JSON.parse(raw) };
  } catch { return { status: 400, error: 'invalid_json' }; }
}
