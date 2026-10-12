import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesConfiguredPassword, allowedRequestOrigin, secureCookieForRequest } from '../src/lib/auth-validation.mjs';

test('exact configured short password authenticates', () => {
  assert.equal(matchesConfiguredPassword('mypassword', 'mypassword'), true);
  assert.equal(matchesConfiguredPassword('mypassword', 'Mypassword'), false);
});
test('special characters and whitespace in configured passwords are significant', () => {
  assert.equal(matchesConfiguredPassword(' my $ecret# & pass ', ' my $ecret# & pass '), true);
  assert.equal(matchesConfiguredPassword('my $ecret# & pass', ' my $ecret# & pass '), false);
});
test('unset, empty and excessively long passwords are rejected', () => {
  assert.equal(matchesConfiguredPassword('', ''), false);
  assert.equal(matchesConfiguredPassword('x', undefined), false);
  assert.equal(matchesConfiguredPassword('a'.repeat(1025), 'a'.repeat(1025)), false);
});
const request = (origin, host='drm.arkflame.com', proxyProto='https') =>
  new Request('http://127.0.0.1:3000/api/auth/login', {method:'POST', headers:{origin, host, 'x-forwarded-proto':proxyProto}});
test('configured production hostname accepts its own Origin', () => {
  assert.equal(allowedRequestOrigin(request('https://drm.arkflame.com'), 'https://drm.arkflame.com'), true);
});
test('alternate actual HTTPS hostname accepted through trusted reverse proxy', () => {
  assert.equal(allowedRequestOrigin(request('https://my-drm.example', 'my-drm.example'), 'https://drm.arkflame.com', true), true);
  assert.equal(allowedRequestOrigin(request('https://my-drm.example', 'my-drm.example'), 'https://drm.arkflame.com', false), false);
});
test('cross-origin and untrusted spoofed forward host rejected', () => {
  assert.equal(allowedRequestOrigin(request('https://attacker.example'), 'https://drm.arkflame.com', true), false);
  assert.equal(allowedRequestOrigin(request('https://my-drm.example', 'other.example'), 'https://drm.arkflame.com', true), false);
});
test('localhost direct origin supported, missing and malformed origins rejected', () => {
  assert.equal(allowedRequestOrigin(new Request('http://localhost:3000/api/auth/login', {method:'POST',headers:{origin:'http://localhost:3000',host:'localhost:3000'}}), 'https://drm.arkflame.com'), true);
  assert.equal(allowedRequestOrigin(request('https://drm.arkflame.com/path'), 'https://drm.arkflame.com'), false);
  assert.equal(allowedRequestOrigin(new Request('https://drm.arkflame.com/api/auth/login'), 'https://drm.arkflame.com'), false);
});
test('secure cookie follows production browser-facing scheme and explicit override', () => {
  const directHttp = new Request('http://drm.example/login');
  const directHttps = new Request('https://drm.example/login');
  const proxiedHttps = new Request('http://127.0.0.1/login', {headers:{'x-forwarded-proto':'https'}});
  const proxiedHttp = new Request('http://127.0.0.1/login', {headers:{'x-forwarded-proto':'http'}});
  assert.equal(secureCookieForRequest(directHttp, true), false);
  assert.equal(secureCookieForRequest(directHttps, true), true);
  assert.equal(secureCookieForRequest(proxiedHttps, true, true), true);
  assert.equal(secureCookieForRequest(proxiedHttp, true, true), false);
  assert.equal(secureCookieForRequest(proxiedHttps, true, false), false);
  assert.equal(secureCookieForRequest(directHttp, true, false, true), true);
  assert.equal(secureCookieForRequest(directHttps, true, false, false), false);
  assert.equal(secureCookieForRequest(directHttps, false), false);
});
