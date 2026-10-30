import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, fillVariables } from '../server/widgets/api.js';

const settings = { timezone: 'UTC', location: { name: 'San Francisco', lat: 37.77, lon: -122.42 } };

test('variables fill from settings, encoded in URLs', () => {
  const r = buildRequest({ url: 'https://x.test/aq?lat={lat}&lon={lon}&q={city}' }, settings);
  assert.equal(r.url, 'https://x.test/aq?lat=37.77&lon=-122.42&q=San%20Francisco');
  assert.equal(fillVariables('{"city": "{city}"}', settings), '{"city": "San Francisco"}');
});

test('auth styles', () => {
  assert.equal(buildRequest({ url: 'https://x.test', auth: 'bearer', authToken: 'abc' }, settings).headers.Authorization, 'Bearer abc');
  assert.equal(buildRequest({ url: 'https://x.test', auth: 'header', authHeader: 'X-Key', authToken: 'abc' }, settings).headers['X-Key'], 'abc');
  assert.equal(buildRequest({ url: 'https://x.test/a', auth: 'query', authParam: 'key', authToken: 'a b' }, settings).url, 'https://x.test/a?key=a+b');
  assert.equal(buildRequest({ url: 'https://x.test', auth: 'basic', authUser: 'me', authToken: 'pw' }, settings).headers.Authorization, `Basic ${Buffer.from('me:pw').toString('base64')}`);
});

test('POST bodies get a content type; bad URLs are explained', () => {
  const r = buildRequest({ url: 'https://x.test', method: 'POST', body: '{"q": 1}' }, settings);
  assert.equal(r.method, 'POST');
  assert.equal(r.headers['Content-Type'], 'application/json');
  assert.throws(() => buildRequest({ url: 'not a url' }, settings), /doesn’t look right/);
  assert.throws(() => buildRequest({ url: 'file:///etc/passwd' }, settings), /Only http and https/);
});
