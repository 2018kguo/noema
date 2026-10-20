"""Deterministic discovery, resume, archive timestamp and coverage checks."""
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse
from crawl import ArticleParser, Crawler, canonical, unwrap


class CrawlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.crawler = Crawler('https://example.org/blog/a', self.temp.name, '20260606011913', delay=0)
        self.failed = False
        self.requests = []
        self.crawler.request = self.request

    def request(self, url):
        self.requests.append(url)
        if '/cdx/search/' in url:
            value = [['urlkey', 'timestamp', 'original'], ['a', '20260606011913', 'https://example.org/blog/a']]
            return json.dumps(value).encode(), url, 'application/json'
        if '/wayback/available?' in url:
            original = parse_qs(urlparse(url).query)['url'][0]
            value = {'archived_snapshots': {'closest': {'available': True, 'timestamp': '20260607000000',
                     'url': 'http://web.archive.org/web/20260607000000/' + original}}}
            return json.dumps(value).encode(), url, 'application/json'
        original = unwrap(url)
        if original.endswith('/b') and self.failed:
            raise ValueError('Unavailable capture fixture')
        body = '<html><title>Article</title><p>' + ('A readable explanation. ' * 25) + '</p>'
        if original.endswith('/a'):
            body += '<a href="./b">Related</a><a href="https://papers.org/research">Paper</a>'
        body += '</html>'
        return body.encode(), url, 'text/html'

    def test_ignores_script_text_and_keeps_readable_blocks(self):
        parser = ArticleParser()
        parser.feed('<title>Title</title><p>Hello <b>world</b>.</p><script>bad()</script><p>Another idea.</p>')
        parser.flush()
        self.assertEqual(parser.blocks, ['Hello world .', 'Another idea.'])
        self.assertEqual(parser.title, 'Title')

    def test_discovers_graph_records_actual_capture_and_does_not_crawl_external_citations(self):
        self.crawler.run()
        self.assertEqual(self.crawler.data['coverage']['kind'], 'complete')
        self.assertEqual(self.crawler.data['coverage']['fetched'], 3)
        b = self.crawler.data['pages']['https://example.org/blog/b']
        self.assertEqual(b['capture'], '20260607000000')
        self.assertIn('id_/', b['fetched_url'])
        self.assertIn('https://papers.org/research', self.crawler.data['references'])
        self.assertFalse(any('url=https%3A%2F%2Fpapers.org' in u for u in self.requests))

    def test_failure_is_partial_even_after_queue_is_settled_then_retry_can_finish(self):
        self.failed = True
        self.crawler.run()
        self.assertEqual(self.crawler.data['coverage']['kind'], 'partial')
        self.assertTrue(self.crawler.data['coverage']['settled'])
        self.assertEqual(self.crawler.data['coverage']['unavailable'], 1)
        self.failed = False
        self.crawler.run(retry=True)
        self.assertEqual(self.crawler.data['coverage']['kind'], 'complete')

    def test_resume_does_not_fetch_already_saved_articles(self):
        self.crawler.run()
        self.requests.clear()
        self.crawler.run()
        self.assertFalse(any('id_/' in u for u in self.requests))

    def test_unwraps_archive_links_before_resolving_article_identity(self):
        archived = 'https://web.archive.org/web/20260606011913id_/https://example.org/blog/a?utm=tracking'
        self.assertEqual(canonical(archived), 'https://example.org/blog/a')


if __name__ == '__main__':
    unittest.main()
