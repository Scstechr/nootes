import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createNotesServer, notePath, listenWithFallback } from '../server.mjs';

async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nootes-node-'));
  const notesDir = path.join(folder, 'notes');
  const distDir = path.join(folder, 'dist');
  await fs.mkdir(distDir);
  await fs.writeFile(path.join(distDir, 'index.html'), '<h1>Nootes</h1>');
  await fs.writeFile(path.join(distDir, 'app.js'), 'console.log("Nootes")');
  const server = await createNotesServer({ notesDir, distDir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  t.after(async () => { await close(); await fs.rm(folder, {recursive: true, force: true}); });
  const request = async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
    return { status: response.status, data: await response.json() };
  };
  return {server, folder, notesDir, distDir, base, close, request};
}

test('Markdown create, update, list and delete preserve Unicode and line endings', async t => {
  const f = await fixture(t);
  const content = '# 日本語\r\n\r\nA **thought**.\r\n';
  assert.equal((await f.request('/api/notes/Thought.md', 'PUT', {content, create: true})).status, 200);
  assert.equal(await fs.readFile(path.join(f.notesDir, 'Thought.md'), 'utf8'), content);
  const list = await f.request('/api/notes');
  assert.equal(list.data[0].content, content);
  assert.ok(Number.isFinite(Date.parse(list.data[0].updated)));
  assert.equal((await f.request('/api/notes/Thought.md', 'PUT', {content: '# Revised'})).status, 200);
  assert.equal(await fs.readFile(path.join(f.notesDir, 'Thought.md'), 'utf8'), '# Revised');
  assert.equal((await f.request('/api/notes/Thought.md', 'DELETE')).status, 200);
  assert.deepEqual((await f.request('/api/notes')).data, []);
});

test('concurrent duplicate creation preserves the winning content', async t => {
  const f = await fixture(t);
  const results = await Promise.all(['first', 'second'].map(content => f.request('/api/notes/Same.md', 'PUT', {content, create: true})));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? 'first' : 'second';
  assert.equal(await fs.readFile(path.join(f.notesDir, 'Same.md'), 'utf8'), winner);
});

test('invalid filenames and encoded traversal cannot leave the notes folder', async t => {
  const f = await fixture(t);
  for (const name of ['../outside.md', '/absolute.md', 'a/b.md', 'a\\b.md', 'note.txt', 'note.md\n', 'NUL.md']) {
    assert.throws(() => notePath(f.notesDir, name));
    const result = await f.request('/api/notes/' + encodeURIComponent(name), 'PUT', {content: 'no'});
    assert.ok([400, 404].includes(result.status));
  }
  assert.equal((await fs.readdir(f.notesDir)).length, 0);
});

test('cross-origin note and vimrc mutations are rejected; same-origin HTTPS is accepted', async t => {
  const f = await fixture(t);
  for (const route of ['/api/notes/Attack.md', '/api/vimrc']) {
    assert.equal((await f.request(route, 'PUT', {content: 'no'}, {Origin: 'https://other.example'})).status, 403);
  }
  assert.equal((await f.request('/api/vimrc', 'PUT', {content: 'set nu'}, {Origin: f.base.replace('http:', 'https:')})).status, 200);
});

test('vimrc persists separately from notes and reads a Windows UTF-8 BOM', async t => {
  const f = await fixture(t);
  const initial = await f.request('/api/vimrc');
  assert.equal(initial.data.content, '');
  assert.equal(initial.data.path, path.join(f.notesDir, '.vimrc'));
  const content = 'set number\r\ninoremap jj <Esc>\r\n';
  assert.equal((await f.request('/api/vimrc', 'PUT', {content})).status, 200);
  assert.equal(await fs.readFile(path.join(f.notesDir, '.vimrc'), 'utf8'), content);
  assert.equal((await f.request('/api/vimrc')).data.content, content);
  assert.deepEqual((await f.request('/api/notes')).data, []);
  await fs.writeFile(path.join(f.notesDir, '.vimrc'), '\uFEFF' + content);
  assert.equal((await f.request('/api/vimrc')).data.content, content);
  assert.equal((await f.request('/api/vimrc', 'PUT', {content: ''})).status, 200);
  assert.equal((await f.request('/api/vimrc')).data.content, '');
});

