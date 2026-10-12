import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('node and network explorers delegate flagged filtering before backend row limits', () => {
  const service = source('server/service.mjs');
  assert.match(service, /graph\.overview\([^\n]+p\.get\('view'\) === 'flagged'/);
  for (const page of ['app/(console)/nodes/page.tsx', 'app/(console)/servers/page.tsx']) {
    const body = source(page);
    assert.match(body, /flaggedOnly \? '&view=flagged' : ''/);
    assert.doesNotMatch(body, /data\.(nodes|networks)\.filter\(/);
    assert.match(body, /data\.stats\.flagged(Nodes|Networks)/);
  }
});

test('overview KPI totals use full backend aggregation, not capped node rows', () => {
  const body = source('app/(console)/page.tsx');
  assert.match(body, /suspicious=d\.stats\.suspiciousPlugins/);
  assert.match(body, /playersOnline=d\.stats\.onlinePlayers/);
  assert.doesNotMatch(body, /d\.nodes\.reduce\(/);
});
