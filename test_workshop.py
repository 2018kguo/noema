"""Checks for the executable lesson and its fixed local HTTP interface."""
import json
import inspect
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import serve
BUNDLE = serve.load_bundle(serve.ROOT / "courses/deepinfer")
import tiny_engine


class WorkshopTests(unittest.TestCase):
    def test_full_reference_suite_reports_all_five_groups(self):
        result = tiny_engine.lesson_experiment('reference-checks')
        self.assertEqual(result['checks'], 218)
        self.assertEqual({g['id']: g['checks'] for g in result['groups']},
                         {'prefixes': 177, 'generation': 15, 'isolation': 24,
                          'adapter': 1, 'boundary': 1})

    def test_full_suite_checks_generated_sequences_as_well_as_scores(self):
        def different_generation(self, prompt, count, use_cache=True):
            return [1] if use_cache else [2]
        with patch.object(tiny_engine.TinyEngine, 'generate', different_generation):
            with self.assertRaises(AssertionError):
                tiny_engine.reference_checks()

    def test_reference_and_repair_agree_on_every_fixed_prefix(self):
        baseline = tiny_engine.lesson_experiment('baseline')
        repaired = tiny_engine.lesson_experiment('repaired')
        self.assertEqual(baseline['rows'], repaired['rows'])
        self.assertTrue(baseline['matches'])
        self.assertEqual([row['prefix_length'] for row in baseline['rows']], [1, 2, 3, 4])
        self.assertIsNone(baseline['first_divergence'])

    def test_broken_read_is_invisible_at_first_position_then_detected(self):
        result = tiny_engine.lesson_experiment('broken')
        self.assertTrue(result['rows'][0]['matches'])
        self.assertEqual(result['first_divergence'], 2)
        self.assertGreater(result['rows'][1]['max_error'], result['tolerance'])
        self.assertFalse(result['matches'])

    def test_trace_explains_actual_positions_weights_and_changed_scores(self):
        good = tiny_engine.lesson_experiment('baseline')['rows'][1]
        bad = tiny_engine.lesson_experiment('broken')['rows'][1]
        self.assertEqual(good['cache_length'], bad['cache_length'])
        self.assertEqual(good['cache_length'], 2)
        self.assertEqual(good['visible_positions'], [0, 1])
        self.assertEqual(bad['visible_positions'], [1])
        self.assertEqual(bad['weights'], [1.0])
        self.assertAlmostEqual(sum(good['weights']), 1.0)
        for row in (good, bad):
            first_component = sum(weight * row['positions'][position]['value_preview'][0]
                                  for weight, position in zip(row['weights'], row['visible_positions']))
            self.assertAlmostEqual(first_component, row['attention_preview'][0])
            self.assertEqual(row['max_error'], max(abs(a - b) for a, b in
                                                   zip(row['reference_logits'], row['actual_logits'])))

    def test_results_depend_on_actual_engine_execution(self):
        with patch.object(tiny_engine.TinyEngine, 'cached_step', return_value=[123.0] * 16):
            result = tiny_engine.lesson_experiment('baseline')
        self.assertEqual(result['first_divergence'], 1)
        self.assertFalse(result['matches'])


class WorkshopHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = serve.make_server(BUNDLE.path)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, body, origin=None):
        req = Request(self.origin + '/api/workshop', data=json.dumps(body).encode(),
                      headers={'Content-Type': 'application/json', 'Origin': origin or self.origin})
        try:
            with urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_runs_only_the_selected_fixed_case(self):
        status, value = self.request({'case': 'broken'})
        self.assertEqual(status, 200)
        self.assertEqual(value['first_divergence'], 2)

    def test_full_reference_suite_runs_through_the_browser_interface(self):
        status, value = self.request({'case': 'reference-checks'})
        self.assertEqual(status, 200)
        self.assertEqual(value['checks'], 218)

    def test_a_failed_comparison_never_returns_a_passing_report(self):
        with patch.object(tiny_engine.TinyEngine, 'cached_step', return_value=[123.0] * 16):
            status, value = self.request({'case': 'reference-checks'})
        self.assertEqual(status, 422)
        self.assertIn('error', value)
        self.assertNotIn('groups', value)

    def test_source_view_returns_the_actual_fixed_engine_functions(self):
        with urlopen(self.origin + '/api/workshop/source', timeout=5) as response:
            sources = json.load(response)
        self.assertEqual(set(sources), {'attention', 'attention_weights', 'full_logits', 'cached_step',
                                       'input_vector', 'finish_block', 'output_logits', 'generate'})
        self.assertEqual(sources['cached_step'], inspect.getsource(tiny_engine.TinyEngine.cached_step))

    def test_rejects_code_paths_extra_fields_and_invalid_types(self):
        for body in ({'case': 'print(1)'}, {'case': '../tiny_engine.py'},
                     {'case': 'baseline', 'code': 'print(1)'}, {'case': []}, []):
            status, _ = self.request(body)
            self.assertEqual(status, 422)

    def test_rejects_foreign_origin_before_execution(self):
        with patch.object(serve, 'lesson_experiment') as experiment:
            status, _ = self.request({'case': 'baseline'}, 'https://example.com')
        self.assertEqual(status, 403)
        experiment.assert_not_called()

    def test_rejects_oversized_input(self):
        status, _ = self.request({'case': 'x' * 250})
        self.assertEqual(status, 413)


if __name__ == '__main__':
    unittest.main()
