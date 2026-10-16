// 1.54 links: the address rules, the framing verdict from a page's headers, the public-host guard on every
// redirect hop, and the probe cache. No network: fetch and DNS are stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import {isPublicAddress, judgeFrameable, probeTarget, probeFrameable, createFrameProbe} from '../links.mjs';

const ORIGIN = 'https://pocket.example.net';
const headers = o => ({ get: k => o[k.toLowerCase()] ?? null });

test('links: only public unicast addresses are fetched', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:93.184.216.34']) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'not-an-ip'])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('172.32.0.1'), true, 'just outside 172.16/12');
});

test('links: an address a click may check', () => {
  assert.equal(probeTarget('https://github.com/bbesner/pocket-code').href, 'https://github.com/bbesner/pocket-code');
  assert.equal(probeTarget('http://example.com/x?y=1').href, 'http://example.com/x?y=1');
  for (const bad of ['', 'ftp://x.example/', 'javascript:alert(1)', 'https://user:pw@example.com/', '/relative', 'file:///etc/passwd', 'https://']) assert.equal(probeTarget(bad), null, JSON.stringify(bad));
});

test('links: X-Frame-Options and frame-ancestors decide the verdict', () => {
  assert.equal(judgeFrameable(headers({}), ORIGIN, 'https://x.example'), null, 'nothing said: try the frame');
  assert.equal(judgeFrameable(headers({ 'x-frame-options': 'DENY' }), ORIGIN, 'https://x.example'), false);
  assert.equal(judgeFrameable(headers({ 'x-frame-options': 'sameorigin' }), ORIGIN, 'https://x.example'), false);
  assert.equal(judgeFrameable(headers({ 'x-frame-options': 'SAMEORIGIN' }), ORIGIN, ORIGIN), true, 'sameorigin and the page is ours');
  assert.equal(judgeFrameable(headers({ 'x-frame-options': 'DENY, SAMEORIGIN' }), ORIGIN, ORIGIN), false, 'the first value counts');
  assert.equal(judgeFrameable(headers({ 'x-frame-options': 'ALLOW-FROM https://other.example' }), ORIGIN, 'https://x.example'), null, 'an obsolete value browsers ignore');
  const csp = v => headers({ 'content-security-policy': v });
  assert.equal(judgeFrameable(csp("default-src 'self'; frame-ancestors 'none'"), ORIGIN, 'https://x.example'), false);
  assert.equal(judgeFrameable(csp("frame-ancestors 'self'"), ORIGIN, 'https://x.example'), false, "'self' is the page's origin, not ours");
  assert.equal(judgeFrameable(csp("frame-ancestors 'self' https://pocket.example.net"), ORIGIN, 'https://x.example'), true);
  assert.equal(judgeFrameable(csp('frame-ancestors pocket.example.net'), ORIGIN, 'https://x.example'), true, 'a bare host');
  assert.equal(judgeFrameable(csp('frame-ancestors https://*.example.net'), ORIGIN, 'https://x.example'), true, 'a wildcard subdomain');
  assert.equal(judgeFrameable(csp('frame-ancestors https://*.other.net'), ORIGIN, 'https://x.example'), false);
  assert.equal(judgeFrameable(csp('frame-ancestors https:'), ORIGIN, 'https://x.example'), true, 'a scheme source');
  assert.equal(judgeFrameable(csp('frame-ancestors http:'), ORIGIN, 'https://x.example'), false);
  assert.equal(judgeFrameable(csp('frame-ancestors *'), ORIGIN, 'https://x.example'), true);
  assert.equal(judgeFrameable(csp('frame-ancestors https://pocket.example.net:8443'), ORIGIN, 'https://x.example'), false, 'another port');
  assert.equal(judgeFrameable(csp('frame-ancestors https://pocket.example.net:443'), ORIGIN, 'https://x.example'), true, 'the default port spelled out');
  assert.equal(judgeFrameable(csp("frame-ancestors 'none'; script-src 'self'"), ORIGIN, 'https://x.example'), false, 'anywhere in the policy');
  assert.equal(judgeFrameable(csp("frame-ancestors"), ORIGIN, 'https://x.example'), false, 'an empty source list matches nothing');
  assert.equal(judgeFrameable(headers({ 'x-frame-options': 'DENY', 'content-security-policy': 'frame-ancestors https://pocket.example.net' }), ORIGIN, 'https://x.example'), true, 'frame-ancestors overrides X-Frame-Options');
  assert.equal(judgeFrameable(headers({ 'content-security-policy': "default-src 'self'" }), ORIGIN, 'https://x.example'), null, 'a policy without frame-ancestors says nothing');
});

