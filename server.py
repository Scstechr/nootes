"""Nootes: a dependency-free Python backend for local Markdown notes."""
import json
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
NOTES = Path(os.environ.get('NOTES_DIR', ROOT / 'notes')).resolve()
LOCK = threading.Lock()

def note_path(name):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}\.md', name) or '..' in name:
        raise ValueError('Invalid Markdown filename')
    return NOTES / name

def write_note(path, content):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=NOTES, delete=False) as file:
        file.write(content)
        temporary = file.name
    os.replace(temporary, path)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = unquote(urlparse(self.path).path)
        if route == '/api/notes':
            notes = []
            for path in NOTES.glob('*.md'):
                if path.is_symlink():
                    continue
                content = path.read_text(encoding='utf-8')
                notes.append({'name': path.name, 'content': content, 'updated': datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()})
            return self.send_json(sorted(notes, key=lambda n: n['updated'], reverse=True))
        if route == '/api/config':
            return self.send_json({'storage': str(NOTES)})
        if route.startswith('/api/'):
            return self.send_json({'error': 'Not found'}, 404)
        super().do_GET()

    def mutate(self, delete=False):
        route = unquote(urlparse(self.path).path)
        if not route.startswith('/api/notes/'):
            return self.send_json({'error': 'Not found'}, 404)
        # Reject browser requests from other origins, including cross-site form posts.
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            return self.send_json({'error': 'Origin rejected'}, 403)
        try:
            path = note_path(route[len('/api/notes/'):])
            if path.is_symlink():
                raise ValueError('Symlinks are not supported')
            with LOCK:
                if delete:
                    path.unlink()
                else:
                    length = int(self.headers.get('Content-Length', '0'))
                    if length > 2_000_000:
                        return self.send_json({'error': 'Note exceeds 2 MB'}, 413)
                    data = json.loads(self.rfile.read(length))
                    content = data['content']
                    if not isinstance(content, str):
                        raise ValueError('Content must be text')
                    if data.get('create') and path.exists():
                        return self.send_json({'error': 'A note with this name already exists'}, 409)
                    write_note(path, content)
            return self.send_json({'ok': True})
        except FileNotFoundError:
            return self.send_json({'error': 'Note not found'}, 404)
        except (ValueError, KeyError, TypeError):
            return self.send_json({'error': 'Invalid note or request'}, 400)

    def do_PUT(self):
        self.mutate()

    def do_DELETE(self):
        self.mutate(delete=True)

if __name__ == '__main__':
    NOTES.mkdir(parents=True, exist_ok=True)
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '8080'))
    print(f'Nootes → http://{host}:{port} | Markdown folder: {NOTES}', flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
