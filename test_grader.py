"""Contract checks for rejecting bad assessment results, not model-quality tests."""
import copy
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import serve
BUNDLE = serve.load_bundle(serve.ROOT / "courses/deepinfer")


class GraderContractTests(unittest.TestCase):
    def setUp(self):
        self.challenge = BUNDLE.challenges['cache-key']
        self.answer = 'The same prompt can produce different attention state under different adapters.'
        self.grade = {'criteria': [{'id': c['id'], 'verdict': 'met',
                                   'evidence': 'different attention state', 'feedback': 'Specific feedback.'}
                                  for c in self.challenge['criteria']],
                      'summary': 'Provisional.', 'follow_up': 'Which comparison would prove it?'}

    def test_accepts_supported_evidence(self):
        self.assertEqual(serve.validate_grade(self.grade, self.challenge, self.answer), self.grade)

    def test_rejects_fabricated_evidence(self):
        self.grade['criteria'][0]['evidence'] = 'a quotation never written by the learner'
        with self.assertRaises(ValueError):
            serve.validate_grade(self.grade, self.challenge, self.answer)

    def test_rejects_incomplete_or_repeated_rubric(self):
        for mutate in ('missing', 'repeated'):
            value = copy.deepcopy(self.grade)
            if mutate == 'missing':
                value['criteria'].pop()
            else:
                value['criteria'][1]['id'] = value['criteria'][0]['id']
            with self.assertRaises(ValueError):
                serve.validate_grade(value, self.challenge, self.answer)

    def test_rejects_unknown_verdict(self):
        self.grade['criteria'][0]['verdict'] = 'mastered'
        with self.assertRaises(ValueError):
            serve.validate_grade(self.grade, self.challenge, self.answer)

    def test_rejects_context_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            external = Path(outside) / 'private.txt'
            external.write_text('Do not send')
            repo = Path(temp)
            (repo / 'escape').symlink_to(external)
            with self.assertRaises(ValueError):
                serve.selected_context({'repo_paths': ['escape']}, repo)

    def test_jev_never_turns_raw_probabilities_into_mastery(self):
        fake = {'model': 'fixture', 'answers': {c['id']: {'type': 'noul', 'noul': 0.999}
                                               for c in self.challenge['criteria']}}
        with patch.object(serve, 'post_provider', return_value=fake):
            grade, meta = serve.run_jev('', {'learner_answer': self.answer}, self.challenge)
        self.assertTrue(all(row['verdict'] == 'unclear' for row in grade['criteria']))
        self.assertEqual(len(meta['probabilities']), 4)

    def test_jev_rejects_absent_or_invalid_decisions(self):
        bad = [{'answers': {}}, {'answers': {c['id']: {'type': 'noul', 'noul': float('nan')}
                                            for c in self.challenge['criteria']}}]
        for value in bad:
            with patch.object(serve, 'post_provider', return_value=value):
                with self.assertRaises(ValueError):
                    serve.run_jev('', {}, self.challenge)

    def test_no_provider_never_invents_a_grade(self):
        with self.assertRaisesRegex(ValueError, 'No live grader enabled'):
            serve.assess(self.challenge, self.answer, 'none', '')

    def test_grade_records_the_exercise_version(self):
        with patch.object(serve, 'run_cli', return_value=(self.grade, {'provider': 'fixture'})):
            result = serve.assess(self.challenge, self.answer, 'claude', '')
        self.assertEqual(result['meta']['exercise_revision'], self.challenge['revision'])

    def test_lesson_rubrics_share_the_canonical_course(self):
        self.assertEqual(len({k: v for k, v in BUNDLE.assessments.items() if k.startswith('lesson-')}), 18)
        for lesson in BUNDLE.course['LESSONS']:
            task = {k: v for k, v in BUNDLE.assessments.items() if k.startswith('lesson-')}['lesson-' + lesson['id']]
            self.assertEqual([c['label'] for c in task['criteria']], lesson['transfer'][1])


if __name__ == '__main__':
    unittest.main()
