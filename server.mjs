import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const noteLimit = 2_000_000;
const vimrcLimit = 65_536;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function notePath(folder, name) {
  if (typeof name !== 'string' || /[\r\n]/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}\.md$/.test(name) || name.includes('..')) {
    throw new HttpError(400, 'Invalid Markdown filename');
  }
  return path.join(folder, name);
}

async function checkFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new HttpError(400, 'Symlinks are not supported');
    if (!stat.isFile()) throw new HttpError(400, 'Expected a regular file');
    return stat;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(file, content) {
  const temporary = path.join(path.dirname(file), `.nootes-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function json(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

async function readBody(request, limit) {
  if (Number(request.headers['content-length']) > limit) {
    request.resume();
    throw new HttpError(413, 'File exceeds size limit');
  }
  const bytes = await new Promise((resolve, reject) => {
    let length = 0, exceeded = false;
    const chunks = [];
    request.on('data', chunk => {
      length += chunk.length;
      if (length > limit) {
        if (!exceeded) reject(new HttpError(413, 'File exceeds size limit'));
        exceeded = true;
        chunks.length = 0;
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    request.on('error', reject);
    request.on('aborted', () => reject(new HttpError(400, 'Incomplete request')));
  });
  try {
    const data = JSON.parse(bytes.toString('utf8'));
    if (!data || typeof data.content !== 'string') throw new Error();
    return data;
  } catch { throw new HttpError(400, 'Content must be text in a valid JSON request'); }
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.host;
  } catch { return false; }
}

function within(folder, file) {
  const relative = path.relative(folder, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

export async function createNotesServer({ notesDir = process.env.NOTES_DIR || path.join(root, 'notes'), distDir = path.join(root, 'dist') } = {}) {
  notesDir = path.resolve(notesDir);
  distDir = path.resolve(distDir);
  await fs.mkdir(notesDir, { recursive: true });
  const vimrcPath = path.join(notesDir, '.vimrc');
  // Serialize mutations so duplicate creation and consecutive autosaves cannot
  // race with one another, while reads remain independent.
  let pending = Promise.resolve();
  const mutate = operation => {
    const result = pending.catch(() => {}).then(operation);
    pending = result;
    return result;
  };

  const server = http.createServer(async (request, response) => {
    try {
      const route = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const method = request.method;
      if (route === '/api/config' && method === 'GET') {
        return json(response, 200, { storage: notesDir });
      }
      if (route === '/api/notes' && method === 'GET') {
        const entries = await fs.readdir(notesDir, { withFileTypes: true });
        const notes = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(async entry => {
          const file = path.join(notesDir, entry.name);
          const stat = await checkFile(file);
          if (!stat) return null;
          const content = await fs.readFile(file, 'utf8');
          return { name: entry.name, content, updated: stat.mtime.toISOString() };
        }));
        return json(response, 200, notes.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated)));
      }
      if (route === '/api/vimrc' && method === 'GET') {
        const stat = await checkFile(vimrcPath);
        let content = '';
        if (stat) {
          const bytes = await fs.readFile(vimrcPath);
          try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
          catch { throw new HttpError(400, '.vimrc must be UTF-8 text'); }
        }
        return json(response, 200, { content, path: vimrcPath });
      }
      if (route === '/api/vimrc' || route.startsWith('/api/notes/')) {
        if (!['PUT', 'DELETE'].includes(method)) throw new HttpError(405, 'Method not allowed');
        if (!sameOrigin(request)) throw new HttpError(403, 'Origin rejected');
        const isVimrc = route === '/api/vimrc';
        if (isVimrc && method === 'DELETE') throw new HttpError(405, 'Use an empty file to reset Vim configuration');
        const file = isVimrc ? vimrcPath : notePath(notesDir, route.slice('/api/notes/'.length));
        const data = method === 'PUT' ? await readBody(request, isVimrc ? vimrcLimit : noteLimit) : null;
        await mutate(async () => {
          const exists = await checkFile(file);
          if (method === 'DELETE') {
            if (!exists) throw new HttpError(404, 'Note not found');
            await fs.unlink(file);
          } else {
            if (data.create && exists) throw new HttpError(409, 'A note with this name already exists');
            await atomicWrite(file, data.content);
          }
        });
        return json(response, 200, { ok: true });
      }
      if (route.startsWith('/api/')) throw new HttpError(404, 'Not found');
      if (!['GET', 'HEAD'].includes(method)) throw new HttpError(405, 'Method not allowed');
      const file = path.resolve(distDir, '.' + (route === '/' ? '/index.html' : route));
      if (!within(distDir, file)) throw new HttpError(404, 'Not found');
      try {
        const [realRoot, realFile] = await Promise.all([fs.realpath(distDir), fs.realpath(file)]);
        if (!within(realRoot, realFile)) throw new HttpError(404, 'Not found');
        const stat = await fs.stat(realFile);
        if (!stat.isFile()) throw new HttpError(404, 'Not found');
        const body = await fs.readFile(realFile);
        response.writeHead(200, {
          'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
          'Content-Length': body.length,
          'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
        return response.end(method === 'HEAD' ? undefined : body);
      } catch (error) {
        if (error.code === 'ENOENT' && route === '/') throw new HttpError(503, 'Build the frontend with npm run build, then reload.');
        if (error.code === 'ENOENT') throw new HttpError(404, 'Not found');
        throw error;
      }
    } catch (error) {
      if (response.destroyed || response.headersSent) return;
      if (error instanceof URIError) return json(response, 400, { error: 'Invalid URL' });
      json(response, error.status || 500, { error: error.status ? error.message : 'Could not access local files' });
    }
  });
  return server;
}

export async function startServer() {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
  const server = await createNotesServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const displayHost = host.includes(':') ? `[${host}]` : host;
  console.log(`Nootes -> http://${displayHost}:${server.address().port} | Markdown folder: ${path.resolve(process.env.NOTES_DIR || path.join(root, 'notes'))}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(error => {
    console.error(error.code === 'EADDRINUSE'
      ? 'Nootes: The port is already in use. Set PORT to another value and run npm start again.'
      : `Nootes: ${error.message}`);
    process.exitCode = 1;
  });
}
