// The app's text files are sent gzipped to a browser that accepts it, and exactly as before to one that does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import { staticGzip } from '../static-gzip.mjs';

// fetch() would ask for gzip and unpack it on its own; a plain request shows what was really sent.
const get = (port, url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject); req.end();
});

async function site(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-gzip-'));
  const big = 'const words = "' + 'the same words again and again '.repeat(400) + '";\n';
  fs.writeFileSync(path.join(dir, 'app.js'), big);
  fs.writeFileSync(path.join(dir, 'app.css'), '.a{color:red}\n'.repeat(300));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title>' + '<p>line</p>'.repeat(200));
  fs.writeFileSync(path.join(dir, 'sw.js'), '// worker\n'.repeat(200));
  fs.writeFileSync(path.join(dir, 'tiny.js'), 'let a=1;');
  fs.writeFileSync(path.join(dir, 'icon.png'), Buffer.alloc(4000, 7));
  fs.writeFileSync(path.join(dir, '.hidden.js'), 'secret words '.repeat(200));
  fs.mkdirSync(path.join(dir, 'vendor')); fs.writeFileSync(path.join(dir, 'vendor', 'lib.js'), 'lib();\n'.repeat(400));
  fs.writeFileSync(path.join(path.dirname(dir), path.basename(dir) + '-outside.js'), 'outside the folder '.repeat(200));
  const app = express();
  app.use(staticGzip(dir));
  app.use(express.static(dir, { index: 'index.html', maxAge: '5m' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(path.join(path.dirname(dir), path.basename(dir) + '-outside.js'), { force: true }); });
  return { dir, big, port: server.address().port };
}
const gz = { 'accept-encoding': 'gzip, deflate, br' };

test('a script, a style sheet and the page are gzipped for a browser that accepts it, and unpack to the file', async t => {
  const { dir, big, port } = await site(t);
  const js = await get(port, '/app.js?v=1', gz);
  assert.equal(js.status, 200); assert.equal(js.headers['content-encoding'], 'gzip'); assert.match(js.headers['content-type'], /^text\/javascript/);
  assert.equal(js.headers.vary, 'Accept-Encoding'); assert.equal(js.headers['cache-control'], 'public, max-age=300');
  assert.equal(zlib.gunzipSync(js.body).toString(), big); assert.ok(js.body.length < big.length / 5, 'much smaller on the wire');
  assert.equal(Number(js.headers['content-length']), js.body.length);
  const css = await get(port, '/app.css', gz); assert.equal(css.headers['content-encoding'], 'gzip'); assert.match(css.headers['content-type'], /^text\/css/);
  const sub = await get(port, '/vendor/lib.js', gz); assert.equal(sub.headers['content-encoding'], 'gzip');
  for (const url of ['/', '/index.html', '/?pane=1']) {
    const page = await get(port, url, gz);
    assert.equal(page.headers['content-encoding'], 'gzip', url); assert.equal(page.headers['cache-control'], 'no-cache', url + ' is checked on every load');
    assert.equal(zlib.gunzipSync(page.body).toString(), fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
  }
  assert.equal((await get(port, '/sw.js', gz)).headers['cache-control'], 'no-cache', 'the service worker is checked on every load');
});

test('everything else is answered as before: no gzip asked for, a range, an image, a small file, a missing file, a dotfile', async t => {
  const { big, port } = await site(t);
  const plain = await get(port, '/app.js'); assert.equal(plain.status, 200); assert.equal(plain.headers['content-encoding'], undefined); assert.equal(plain.body.toString(), big);
  const range = await get(port, '/app.js', { ...gz, range: 'bytes=0-9' }); assert.equal(range.status, 206); assert.equal(range.headers['content-encoding'], undefined); assert.equal(range.body.length, 10);
  const png = await get(port, '/icon.png', gz); assert.equal(png.headers['content-encoding'], undefined); assert.equal(png.body.length, 4000);
  const tiny = await get(port, '/tiny.js', gz); assert.equal(tiny.headers['content-encoding'], undefined); assert.equal(tiny.body.toString(), 'let a=1;');
  assert.equal((await get(port, '/nope.js', gz)).status, 404);
  assert.equal((await get(port, '/.hidden.js', gz)).status, 404, 'a dotfile is not served, gzipped or not');
  const head = await get(port, '/app.js', gz, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.headers['content-encoding'], 'gzip'); assert.equal(head.body.length, 0);
  assert.notEqual((await get(port, '/app.js', gz, 'POST')).headers['content-encoding'], 'gzip');
});

test('a path cannot climb out of the folder', async t => {
  const { dir, port } = await site(t);
  const outside = path.basename(dir) + '-outside.js';
  for (const url of ['/../' + outside, '/%2e%2e/' + outside, '/vendor/../../' + outside, '/..%2f' + outside, '/%00app.js']) {
    const r = await get(port, url, gz);
    assert.notEqual(r.status, 200, url); assert.ok(!r.body.includes('outside the folder'), url);
  }
});

test('an unchanged file answers 304 to its own tag, and a changed file is compressed again', async t => {
  const { dir, port } = await site(t);
  const first = await get(port, '/app.js', gz), tag = first.headers.etag; assert.ok(tag);
  const again = await get(port, '/app.js', { ...gz, 'if-none-match': tag }); assert.equal(again.status, 304); assert.equal(again.body.length, 0); assert.equal(again.headers.etag, tag);
  // The unzipped answer has a tag of its own, so a cache never hands gzip bytes to a browser that did not ask for them.
  assert.notEqual((await get(port, '/app.js')).headers.etag, tag);
  fs.writeFileSync(path.join(dir, 'app.js'), 'const changed = "' + 'new words now '.repeat(300) + '";\n');
  fs.utimesSync(path.join(dir, 'app.js'), new Date(), new Date(Date.now() + 5000));
  const next = await get(port, '/app.js', { ...gz, 'if-none-match': tag }); assert.equal(next.status, 200); assert.notEqual(next.headers.etag, tag);
  assert.match(zlib.gunzipSync(next.body).toString(), /^const changed/);
});
