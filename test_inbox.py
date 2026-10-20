"""Queue persistence, stale-worker fencing, cancellation and HTTP course isolation."""
import concurrent.futures
import copy
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

from inbox_store import InboxStore, normalize_link
from inbox_worker import InboxWorker
from source_reader import NeedsInput, public_url
from generate_course import clean_html
import serve


class InboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = InboxStore(Path(self.temp.name))
        self.item, _ = self.store.add('https://example.org/post', 'Help me understand this.')

    def test_duplicate_links_and_settings_survive_reopening(self):
        self.store.configure('claude', 'haiku', True)
        reopened = InboxStore(self.temp.name)
        item, fresh = reopened.add('https://example.org/post?utm_source=bookmark')
        self.assertFalse(fresh)
        self.assertEqual(item['id'], self.item['id'])
        self.assertEqual(reopened.settings(), {'provider': 'claude', 'model': 'haiku', 'enabled': True})

    def test_social_link_aliases_deduplicate(self):
        self.assertEqual(normalize_link('https://twitter.com/person/status/123?s=20'),
                         normalize_link('https://x.com/person/status/123'))

    def test_article_query_parameters_keep_their_meaning(self):
        self.assertEqual(normalize_link('https://example.org/?s=biology&t=review&empty=&utm_source=copy'),
                         'https://example.org/?s=biology&t=review&empty=')

    def test_concurrent_workers_claim_at_most_one_active_job(self):
        self.store.add('https://example.org/second')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.store.claim, ('worker-a', 'worker-b')))
        self.assertEqual(sum(x is not None for x in results), 1)

    def test_restart_reclaims_expired_job_and_fences_old_worker(self):
        now = time.time()
        claimed = self.store.claim('old', now)
        reclaimed = self.store.claim('new', now + 61)
        self.assertEqual(claimed['id'], reclaimed['id'])
        self.assertFalse(self.store.advance(claimed['id'], 'old', 'ready', 'Stale result', course_path='/tmp/stale'))
        self.assertFalse(self.store.heartbeat(claimed['id'], 'old'))
        self.assertTrue(self.store.advance(claimed['id'], 'new', 'writing', 'New owner continues'))

    def test_cancelled_item_cannot_be_published_by_inflight_worker(self):
        self.store.claim('worker')
        self.store.action(self.item['id'], 'cancel')
        self.assertFalse(self.store.advance(self.item['id'], 'worker', 'ready', 'Must not publish', course_path='/tmp/result'))
        self.assertEqual(self.store.get(self.item['id'])['state'], 'cancelled')

    def test_unreadable_source_needs_text_without_calling_a_model(self):
        self.store.configure('claude', '', True)
        def reader(*args):
            raise NeedsInput('Paste the post text.')
        def never_prepare(*args):
            self.fail('Unreadable input must not spend model credits')
        worker = InboxWorker(self.store, prepare=never_prepare, reader=reader)
        self.assertTrue(worker.process_next())
        self.assertEqual(self.store.get(self.item['id'])['state'], 'needs_input')
        supplied = self.store.action(self.item['id'], 'provide_text', source_text='A useful copied excerpt. ' * 12)
        self.assertEqual(supplied['state'], 'queued')
        self.assertEqual(supplied['revision'], 2)

    def test_worker_reuses_saved_draft_after_interruption(self):
        self.store.configure('claude', '', True)
        attempts = []
        def prepare(item, reading, directory, settings, stage, cancelled):
            directory.mkdir(parents=True, exist_ok=True)
            checkpoint = directory / 'checkpoint.json'
            if not checkpoint.exists():
                checkpoint.write_text('saved work')
                attempts.append('first')
                raise InterruptedError('Restart fixture')
            attempts.append(checkpoint.read_text())
            stage('writing', 'Continuing saved draft.')
            stage('checking', 'Checking fixture.')
            return serve.ROOT / 'courses/deepinfer', 'Finished fixture'
        worker = InboxWorker(self.store, prepare=prepare, reader=lambda *args: {})
        worker.process_next()
        self.assertEqual(self.store.get(self.item['id'])['state'], 'queued')
        worker.process_next()
        self.assertEqual(attempts, ['first', 'saved work'])
        self.assertEqual(self.store.get(self.item['id'])['state'], 'ready')

    def test_paused_queue_does_no_work(self):
        worker = InboxWorker(self.store, prepare=lambda *args: self.fail('Paused queue ran'), reader=lambda *args: {})
        self.assertFalse(worker.process_next())
        self.assertEqual(self.store.get(self.item['id'])['state'], 'queued')

    def test_public_page_reader_rejects_private_dns_and_embedded_credentials(self):
        for url in ('http://user:pass@example.org/', 'file:///tmp/private', 'http://127.0.0.1/'):
            with self.assertRaises(ValueError):
                public_url(url)
        with patch('source_reader.socket.getaddrinfo', return_value=[(2, 1, 6, '', ('10.0.0.1', 80))]):
            with self.assertRaises(ValueError):
                public_url('https://example.org/')

    def test_generated_html_cannot_add_scripts_event_handlers_or_active_embeds(self):
        value = clean_html('<p onclick="steal()">Read <strong>this</strong>.</p><script>bad()</script><iframe src="private"></iframe><img src="x" onerror="bad()">')
        self.assertEqual(value, '<p>Read <strong>this</strong>.</p>')


class InboxHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = InboxStore(self.temp.name)
        self.server = serve.make_server(serve.ROOT / 'courses/deepinfer', inbox=self.store)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.origin = 'http://127.0.0.1:' + str(self.server.server_port)

    def request(self, path, body=None, origin=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        req = Request(self.origin + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        with urlopen(req) as response:
            return response.read(), response.headers

    def test_inbox_capture_is_persistent_and_does_not_expose_private_state_paths(self):
        body = {'urls': ['https://example.org/one', 'https://example.org/two'], 'note': 'Why does this work?', 'source_text': ''}
        value = json.loads(self.request('/api/inbox/items', body)[0])
        self.assertEqual(len(value['added']), 2)
        snapshot = json.loads(self.request('/api/inbox')[0])
        self.assertEqual(len(snapshot['items']), 2)
        self.assertNotIn('source_dir', snapshot['items'][0])
        self.assertNotIn('course_path', snapshot['items'][0])
        self.assertEqual(len(InboxStore(self.temp.name).list()), 2)

    def test_foreign_origin_cannot_enqueue_or_spend_account_credits(self):
        with self.assertRaises(HTTPError) as error:
            self.request('/api/inbox/items', {'urls': ['https://example.org/'], 'note': '', 'source_text': ''}, origin='https://evil.example')
        self.assertEqual(error.exception.code, 403)
        self.assertEqual(self.store.list(), [])

    def test_course_pages_and_api_routes_use_the_selected_bundle(self):
        raw, _ = self.request('/learn/deepinfer/course.json')
        self.assertEqual(json.loads(raw)['META']['id'], 'deepinfer')
        raw, _ = self.request('/learn/deepinfer/api/workshop/source')
        self.assertIn('cached_step', json.loads(raw))
        with self.assertRaises(HTTPError):
            self.request('/learn/missing/course.json')

    def test_zip_download_contains_no_inbox_database_raw_sources_or_progress(self):
        raw, headers = self.request('/share/deepinfer.zip')
        self.assertEqual(headers['Content-Type'], 'application/zip')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertIn('course/course.json', archive.namelist())
            self.assertFalse(any('sqlite' in p or 'local-data' in p or '/sources/' in p for p in archive.namelist()))


if __name__ == '__main__':
    unittest.main()
