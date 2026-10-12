import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePlugins, suspiciousReasons } from '../src/server/plugin-signals.mjs';

test('recognizes tokenized leak, cracked, nulled and pirated signals', () => {
  const files = ['Plugin-LEAK.jar', 'Plugin-LEAKED.jar', 'Plugin-CRACK.jar', 'Plugin-CRACKED.jar', 'Plugin-NULLED.jar', 'Plugin-PIRATED.jar'];
  assert.deepEqual(files.map(fileName => suspiciousReasons({ name: 'Plugin', version: '1', fileName }).length), [1,1,1,1,1,1]);
});

test('does not classify legitimate substring-only names', () => {
  const names = ['CrackShot', 'LeakCanary', 'NullEditor', 'UnlicensedTestFixture'];
  assert.deepEqual(names.map(name => suspiciousReasons({ name, version: '1' }).length), [0,0,0,0]);
});

test('matches DRM product names case-insensitively without changing source inventory', () => {
  const inputs = [{ name: 'FairPlay', version: '4.0', fileName: 'FairPlay.jar' }];
  assert.equal(summarizePlugins(inputs, ['fairplay'])[0].drm, true);
  assert.equal(inputs[0].drm, undefined);
});
