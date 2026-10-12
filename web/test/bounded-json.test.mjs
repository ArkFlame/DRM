import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedJson } from '../src/lib/bounded-json.mjs';
test('decodes valid small JSON payload', async()=>assert.deepEqual(await boundedJson(new Request('http://localhost',{method:'POST',body:JSON.stringify({key:1})})),{key:1}));
test('rejects oversized fixed-length JSON', async()=>await assert.rejects(boundedJson(new Request('http://localhost',{method:'POST',body:'x'.repeat(5000)})),/payload_too_large/));
test('rejects malformed JSON input', async()=>await assert.rejects(boundedJson(new Request('http://localhost',{method:'POST',body:'{' })),SyntaxError));

test('telemetry rejects malformed UTF-8 rather than silently replacing invalid bytes', async () => {
  const { readJson } = await import('../src/server/http.mjs');
  const body = Uint8Array.from([123, 34, 120, 34, 58, 34, 195, 40, 34, 125]);
  const req = new Request('https://drm.arkflame.com/api/v2/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body
  });
  assert.deepEqual(await readJson(req, 1024), { status: 400, error: 'invalid_json' });
});
