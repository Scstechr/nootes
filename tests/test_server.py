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
        (server.NOTES / 'Link.md').symlink_to(target)
        with self.assertRaises(HTTPError) as error:
            self.request('/api/notes/Link.md', 'PUT', {'content': 'no'})
        self.assertEqual(error.exception.code, 400)
        self.assertEqual(target.read_text(), 'original')

if __name__ == '__main__':
    unittest.main()
