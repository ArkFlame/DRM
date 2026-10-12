import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const root = new URL('../src/', import.meta.url);
const source = name => readFileSync(new URL(name, root), 'utf8');
test('mobile explorer entries are flat rows inside a single section surface', () => {
  for (const name of ['app/(console)/page.tsx', 'app/(console)/nodes/page.tsx', 'app/(console)/servers/page.tsx']) {
    const page = source(name);
    assert.match(page, /className="md:hidden explorer-list"/);
    assert.match(page, /className="explorer-row"/);
    assert.doesNotMatch(page, /className="explorer-card"/);
  }
  const css = source('app/globals.css');
  assert.match(css, /\.explorer-row \+ \.explorer-row\s*\{border-top:/);
  assert.doesNotMatch(css, /\.explorer-card\s*\{/);
});
test('chart, health summary and navigation policy are not card-in-card surfaces', () => {
  const css = source('app/globals.css');
  const stat = css.match(/\.chart-stat\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.ok(stat);
  assert.doesNotMatch(stat, /background:|border-radius:/);
  const page = source('app/(console)/page.tsx');
  assert.match(page, /className="fleet-split"/);
  assert.doesNotMatch(page, /rounded-lg bg-\[#161f27\]/);
  const shell = source('components/shell.tsx');
  assert.match(shell, /className="border-t soft-line pt-4"/);
});