const fakeNet = ({ pages = {}, hosts = {} } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    const page = pages[url]; if (!page) throw Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    assert.equal(init.redirect, 'manual');
    return { status: page.status || 200, headers: headers(page.headers || {}), body: { cancel() { page.cancelled = true; } } };
  };
  const lookup = async host => { const a = hosts[host]; if (!a) throw new Error('ENOTFOUND'); return a.map(address => ({ address })); };
  return { fetchImpl, lookup, calls };
};

test('links: the probe follows redirects on public hosts only and reads the final page', async () => {
  const net = fakeNet({
    hosts: { 'github.com': ['140.82.112.3'], 'drive.google.com': ['142.250.72.14'], 'accounts.google.com': ['142.250.72.13'], 'two.example': ['93.184.216.34', '10.0.0.5'], 'hop.example': ['93.184.216.34'], 'open.example': ['93.184.216.35'] },
    pages: {
      'https://github.com/x': { headers: { 'x-frame-options': 'deny' } },
      'https://drive.google.com/file/d/1/view': { status: 302, headers: { location: 'https://accounts.google.com/signin?c=1' } },
      'https://accounts.google.com/signin?c=1': { headers: { 'content-security-policy': "frame-ancestors 'self'" } },
      'https://hop.example/a': { status: 301, headers: { location: '/b' } },
      'https://hop.example/b': { status: 307, headers: { location: 'http://127.0.0.1:8080/admin' } },
      'https://open.example/': { headers: {} },
      'https://open.example/loop': { status: 302, headers: { location: 'https://open.example/loop' } },
    },
  });
  const opts = { origin: ORIGIN, ...net };
  assert.deepEqual(await probeFrameable('https://github.com/x', opts), { frameable: false, reason: null, url: 'https://github.com/x', status: 200 });
  const drive = await probeFrameable('https://drive.google.com/file/d/1/view', opts);
  assert.equal(drive.frameable, false); assert.equal(drive.url, 'https://accounts.google.com/signin?c=1', 'the redirect was followed');
  assert.deepEqual(await probeFrameable('https://two.example/', opts), { frameable: null, reason: 'private' }, 'a host that also resolves privately is never fetched');
  assert.ok(!net.calls.includes('https://two.example/'));
  assert.deepEqual(await probeFrameable('https://hop.example/a', opts), { frameable: null, reason: 'private' }, 'a redirect into loopback stops there');
  assert.ok(!net.calls.some(u => u.startsWith('http://127.0.0.1')), 'the private hop was not fetched');
  assert.deepEqual(await probeFrameable('https://open.example/', opts), { frameable: null, reason: null, url: 'https://open.example/', status: 200 });
  assert.deepEqual(await probeFrameable('https://open.example/loop', opts), { frameable: null, reason: 'redirect' }, 'a redirect loop gives up');
  assert.deepEqual(await probeFrameable('https://localhost/x', opts), { frameable: null, reason: 'private' });
  assert.deepEqual(await probeFrameable('http://169.254.169.254/latest/meta-data/', opts), { frameable: null, reason: 'private' }, 'a literal metadata address');
  assert.deepEqual(await probeFrameable('https://nowhere.example/', opts), { frameable: null, reason: 'unresolved' });
  assert.deepEqual(await probeFrameable('javascript:alert(1)', opts), { frameable: null, reason: 'unsupported' });
  assert.equal(await probeFrameable('https://github.com/x', { ...opts, fetchImpl: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } }).then(r => r.reason), 'timeout');
});

test('links: the probe remembers an answer per address and origin', async () => {
  const net = fakeNet({ hosts: { 'github.com': ['140.82.112.3'] }, pages: { 'https://github.com/x': { headers: { 'x-frame-options': 'sameorigin' } } } });
  const probe = createFrameProbe({ ...net });
  assert.equal((await probe('https://github.com/x', { origin: ORIGIN })).frameable, false);
  assert.equal((await probe('https://github.com/x', { origin: ORIGIN })).frameable, false);
  assert.equal(net.calls.length, 1, 'the second ask is answered from memory');
  assert.equal((await probe('https://github.com/x', { origin: 'https://github.com' })).frameable, true, 'another origin is its own question');
  assert.equal(net.calls.length, 2);
  const flaky = createFrameProbe({ origin: ORIGIN, lookup: net.lookup, fetchImpl: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } });
  await flaky('https://github.com/x'); await flaky('https://github.com/x');
  assert.equal((await flaky('https://github.com/x')).reason, 'timeout', 'a timeout is not remembered');
});
