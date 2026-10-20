"""Prove courses, graders and share bundles do not leak into one another."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

import course
import serve
from course_bundle import load_bundle


class PortabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'article'
        self.path.mkdir()
        value = copy.deepcopy(load_bundle(serve.ROOT / 'courses/deepinfer').course)
        value['META'].update(id='article', title='Article course', heading='Judge an article',
                             about_html='<p>An original article course.</p>')
        value['META'].pop('progress_key')
        value['LESSONS'] = [value['LESSONS'][0]]
        value['LESSONS'][0].pop('activity')
        value['CARDS'] = [c for c in value['CARDS'] if c[3] == 'map']
        value['LABS'] = []
        value['CONTENT_REVISION'] = 'article-revision-1'
        self.value = value
        self.write()

    def write(self):
        (self.path / 'course.json').write_text(json.dumps(self.value))
        (self.path / 'challenges.json').write_text('[]')

    def server(self):
        server = serve.make_server(self.path, provider='fixture')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return 'http://127.0.0.1:' + str(server.server_port)

    def test_loads_article_with_its_own_metadata_and_rubric(self):
        bundle = load_bundle(self.path)
        self.assertEqual(bundle.course['META']['id'], 'article')
        self.assertEqual(set(bundle.assessments), {'lesson-map'})
        self.assertEqual(bundle.assessments['lesson-map']['revision'], 'article-revision-1')

    def test_missing_prerequisite_or_source_fails_before_serving(self):
        for field in ('needs', 'sources'):
            self.value['LESSONS'][0][field] = ['missing']
            self.write()
            with self.assertRaises(ValueError):
                load_bundle(self.path)
            self.value['LESSONS'][0][field] = []

    def test_article_server_has_no_inference_execution_endpoints(self):
        origin = self.server()
        for path in ('/api/workshop/source', '/tiny_engine.py'):
            with self.assertRaises(HTTPError) as error:
                urlopen(origin + path)
            self.assertEqual(error.exception.code, 404)
        req = Request(origin + '/api/workshop', data=b'{"case":"baseline"}',
                      headers={'Content-Type': 'application/json'})
        with self.assertRaises(HTTPError) as error:
            urlopen(req)
        self.assertEqual(error.exception.code, 404)
        with urlopen(origin + '/course.json') as response:
            self.assertEqual(json.load(response)['META']['title'], 'Article course')

    def test_grading_uses_selected_course_and_revision(self):
        origin = self.server()
        with patch.object(serve, 'assess', return_value={'grade': {}, 'meta': {}}) as assessor:
            req = Request(origin + '/api/grade', data=json.dumps({
                'challenge_id': 'lesson-map', 'answer': 'An explanation for this article.'}).encode(),
                headers={'Content-Type': 'application/json'})
            with urlopen(req):
                pass
            self.assertEqual(assessor.call_args.args[-1], 'article-revision-1')
            self.assertEqual(assessor.call_args.args[0]['revision'], 'article-revision-1')

    def test_share_bundle_excludes_sources_keys_and_progress_and_loads_after_unpacking(self):
        (self.path / '.env').write_text('SECRET=do-not-copy')
        (self.path / 'sources').mkdir()
        (self.path / 'sources/raw.html').write_text('private raw source')
        (self.path / 'progress.json').write_text('private learner answer')
        destination = course.bundle(self.path, Path(self.temp.name) / 'share.zip')
        with zipfile.ZipFile(destination) as archive:
            self.assertEqual(set(archive.namelist()), set(course.RUNTIME) |
                             {'course/course.json', 'course/challenges.json', 'LICENSE', 'README.txt'})
            unpacked = Path(self.temp.name) / 'unpacked'
            archive.extractall(unpacked)
        result = load_bundle(unpacked / 'course')
        self.assertEqual(result.course['META']['id'], 'article')
        self.assertEqual(result.course['LABS'], [])


if __name__ == '__main__':
    unittest.main()