test('notes and vimrc survive restarting the Node server', async t => {
  const f = await fixture(t);
  await f.request('/api/notes/Keep.md', 'PUT', {content: '# Keep me'});
  await f.request('/api/vimrc', 'PUT', {content: 'set ts=8'});
  await f.close();
  const restarted = await createNotesServer({notesDir: f.notesDir, distDir: f.distDir});
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {restarted.close(resolve); restarted.closeAllConnections();}));
  const base = `http://127.0.0.1:${restarted.address().port}`;
  assert.equal((await (await fetch(base + '/api/notes')).json())[0].content, '# Keep me');
  assert.equal((await (await fetch(base + '/api/vimrc')).json()).content, 'set ts=8');
});

test('bad payloads, oversized files and missing notes produce useful status codes', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/vimrc', 'PUT', {content: 42})).status, 400);
  assert.equal((await f.request('/api/vimrc', 'PUT', {content: 'x'.repeat(70_000)})).status, 413);
  assert.equal((await f.request('/api/notes/Large.md', 'PUT', {content: 'x'.repeat(2_000_001)})).status, 413);
  assert.equal((await f.request('/api/notes/Missing.md', 'DELETE')).status, 404);
  assert.equal((await f.request('/api/vimrc', 'DELETE')).status, 405);
  assert.equal((await f.request('/api/unknown')).status, 404);
  await fs.writeFile(path.join(f.notesDir, '.vimrc'), Buffer.from([0xff, 0xfe]));
  assert.equal((await f.request('/api/vimrc')).status, 400);
});

test('body size limits also apply to requests without Content-Length', async t => {
  const f = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(f.base + '/api/vimrc', {method: 'PUT', headers: {'Content-Type': 'application/json'}}, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write('{"content":"');
    req.end('x'.repeat(70_000) + '"}');
  });
  assert.equal(status, 413);
});

test('symlinked notes and vimrc cannot expose or overwrite another file', async t => {
  const f = await fixture(t);
  const target = path.join(f.folder, 'private.txt');
  await fs.writeFile(target, 'private');
  try {
    await fs.symlink(target, path.join(f.notesDir, 'Link.md'));
    await fs.symlink(target, path.join(f.notesDir, '.vimrc'));
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation requires privileges on this platform');
    throw error;
  }
  assert.deepEqual((await f.request('/api/notes')).data, []);
  assert.equal((await f.request('/api/notes/Link.md', 'PUT', {content: 'no'})).status, 400);
  assert.equal((await f.request('/api/vimrc')).status, 400);
  assert.equal((await f.request('/api/vimrc', 'PUT', {content: 'no'})).status, 400);
  assert.equal(await fs.readFile(target, 'utf8'), 'private');
});

test('serves built frontend assets, HEAD requests, and never exposes source or notes', async t => {
  const f = await fixture(t);
  const index = await fetch(f.base + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /Nootes/);
  const asset = await fetch(f.base + '/app.js', {method: 'HEAD'});
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await asset.text(), '');
  for (const route of ['/server.mjs', '/notes/Secret.md', '/%2e%2e%2fserver.mjs']) {
    assert.equal((await fetch(f.base + route)).status, 404);
  }
});


class FakeListener extends EventEmitter {
  constructor(errors) { super(); this.errors = [...errors]; this.ports = []; }
  listen(port, host) {
    this.ports.push(port);
    const code = this.errors.shift();
    queueMicrotask(() => code ? this.emit('error', Object.assign(new Error(code), {code})) : this.emit('listening'));
  }
}

test('default port falls back past occupied ports and cleans up listener handlers', async () => {
  const server = new FakeListener(['EADDRINUSE', 'EADDRINUSE', null]);
  const notices = [];
  const port = await listenWithFallback(server, {onFallback: (...ports) => notices.push(ports)});
  assert.equal(port, 8082);
  assert.deepEqual(server.ports, [8080, 8081, 8082]);
  assert.deepEqual(notices, [[8080, 8081], [8081, 8082]]);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('listening'), 0);
});

test('explicit port never changes silently', async () => {
  const server = new FakeListener(['EADDRINUSE']);
  await assert.rejects(listenWithFallback(server, {port: 9000, allowFallback: false}), {code: 'EADDRINUSE'});
  assert.deepEqual(server.ports, [9000]);
});

test('port fallback is bounded and does not retry other errors', async () => {
  const denied = new FakeListener(['EACCES']);
  await assert.rejects(listenWithFallback(denied), {code: 'EACCES'});
  assert.deepEqual(denied.ports, [8080]);
  const occupied = new FakeListener(['EADDRINUSE', 'EADDRINUSE']);
  await assert.rejects(listenWithFallback(occupied, {maxAttempts: 2}), {code: 'EADDRINUSE'});
  assert.deepEqual(occupied.ports, [8080, 8081]);
});
