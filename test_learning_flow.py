"""Real-browser regressions for saved answers and feedback freshness.

Run: python3 -m unittest test_learning_flow.py -v
Requires agent-browser with Chrome. Uses an isolated local origin and browser
namespace, deterministic grader fixtures, and no model account or API key.
"""
import json
import copy
import os
import shutil
import subprocess
import threading
import unittest
from urllib.parse import urlparse

import serve
from test_visuals import FUNNEL
BUNDLE = serve.load_bundle(serve.ROOT / "courses/deepinfer")


class FixtureHandler(serve.Handler):
    def do_GET(self):
        if urlparse(self.path).path == '/course.json' and self.server.funnel_fixture:
            course = copy.deepcopy(BUNDLE.course)
            course['LESSONS'][0].update(visual=FUNNEL, example_title='Follow parts through three checks',
                example=['Invented parts inspection.', ['Keep 80% of the starting 100.',
                         'Keep 50% of the remaining 80.', 'Keep 75% of the remaining 40.']])
            return self.send_json(200, course)
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path == '/api/workshop' and self.server.fail_workshop:
            return self.send_json(422, {'error': 'A test fixture comparison failed.'})
        if urlparse(self.path).path != '/api/grade':
            return super().do_POST()
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        task = BUNDLE.assessments[body['challenge_id']]
        self.server.submitted_answer = body['answer']
        self.server.started.set()
        if not self.server.release.wait(20):
            return self.send_json(504, {'error': 'Fixture release timed out.'})
        if self.server.fail_grade:
            return self.send_json(422, {'error': 'Deterministic test failure.'})
        grade = {'summary': 'Fixture feedback on the submitted answer.',
                 'criteria': [{'id': c['id'], 'verdict': 'missing', 'evidence': '',
                               'feedback': 'Explain the connection using your small example.'}
                              for c in task['criteria']],
                 'follow_up': 'What would you compare with a reference?'}
        self.send_json(200, {'grade': grade, 'meta': {
            'provider': 'test-fixture', 'model': 'deterministic', 'seconds': 0,
            'content_revision': BUNDLE.course['CONTENT_REVISION'],
            'exercise_revision': task.get('revision', BUNDLE.course['CONTENT_REVISION']),
            'context_note': 'Browser fixture; no model was called.'}})


