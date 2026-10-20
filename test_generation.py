"""Exercise the actual generation-to-course adapter with deterministic model responses."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from course_bundle import load_bundle
import generate_course as generator

ROOT = Path(__file__).resolve().parent


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.sample = load_bundle(ROOT / 'courses/deepinfer')
        self.lesson = self.sample.course['LESSONS'][0]
        self.item = {'id': 'fixture-course', 'revision': 1, 'note': 'Understand the mechanism.'}
        self.reading = {'documents': [{'id': 'source1', 'title': 'Fixture source', 'url': 'https://example.org/source',
                          'text': 'A source paragraph explaining the concept. ' * 40, 'sha256': 'fixture'}],
                        'scope': 'Fixture source only.', 'gaps': [], 'media_note': 'No media.'}
        self.calls = []

    def model(self, provider, model, prompt, schema, **kwargs):
        self.calls.append(set(schema['properties']))
        if 'glossary' in schema['properties']:
            return {'title': 'Fixture course', 'heading': 'Understand the mechanism', 'introduction': 'Begin with a small example.',
                    'lessons': [{'title': 'Idea ' + str(i), 'phase': '01 · Foundations', 'goal': 'Explain the mechanism.',
                                 'focus': 'Use a concrete example.', 'sources': ['source1']} for i in range(5)],
                    'glossary': [{'term': 'Engine', 'definition': 'Software that runs a model.'}],
                    'reviews': ['Assess a proposal.'] * 3}
        if 'beginner_html' in schema['properties']:
            return {'beginner_html': self.lesson['layers'][0], 'mechanism_html': self.lesson['layers'][1],
                    'judgment_html': self.lesson['layers'][2], 'example_setup': self.lesson['example'][0],
                    'example_steps': self.lesson['example'][1],
                    'example_title': 'Follow three changes', 'visual': self.lesson.get('visual'),
                    'questions': [{k: q[k] for k in ('prompt', 'options', 'correct', 'why', 'hint')} for q in self.lesson['questions']],
                    'transfer_prompt': self.lesson['transfer'][0], 'rubric': self.lesson['transfer'][1],
                    'transfer_example': self.lesson['transfer'][2], 'takeaway': self.lesson['takeaway']}
        if set(schema['properties']) == {'lessons'}:
            return {'lessons': [{'id': 'idea-' + str(i + 1), 'beginner_html': self.lesson['layers'][0],
                                'example_setup': self.lesson['example'][0],
                                'example_steps': self.lesson['example'][1]} for i in range(5)]}
        challenge = self.sample.challenges['cache-key']
        return {'title': challenge['title'], 'prompt': challenge['prompt'], 'artifact': challenge['artifact'],
                'context': challenge['context'], 'setup': challenge['guide']['setup'],
                'terms': [{'name': a, 'explanation': b} for a, b in challenge['guide']['terms']],
                'reading': [{'name': a, 'explanation': b} for a, b in challenge['guide']['reading']],
                'prediction': challenge['guide']['trace'], 'hint': challenge['hint'],
                'criteria': [{k: c[k] for k in ('label', 'rule', 'feedback')} for c in challenge['criteria']],
                'solution': challenge['solution'], 'takeaway': challenge['guide']['takeaway']}

    def run_generation(self, cancelled=lambda: False):
        return generator.generate(self.item, self.reading, self.path, {'provider': 'fixture', 'model': 'fixture'},
                                  lambda *args: None, cancelled)

    def test_pipeline_builds_valid_course_and_reuses_all_saved_model_steps(self):
        with patch.object(generator, 'run_structured', side_effect=self.model):
            output, title = self.run_generation()
        result = load_bundle(output)
        self.assertEqual(len(result.course['LESSONS']), 5)
        self.assertEqual(len(result.challenges), 3)
        self.assertEqual(result.course['META']['id'], 'fixture-course')
        self.assertEqual(result.course['LESSONS'][1]['needs'], ['idea-1'])
        with patch.object(generator, 'run_structured', side_effect=AssertionError('Saved step was called again')):
            second, _ = self.run_generation()
        self.assertNotEqual(output, second)
        self.assertEqual(load_bundle(second).course, result.course)

    def test_cancellation_after_model_return_does_not_save_or_publish_stale_result(self):
        stopped = [False]
        def model(*args, **kwargs):
            value = self.model(*args, **kwargs)
            stopped[0] = True
            return value
        with patch.object(generator, 'run_structured', side_effect=model):
            with self.assertRaises(InterruptedError):
                self.run_generation(cancelled=lambda: stopped[0])
        self.assertEqual(list(self.path.glob('*.json')), [])
        self.assertEqual(list(self.path.glob('course-*')), [])


if __name__ == '__main__':
    unittest.main()
