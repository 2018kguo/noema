"""Real-browser capture, recovery, course navigation and phone layout; no model calls."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from inbox_store import InboxStore
import serve


@unittest.skipUnless(shutil.which('agent-browser'), 'agent-browser is required')
class InboxBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.store = InboxStore(cls.temp.name)
        cls.server = serve.make_server(serve.ROOT / 'courses/deepinfer', inbox=cls.store)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.browser = ['agent-browser', '--namespace', 'noema-inbox-tests', '--session', 'test-' + str(os.getpid()), '--json']

    @classmethod
    def tearDownClass(cls):
        subprocess.run(cls.browser + ['close'], capture_output=True, timeout=20)
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.temp.cleanup()

    def command(self, *args, stdin=None):
        result = subprocess.run(self.browser + list(args), input=stdin, text=True, capture_output=True, timeout=40)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        value = json.loads(result.stdout)
        self.assertTrue(value['success'], value)
        return value['data']

    def js(self, source):
        return self.command('eval', '--stdin', stdin=source)['result']

    def wait(self, expression):
        self.command('wait', '--fn', expression)

    def setUp(self):
        with self.store.connection() as db:
            db.execute('DELETE FROM items')
            db.execute('DELETE FROM events')
        self.store.configure('none', '', False)
        self.command('set', 'viewport', '1280', '900')
        self.command('open', self.origin)
        self.wait("document.querySelector('.empty') !== null")

    def test_batch_capture_reload_dedup_and_search(self):
        self.command('fill', '#links', 'https://example.org/one\nhttps://example.org/two')
        self.command('click', '#add-button')
        self.wait("document.querySelectorAll('.item-row').length === 2")
        self.command('reload')
        self.wait("document.querySelectorAll('.item-row').length === 2")
        self.command('fill', '#links', 'https://example.org/one?utm_source=copy')
        self.command('click', '#add-button')
        self.wait("document.querySelector('#toast').textContent.includes('already')")
        self.assertEqual(len(self.store.list()), 2)
        self.command('fill', '#search', 'two')
        self.assertEqual(self.js("document.querySelectorAll('.item-row').length"), 1)
        self.assertIn('two', self.js("document.querySelector('.item-title').textContent"))

    def test_missing_text_can_be_supplied_without_losing_it_during_polling(self):
        item, _ = self.store.add('https://example.org/blocked')
        self.store.claim('fixture')
        self.store.advance(item['id'], 'fixture', 'needs_input', 'Paste the source text to continue.')
        self.command('reload')
        self.wait("document.querySelector('[data-item]') !== null")
        self.command('click', '[data-item]')
        self.wait("document.querySelector('#replacement-text') !== null")
        text = 'This is the source material I want to study. ' * 8
        self.command('fill', '#replacement-text', text)
        self.js('refresh()')
        self.assertEqual(self.js("document.querySelector('#replacement-text').value"), text)
        self.command('click', '#provide-text-form button')
        self.wait("document.querySelector('#detail-badge').textContent.includes('Queued')")
        self.assertEqual(self.store.get(item['id'])['source_text'], text.strip())

    def test_ready_item_opens_real_course_under_its_own_path(self):
        item, _ = self.store.add('https://example.org/ready')
        self.store.claim('fixture')
        self.store.advance(item['id'], 'fixture', 'ready', 'Ready.', title='A ready course', course_path=serve.ROOT / 'courses/deepinfer')
        self.command('reload')
        self.wait("document.querySelector('[data-item]') !== null")
        self.command('click', '.ready-row')
        self.wait("document.querySelector('.continue-card') !== null")
        self.assertIn('/learn/' + item['id'] + '/', self.js('location.pathname'))
        self.assertEqual(self.js("document.querySelector('#course-brand').getAttribute('href')"), '/')
        self.command('open', self.origin + '/learn/' + item['id'] + '/#lesson/workshop/learn')
        self.wait("document.querySelector('.cache-code') !== null")
        self.assertIn('start =', self.js("document.querySelector('.cache-code').textContent"))

    def test_learning_view_and_phone_capture_have_no_horizontal_overflow(self):
        self.command('set', 'viewport', '390', '844')
        self.assertLessEqual(self.js('document.documentElement.scrollWidth'), 390)
        self.command('click', '#nav-learning')
        self.wait("document.querySelector('.sample-row') !== null")
        self.assertTrue(self.js("document.querySelector('#capture').hidden"))
        self.assertEqual(self.js("getComputedStyle(document.querySelector('#filters')).display"), 'none')
        self.assertLessEqual(self.js('document.documentElement.scrollWidth'), 390)


if __name__ == '__main__':
    unittest.main()