@unittest.skipUnless(shutil.which('agent-browser'), 'agent-browser is required')
class LearningFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = serve.make_server(BUNDLE.path, handler=FixtureHandler)
        cls.server.provider, cls.server.model, cls.server.repo = 'test-fixture', 'deterministic', None
        cls.server.started, cls.server.release = threading.Event(), threading.Event()
        cls.server.fail_grade = False
        cls.server.fail_workshop = False
        cls.server.funnel_fixture = False
        cls.server.release.set()
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.browser = ['agent-browser', '--namespace', 'inference-flow-tests',
                       '--session', 'test-' + str(os.getpid()), '--json']

    @classmethod
    def tearDownClass(cls):
        cls.server.release.set()
        subprocess.run(cls.browser + ['close'], capture_output=True, timeout=20)
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def command(self, *args, stdin=None):
        result = subprocess.run(self.browser + list(args), input=stdin, text=True,
                                capture_output=True, timeout=40)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        value = json.loads(result.stdout)
        self.assertTrue(value['success'], value)
        return value['data']

    def js(self, source):
        return self.command('eval', '--stdin', stdin=source)['result']

    def wait(self, expression):
        self.command('wait', '--fn', expression)

    def open(self, route):
        self.command('open', self.origin + '/#' + route)
        self.wait("document.querySelector('.flow-footer') !== null")

    def setUp(self):
        self.server.funnel_fixture = False
        self.server.fail_grade = False
        self.server.fail_workshop = False
        self.server.started.clear()
        self.server.release.set()
        self.open('lesson/map')
        self.js("localStorage.clear(); true")
        self.command('reload')
        self.wait("document.querySelector('[data-step=explain]') !== null")
        self.command('set', 'viewport', '1280', '900')

    def click(self, selector):
        # Scroll the control above the fixed workflow bar before clicking it.
        self.js('document.querySelector(' + json.dumps(selector) + ').scrollIntoView({block:"center"}); true')
        self.command('click', selector)

    def lesson_answer(self, text='The engine runs learned numbers and the service routes requests.'):
        self.click('[data-step=explain]')
        self.command('fill', '#teach-answer', text)

    def applied_activity(self, lesson_id):
        self.open('lesson/' + lesson_id)
        self.click('[data-step=check]')
        lesson = next(l for l in BUNDLE.course['LESSONS'] if l['id'] == lesson_id)
        self.click('form[data-q] input[value="' + str(lesson['questions'][0]['correct']) + '"]')
        self.click('[data-submit-check]')
        self.click('.primary[data-open-activity]')

    def test_all_review_routes_have_one_action_and_save_predictions(self):
        for task in BUNDLE.challenges.values():
            self.open('challenges/' + task['id'])
            self.assertEqual(self.js("document.querySelectorAll('.primary').length"), 1)
            self.assertFalse(self.js("!!document.querySelector('textarea')"))
            self.click('[data-review-next]')
            self.assertTrue(self.js("!!document.querySelector('.review-reading')"))
            self.click('[data-review-next]')
            prediction = 'A saved prediction for ' + task['id']
            self.command('fill', '#review-prediction', prediction)
            self.click('[data-review-hint]')
            self.command('reload')
            self.wait("document.querySelector('#review-prediction') !== null")
            self.assertEqual(self.js("document.querySelector('#review-prediction').value"), prediction)
            self.assertTrue(self.js("!!document.querySelector('.hint-text')"))
            self.click('[data-review-next]')
            self.command('fill', '#challenge-answer', 'My review applies the small example and compares its results.')
            self.click('[data-compare-review]')
            self.assertEqual(self.js("document.querySelectorAll('.self-check').length"), 1)
            self.assertTrue(self.js("!!document.querySelector('[data-finish-review].primary')"))
            self.command('fill', '#challenge-answer', 'I edited this review after comparing it.')
            self.assertTrue(self.js("!!document.querySelector('[data-grade].primary')"))
            self.assertFalse(self.js("!!document.querySelector('[data-finish-review].primary')"))
            self.click('[data-finish-review]')
            self.assertIn('Keep this check in mind.', self.js("document.querySelector('h1').textContent"))

    def test_visual_counts_follow_steps_and_keyboard_experiment_preserves_original(self):
        self.server.funnel_fixture = True
        self.command('reload')
        self.wait("document.querySelector('[data-step=example]') !== null")
        self.click('[data-step=example]')
        self.assertEqual(self.js("Number(document.querySelector('[data-funnel]').dataset.value)"), 80)
        self.click('[data-example-next]')
        self.assertEqual(self.js("Number(document.querySelector('[data-funnel]').dataset.value)"), 40)
        self.assertIn('80 entering this gate', self.js("document.querySelector('.visual-equation').textContent"))
        self.assertEqual(self.js("document.querySelectorAll('.example-history li').length"), 1)
        self.click('[data-example-next]')
        self.assertEqual(self.js("Number(document.querySelector('[data-funnel]').dataset.value)"), 30)
        self.command('find', 'role', 'button', 'click', '--name', 'What if one rate changes?')
        self.wait("document.querySelector('wa-details.visual-experiment').open")
        self.command('focus', '#visual-rate')
        self.command('press', 'ArrowRight')
        self.assertEqual(self.js("document.querySelector('#visual-rate').value"), '50.5')
        self.assertIn('30.3', self.js("document.querySelector('[data-visual-experiment-result]').textContent"))
        self.assertEqual(self.js("Number(document.querySelector('[data-funnel]').dataset.value)"), 30)
        self.click('[data-visual-reset]')
        self.assertEqual(self.js("document.querySelector('#visual-rate').value"), '50')
        self.click('.flow-footer [data-step]')
        self.assertEqual(self.js("Number(document.querySelector('[data-funnel]').dataset.value)"), 40)
        self.assertEqual(self.js("document.querySelectorAll('.primary').length"), 1)

    def test_visual_mobile_layout_and_reduced_motion_need_no_external_assets(self):
        self.server.funnel_fixture = True
        self.command('set', 'media', 'light', 'reduced-motion')
        try:
            self.command('set', 'viewport', '390', '844')
            self.command('reload')
            self.wait("document.querySelector('[data-step=example]') !== null")
            self.click('[data-step=example]')
            self.click('[data-example-next]')
            self.assertEqual(self.js("Number(document.querySelector('[data-funnel]').dataset.value)"), 40)
            self.assertEqual(self.js("document.querySelectorAll('.cohort-dots span').length"), 100)
            self.assertEqual(self.js("document.querySelector('.cohort-dots').getAnimations({subtree:true}).length"), 0)
            self.assertFalse(self.js("document.documentElement.scrollWidth > innerWidth"))
            self.assertEqual(self.js("performance.getEntriesByType('resource').filter(r=>!r.name.startsWith(location.origin)).length"), 0)
            self.click('[data-example-next]')
            self.command('find', 'role', 'button', 'click', '--name', 'What if one rate changes?')
            self.wait("document.querySelector('wa-details.visual-experiment').open")
            self.assertFalse(self.js("document.documentElement.scrollWidth > innerWidth"))
        finally:
            self.command('set', 'media', 'light')

    def test_lesson_comparison_is_for_the_answer_compared(self):
        self.lesson_answer()
        self.click('[data-self-check]')
        self.assertTrue(self.js("!!document.querySelector('[data-finish-lesson].primary')"))
        self.command('fill', '#teach-answer', 'A revised explanation should get a fresh check.')
        self.assertTrue(self.js("!!document.querySelector('[data-grade-lesson].primary')"))
        self.assertFalse(self.js("!!document.querySelector('[data-finish-lesson].primary')"))

    def test_grade_keeps_submitted_answer_when_edited_during_request(self):
        self.lesson_answer()
        self.server.release.clear()
        self.click('[data-grade-lesson]')
        self.assertTrue(self.server.started.wait(5))
        original = self.server.submitted_answer
        revised = 'I changed my explanation while the first check was running.'
        self.command('fill', '#teach-answer', revised)
        self.server.release.set()
        self.wait("document.querySelector('.written-feedback') !== null")
        self.assertEqual(self.js("document.querySelector('#teach-answer').value"), revised)
        self.assertIn('previous answer', self.js("document.querySelector('.notice').textContent"))
        self.assertIn('Check my revision', self.js("document.querySelector('.flow-footer .primary').textContent"))
        stored = self.js("JSON.parse(localStorage.getItem('inside-inference-v1')).grades['lesson-map'].answer")
        self.assertEqual(stored, original)
        self.click('[data-self-check]')
        self.assertTrue(self.js("!!document.querySelector('.written-feedback') && !!document.querySelector('.self-check')"))

    def test_grade_can_finish_after_navigation_without_disabling_new_view(self):
        self.lesson_answer()
        self.server.release.clear()
        self.click('[data-grade-lesson]')
        self.assertTrue(self.server.started.wait(5))
        self.open('challenges/benchmark-claim')
        self.click('[data-review-step=write]')
        self.assertTrue(self.js("document.querySelector('.flow-footer .primary').disabled"))
        self.server.release.set()
        self.wait("document.querySelector('.flow-footer .primary').disabled === false")
        self.assertFalse(self.js("!!document.querySelector('.written-feedback')"))
        self.open('lesson/map')
        self.wait("document.querySelector('.written-feedback') !== null")
        self.assertTrue(self.js("!!document.querySelector('[data-finish-lesson].primary')"))

    def test_failed_grade_preserves_answer_and_allows_retry(self):
        self.lesson_answer()
        self.server.fail_grade = True
        self.click('[data-grade-lesson]')
        self.wait("document.querySelector('[role=alert]') !== null")
        self.assertIn('Deterministic test failure', self.js("document.querySelector('[role=alert]').textContent"))
        self.assertFalse(self.js("document.querySelector('.flow-footer .primary').disabled"))
        self.server.fail_grade = False
        self.click('[data-grade-lesson]')
        self.wait("document.querySelector('.written-feedback') !== null")
        self.assertTrue(self.js("!!document.querySelector('[data-finish-lesson].primary')"))

    def test_mobile_review_has_no_horizontal_overflow(self):
        self.command('set', 'viewport', '390', '844')
        self.open('challenges/stable-softmax')
        for step in ('background', 'change', 'predict', 'write'):
            self.click('[data-review-step=' + step + ']')
            self.assertLessEqual(self.js('document.documentElement.scrollWidth'), 390)
            self.assertEqual(self.js("document.querySelectorAll('.primary').length"), 1)
            self.assertLessEqual(self.js("document.querySelector('.flow-footer').getBoundingClientRect().right"), 390)

    def test_skip_link_focuses_current_content_without_changing_lesson(self):
        self.lesson_answer()
        self.js("document.querySelector('.skip').focus(); true")
        self.command('press', 'Enter')
        self.assertEqual(self.js('location.hash'), '#lesson/map')
        self.assertEqual(self.js('document.activeElement.id'), 'main')
        self.assertTrue(self.js("!!document.querySelector('#teach-answer')"))

    def test_quiz_leads_to_application_before_explanation(self):
        self.applied_activity('map')
        for name, value in [('weights', 'model'), ('batch', 'engine'), ('route', 'service')]:
            self.command('select', '#activity-' + name, value)
        self.click('[data-compare-activity]')
        self.assertIn('Check each connection.', self.js("document.querySelector('#activity-result').textContent"))
        self.assertEqual(self.js("document.querySelectorAll('.primary').length"), 1)
        self.click('.primary[data-next-explain]')
        self.assertTrue(self.js("!!document.querySelector('#teach-answer')"))
        self.assertIn('The inference engine', self.js("document.querySelector('.activity-notes').textContent"))
        self.click('.flow-footer [data-step=check]')
        self.assertTrue(self.js("!!document.querySelector('#activity-form')"))

    def test_worksheet_saves_one_prompt_at_a_time_and_carries_notes(self):
        self.applied_activity('artifacts')
        for index, text in enumerate(('Base R1 exact revision', 'Adapter A with config',
                                      'Tokenizer T1 and custom completion format', 'Prompt IDs [1,4]')):
            self.assertEqual(self.js("document.querySelectorAll('textarea').length"), 1)
            self.command('fill', '#activity-answer', text)
            self.assertEqual(self.js("document.querySelectorAll('.primary').length"), 1)
            if index < 3:
                self.click('.primary[data-activity-next]')
        self.click('[data-compare-activity]')
        self.assertIn('Compare your plan.', self.js("document.querySelector('#activity-result').textContent"))
        self.command('reload')
        self.wait("document.querySelector('#activity-answer') !== null")
        self.assertEqual(self.js("document.querySelector('#activity-answer').value"), 'Prompt IDs [1,4]')
        self.applied_activity('deploy')
        self.assertIn('Base R1 exact revision', self.js("document.querySelector('#activity-content').textContent"))

    def test_numerical_activity_and_comparison_invalidate_after_edit(self):
        self.applied_activity('correctness')
        self.command('fill', '#activity-difference', '0.005')
        self.command('select', '#activity-accept', 'no')
        self.click('[data-compare-activity]')
        self.assertNotIn('Revisit this one.', self.js("document.querySelector('#activity-result').textContent"))
        self.command('fill', '#activity-difference', '0.0005')
        self.assertTrue(self.js("!!document.querySelector('.primary[data-compare-activity]')"))
        self.click('[data-compare-activity]')
        self.assertIn('Revisit this one.', self.js("document.querySelector('#activity-result').textContent"))

    def test_workshop_requires_a_prediction_then_runs_the_edited_read(self):
        self.applied_activity('workshop')
        self.assertEqual(self.js("document.querySelector('#cache-start').value"), '1')
        self.assertTrue(self.js("document.querySelector('.cache-code').checkVisibility()"))
        self.click('.primary[data-run-cache-lab]')
        self.assertIn('Choose which positions', self.js("document.querySelector('#toast').textContent"))
        self.click('[name=cache-prediction][value=last]')
        self.click('.primary[data-run-cache-lab]')
        self.wait("document.querySelector('.cache-lab-result') !== null")
        self.assertIn('skipped information', self.js("document.querySelector('.cache-lab-result h2').textContent"))
        self.assertEqual(self.js("document.querySelector('.cache-lab-result [data-cache-position=\"0\"]').dataset.included"), 'false')
        self.command('select', '#cache-start', '0')
        self.assertFalse(self.js("document.querySelector('[name=cache-prediction]:checked') !== null"))
        self.assertIn('changed after', self.js("document.querySelector('#cache-lab-result').textContent"))
        self.click('[name=cache-prediction][value=both]')
        self.click('.primary[data-run-cache-lab]')
        self.wait("document.querySelector('.cache-lab-result h2')?.textContent.includes('repaired')")
        result = self.js("JSON.parse(localStorage.getItem('inside-inference-v1')).activities.workshop.cacheLab")
        self.assertTrue(result['lastRun']['matches'])
        self.assertEqual(result['lastRun']['start'], 0)
        self.assertEqual(result['firstAttempt']['start'], 1)
        self.assertFalse(result['firstAttempt']['matches'])
        self.command('reload')
        self.wait("document.querySelector('.cache-lab-result') !== null")
        self.assertEqual(self.js("document.querySelector('#cache-start').value"), '0')
        self.click('.primary[data-next-explain]')
        self.assertTrue(self.js("!!document.querySelector('#teach-answer')"))

    def test_worked_example_connects_positions_weights_and_scores(self):
        self.open('lesson/workshop')
        self.click('[data-next-example]')
        self.wait("document.querySelector('#cache-example-result .score-pair') !== null")
        self.assertEqual(self.js("document.querySelectorAll('#cache-example-result .cache-entry').length"), 1)
        self.assertIn('100.0%', self.js("document.querySelector('#cache-example-result').textContent"))
        self.click('[data-example-next]')
        self.assertEqual(self.js("document.querySelectorAll('#cache-example-result .cache-entry.included').length"), 2)
        self.click('[data-example-next]')
        self.assertEqual(self.js("document.querySelectorAll('#cache-example-result .cache-entry.excluded').length"), 1)
        self.assertIn('one key and one value', self.js("document.querySelector('#cache-example-result').textContent"))
        scores = self.js("[...document.querySelectorAll('#cache-example-result .score-pair b')].map(x=>x.textContent)")
        self.assertNotEqual(scores[0], scores[1])

    def test_new_workshop_keeps_prior_written_predictions(self):
        old = {'activities': {'workshop': {'part': 2, 'values': {
            'prediction-broken': 'My previous written reasoning'}, 'runs': {'broken': {'matches': False}}}}}
        self.js("localStorage.setItem('inside-inference-v1', " + json.dumps(json.dumps(old)) + "); true")
        self.command('reload')
        self.wait("document.querySelector('[data-step=learn]') !== null")
        record = self.js("JSON.parse(localStorage.getItem('inside-inference-v1')).activities.workshop")
        self.assertIn('My previous written reasoning', record['earlierNotes'])
        self.assertEqual(record['cacheLab']['start'], 1)
        self.assertNotIn('runs', record)

    def test_revised_workshop_does_not_reuse_old_question_checks_or_feedback(self):
        task = {k: v for k, v in BUNDLE.assessments.items() if k.startswith('lesson-')}['lesson-workshop']
        old = {'notes': {'teach-workshop': 'My earlier explanation'},
               'answers': {'work1': {'choice': 1, 'checked': True}},
               'grades': {'lesson-workshop': {'answer': 'My earlier explanation',
                   'meta': {'content_revision': BUNDLE.course['CONTENT_REVISION'],
                            'exercise_revision': BUNDLE.course['CONTENT_REVISION']},
                   'grade': {'summary': 'Older feedback', 'follow_up': 'Older question',
                             'criteria': [{'id': c['id'], 'verdict': 'missing',
                                           'evidence': '', 'feedback': 'Older feedback'}
                                          for c in task['criteria']]}}}}
        self.js("localStorage.setItem('inside-inference-v1', " + json.dumps(json.dumps(old)) + "); true")
        self.command('reload')
        self.command('open', self.origin + '/#lesson/workshop/check')
        self.wait("document.querySelector('.primary[data-submit-check]') !== null")
        self.command('open', self.origin + '/#lesson/workshop/explain')
        self.wait("document.querySelector('#teach-answer') !== null")
        self.assertIn('earlier version', self.js("document.querySelector('.written-feedback').textContent"))
        self.assertEqual(self.js("document.querySelector('#teach-answer').value"), 'My earlier explanation')
        self.command('open', self.origin + '/#lesson/workshop/learn')
        self.wait("document.querySelector('.cache-code') !== null")
        self.assertTrue(self.js("document.querySelector('.cache-code').checkVisibility()"))

    def test_full_reference_checks_run_inline_and_survive_reload(self):
        self.open('lesson/workshop')
        self.assertNotIn('open a terminal', self.js("document.querySelector('.prose').textContent"))
        self.click('[data-engine-tools] > summary')
        self.click('[data-run-reference-checks]')
        self.wait("document.querySelector('[data-reference-result]') !== null")
        self.assertEqual(self.js('location.hash'), '#lesson/workshop')
        self.assertIn('Learn', self.js("document.querySelector('.stepper [aria-current]').textContent"))
        self.assertEqual(self.js("document.querySelectorAll('[data-reference-result] tbody tr').length"), 5)
        self.assertIn('218 checks passed', self.js("document.querySelector('[data-reference-result]').textContent"))
        self.command('reload')
        self.wait("document.querySelector('[data-reference-result]') !== null")
        self.assertEqual(self.js("document.querySelectorAll('.primary').length"), 1)

    def test_code_is_visible_before_controls_and_full_function_is_optional(self):
        self.open('lesson/workshop')
        self.assertTrue(self.js("document.querySelector('.cache-code').checkVisibility()"))
        self.assertLess(self.js("document.querySelector('.cache-code').getBoundingClientRect().top"), 700)
        self.assertFalse(self.js("document.querySelector('[data-reference-checks-panel]').checkVisibility()"))
        self.assertIn('cache.keys[start:]', self.js("document.querySelector('.cache-code').textContent"))
        self.click('[data-engine-tools] > summary')
        self.wait("document.querySelector('[data-engine-code] pre') !== null")
        self.command('select', '#engine-function', 'cached_step')
        self.assertIn('broken_offset', self.js("document.querySelector('[data-engine-code] pre').textContent"))
        self.assertEqual(self.js("getComputedStyle(document.querySelector('[data-engine-code] pre code')).backgroundColor"), 'rgba(0, 0, 0, 0)')
        self.command('set', 'viewport', '390', '844')
        self.assertLessEqual(self.js('document.documentElement.scrollWidth'), 390)

    def test_failed_inline_run_is_distinct_from_saved_success(self):
        self.open('lesson/workshop')
        self.click('[data-engine-tools] > summary')
        self.click('[data-run-reference-checks]')
        self.wait("document.querySelector('[data-reference-result]') !== null")
        self.server.fail_workshop = True
        self.click('[data-run-reference-checks]')
        self.wait("document.querySelector('[data-reference-checks-panel] [role=alert]') !== null")
        message = self.js("document.querySelector('[data-reference-checks-panel] [role=alert]').textContent")
        self.assertIn('earlier attempt', message)
        self.assertIn('did not pass', message)
        self.assertFalse(self.js("document.querySelector('[data-run-reference-checks]').disabled"))

    def test_retired_page_is_removed_and_final_lesson_returns_to_own_activity(self):
        self.assertFalse(self.js("!!document.querySelector('a[href=\"#capstone\"]')"))
        self.command('open', self.origin + '/#capstone')
        self.wait("location.hash === '#home'")
        self.open('lesson/bench')
        self.lesson_answer()
        self.click('[data-self-check]')
        self.click('.primary[data-finish-lesson]')
        self.click('.primary[data-open-activity]')
        self.assertEqual(self.js('location.hash'), '#lesson/bench')
        self.assertTrue(self.js("!!document.querySelector('#activity-answer')"))

    def test_previous_project_notes_migrate_without_losing_other_answers(self):
        old = {'version': 3, 'notes': {'project-brief': 'Earlier experiment notes',
                                     'teach-map': 'Existing lesson answer'},
               'answers': {'map1': {'choice': 1, 'checked': True}}, 'capstone': {'0': True}}
        self.js("localStorage.setItem('inside-inference-v1', " + json.dumps(json.dumps(old)) + "); true")
        self.command('reload')
        self.wait("document.querySelector('[data-step=explain]') !== null")
        state = self.js("JSON.parse(localStorage.getItem('inside-inference-v1'))")
        self.assertEqual(state['activities']['bench']['earlierNotes'], 'Earlier experiment notes')
        self.assertEqual(state['notes']['teach-map'], 'Existing lesson answer')
        self.assertTrue(state['answers']['map1']['checked'])
        self.assertNotIn('project-brief', state['notes'])
        self.assertNotIn('capstone', state)

    def test_applied_activities_fit_mobile_one_prompt_at_a_time(self):
        self.command('set', 'viewport', '390', '844')
        for lesson in BUNDLE.course['LESSONS']:
            if not lesson.get('activity'):
                continue
            self.applied_activity(lesson['id'])
            self.assertLessEqual(self.js('document.documentElement.scrollWidth'), 390)
            self.assertEqual(self.js("document.querySelectorAll('.primary').length"), 1)
            self.assertLessEqual(self.js("document.querySelectorAll('textarea').length"), 1)


if __name__ == '__main__':
    unittest.main()
