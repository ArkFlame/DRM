import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const file = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
test('topbar refresh has one interactive surface, not mixed DaisyUI and custom borders', () => {
  const shell = file('components/shell.tsx');
  assert.match(shell, /aria-label="Refresh data"[\s\S]*?className="topbar-action"/);
  assert.match(shell, /topbar-online-dot/);
  assert.doesNotMatch(shell, /btn btn-ghost btn-sm border/);
  assert.doesNotMatch(shell, /glass-icon text-\[#ffb6a3\] font-bold">A/);
  const css = file('app/globals.css');
  const control = css.match(/\.topbar-action\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(control, /border:0/);
  assert.match(control, /background:transparent/);
});
test('top right account mark navigates and has one visual surface', () => {
  const shell = file('components/shell.tsx');
  assert.match(shell, /<Link href="\/settings"[^>]+className="topbar-account">A<\/Link>/);
  assert.match(shell, /topbar-divider/);
  const css = file('app/globals.css');
  assert.match(css, /\.topbar-account\s*\{[^}]*border:0/);
  assert.doesNotMatch(shell, /<span className="w-8 h-8[^>]*>A<\/span>/);
});
test('secondary actions and placeholders avoid nested decorative boxes', () => {
  assert.match(file('app/(console)/page.tsx'), /className="flat-action"/);
  assert.match(file('components/actions.tsx'), /className="flat-action"/);
  assert.doesNotMatch(file('components/ui.tsx'), /className="h-10 w-10 rounded-xl bg-\[#242c38\]/);
  assert.doesNotMatch(file('app/login/page.tsx'), /rounded-2xl bg-white\/\[\.07\] border border-white\/10/);
});
