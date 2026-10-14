import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import server

class NotesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        server.NOTES = Path(cls.folder.name)
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.folder.cleanup()

    def request(self, path, method='GET', body=None, headers=None):
        req = Request(self.base + path, method=method, data=json.dumps(body).encode() if body else None, headers=headers or {})
        with urlopen(req) as response:
            return json.load(response)

    def test_markdown_round_trip(self):
        content = '# A thought\n\n日本語 and **Markdown**.\n'
        self.request('/api/notes/Thought.md', 'PUT', {'content': content, 'create': True})
        self.assertEqual((server.NOTES / 'Thought.md').read_text(), content)
        self.assertIn(content, [n['content'] for n in self.request('/api/notes')])
        self.request('/api/notes/Thought.md', 'PUT', {'content': '# Revised'})
        self.assertEqual((server.NOTES / 'Thought.md').read_text(), '# Revised')
        self.request('/api/notes/Thought.md', 'DELETE')
        self.assertFalse((server.NOTES / 'Thought.md').exists())

    def test_duplicate_creation_preserves_content(self):
        self.request('/api/notes/Duplicate.md', 'PUT', {'content': 'original', 'create': True})
        with self.assertRaises(HTTPError) as error:
            self.request('/api/notes/Duplicate.md', 'PUT', {'content': 'replacement', 'create': True})
        self.assertEqual(error.exception.code, 409)
        self.assertEqual((server.NOTES / 'Duplicate.md').read_text(), 'original')

    def test_invalid_paths(self):
        for path in ['../outside.md', '/absolute.md', 'a/b.md', 'note.txt']:
            with self.assertRaises(ValueError):
                server.note_path(path)

    def test_cross_origin_mutation_rejected(self):
        with self.assertRaises(HTTPError) as error:
            self.request('/api/notes/Attack.md', 'PUT', {'content': 'no'}, {'Origin': 'https://other.example'})
        self.assertEqual(error.exception.code, 403)

    def test_symlink_rejected(self):
        target = server.NOTES / 'target.txt'
        target.write_text('original')
        try:
            (server.NOTES / 'Link.md').symlink_to(target)
        except OSError as error:
            self.skipTest(f'Symlink creation unavailable: {error}')
        with self.assertRaises(HTTPError) as error:
            self.request('/api/notes/Link.md', 'PUT', {'content': 'no'})
        self.assertEqual(error.exception.code, 400)
        self.assertEqual(target.read_text(), 'original')

    def test_vimrc_round_trip(self):
        config = '" My preferences\r\nset ts=8 sw=2\r\ninoremap jj <Esc>\r\n'
        initial = self.request('/api/vimrc')
        self.assertEqual(initial['content'], '')
        self.assertEqual(initial['path'], str(server.NOTES / '.vimrc'))
        self.request('/api/vimrc', 'PUT', {'content': config})
        self.assertEqual((server.NOTES / '.vimrc').read_bytes().decode('utf-8'), config)
        self.assertEqual(self.request('/api/vimrc')['content'], config.replace('\r\n', '\n'))
        self.assertNotIn('.vimrc', [note['name'] for note in self.request('/api/notes')])
        self.request('/api/vimrc', 'PUT', {'content': ''})
        self.assertEqual(self.request('/api/vimrc')['content'], '')

    def test_vimrc_cross_origin_rejected(self):
        with self.assertRaises(HTTPError) as error:
            self.request('/api/vimrc', 'PUT', {'content': 'set nu'}, {'Origin': 'https://other.example'})
        self.assertEqual(error.exception.code, 403)
        error.exception.close()

    def test_vimrc_size_limit(self):
        with self.assertRaises(HTTPError) as error:
            self.request('/api/vimrc', 'PUT', {'content': 'x' * 70_000})
        self.assertEqual(error.exception.code, 413)
        error.exception.close()

    def test_vimrc_symlink_rejected(self):
        target = server.NOTES / 'private.txt'
        target.write_text('private')
        config = server.NOTES / '.vimrc'
        if config.exists():
            config.unlink()
        try:
            config.symlink_to(target)
        except OSError as error:
            self.skipTest(f'Symlink creation unavailable: {error}')
        try:
            for method in ['GET', 'PUT']:
                with self.assertRaises(HTTPError) as error:
                    self.request('/api/vimrc', method, {'content': 'no'} if method == 'PUT' else None)
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
            self.assertEqual(target.read_text(), 'private')
        finally:
            config.unlink()

if __name__ == '__main__':
    unittest.main()
