"""Reject misleading or executable diagram data at the course boundary."""
import copy
import math
import unittest
from course_bundle import validate_visual

FUNNEL = {'kind': 'funnel', 'title': 'Three checks', 'caption': 'Invented example.', 'source_ids': [],
          'initial': 100, 'unit': 'parts', 'start_label': 'Start', 'adjustable_stage': 1,
          'stages': [{'label': 'Size', 'rate': .8}, {'label': 'Strength', 'rate': .5}, {'label': 'Final', 'rate': .75}]}


class VisualTests(unittest.TestCase):
    lesson = {'id': 'fixture', 'sources': ['read-source'], 'example': ['Setup', ['One', 'Two', 'Three']]}

    def test_valid_visual_and_absence(self):
        validate_visual(FUNNEL, self.lesson)
        validate_visual(None, self.lesson)

    def test_rejects_bad_rates_units_source_links_and_step_alignment(self):
        for field, value in [('initial', math.nan), ('initial', True), ('unit', ''),
                             ('source_ids', ['unread']), ('adjustable_stage', 3),
                             ('stages', FUNNEL['stages'][:2]), ('script', 'run()')]:
            visual = copy.deepcopy(FUNNEL)
            visual[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_visual(visual, self.lesson)
        for rate in [math.inf, math.nan, -.1, 1.01, True, '50%']:
            visual = copy.deepcopy(FUNNEL)
            visual['stages'][0]['rate'] = rate
            with self.subTest(rate=rate), self.assertRaises(ValueError):
                validate_visual(visual, self.lesson)

    def test_rejects_unknown_pattern_and_unordered_flow(self):
        for visual in [dict(FUNNEL, kind='html'),
                       {'kind':'flow','title':'Flow','caption':'Invented','source_ids':[],
                        'nodes':[{'label':'B','detail':'Later','step':2}, {'label':'A','detail':'Earlier','step':0}]}]:
            with self.assertRaises(ValueError):
                validate_visual(visual, self.lesson)
