import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/server/installations.mjs';
import { validateEvent } from '../src/server/network.mjs';

const installationId = '123e4567-e89b-42d3-a456-426614174000';
const uuid = '123e4567-e89b-42d3-a456-426614174001';
const v1 = productId => ({protocolVersion:1,productId,installationId,productVersion:'1',serverVersion:'Spigot',javaVersion:'8',distributionNonce:''});
const v2 = productId => ({protocolVersion:2,event:'product_heartbeat',eventId:uuid,sessionId:uuid,nodeId:uuid,installationId,productId,sequence:1,productVersion:'1',serverVersion:'Spigot',sentAt:new Date().toISOString(),active:true});

test('Bukkit descriptor names preserve exact case in v1 and v2', () => {
  for (const name of ['FairPlay', 'AuthMePremium', 'SMP.Lifesteal', 'X', 'my-plugin', 'plugin_name']) {
    assert.equal(validate(v1(name)) && validateEvent(v2(name)), true, name);
  }
});
test('reject malformed or oversized Bukkit descriptor names', () => {
  for (const name of ['', '_name', 'With Spaces', '/etc/passwd', 'a'.repeat(65), 'line\nfeed']) {
    assert.equal(validate(v1(name)) || validateEvent(v2(name)), false, name);
  }
});
