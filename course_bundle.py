"""Load trusted, locally authored course bundles; validate their cross references."""
import json
from dataclasses import dataclass
from pathlib import Path
import re
import math

READER_ASSETS = ('index.html', 'app.js', 'style.css', 'lesson-ui.css', 'visuals.js',
                 'vendor/components.js', 'vendor/components.js.LEGAL.txt', 'vendor/theme.css',
                 'vendor/Web-Awesome-LICENSE.md', 'vendor/Lit-LICENSE.txt', 'vendor/manifest.json')


def validate_visual(visual, lesson):
    """Validate diagram data before serving it; visuals cannot supply code or markup."""
    if visual is None:
        return
    def require(ok, message):
        if not ok:
            raise ValueError(lesson['id'] + ': visual ' + message)
    def text(value):
        return isinstance(value, str) and 0 < len(value.strip()) <= 1500
    def number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    require(isinstance(visual, dict), 'must be an object')
    kind = visual.get('kind')
    require(kind in ('funnel', 'flow'), 'kind must be funnel or flow')
    common = {'kind', 'title', 'caption', 'source_ids'}
    fields = {'initial', 'unit', 'start_label', 'stages', 'adjustable_stage'} if kind == 'funnel' else {'nodes'}
    require(set(visual) == common | fields, 'has missing or unknown fields')
    require(text(visual['title']) and text(visual['caption']), 'needs a title and explanatory caption')
    require(isinstance(visual['source_ids'], list) and all(isinstance(x, str) for x in visual['source_ids']) and
            set(visual['source_ids']) <= set(lesson['sources']), 'references an unknown lesson source')
    steps = len(lesson['example'][1])
    if kind == 'funnel':
        require(number(visual['initial']) and 0 < visual['initial'] <= 1e12, 'needs a positive, bounded starting count')
        require(text(visual['unit']) and text(visual['start_label']), 'needs units and a starting label')
        require(isinstance(visual['stages'], list) and len(visual['stages']) == steps, 'must have one gate per example step')
        require(type(visual['adjustable_stage']) is int and 0 <= visual['adjustable_stage'] < steps, 'has an invalid adjustable gate')
        for stage in visual['stages']:
            require(isinstance(stage, dict) and set(stage) == {'label', 'rate'}, 'gate needs a label and rate')
            require(text(stage['label']) and number(stage['rate']) and 0 <= stage['rate'] <= 1, 'rate must be between 0 and 1')
    else:
        nodes = visual['nodes']
        require(isinstance(nodes, list) and 2 <= len(nodes) <= 6, 'flow needs two to six nodes')
        for node in nodes:
            require(isinstance(node, dict) and set(node) == {'label', 'detail', 'step'}, 'node needs label, detail and step')
            require(text(node['label']) and text(node['detail']) and type(node['step']) is int and
                    0 <= node['step'] < steps, 'has an invalid flow node')
        require([n['step'] for n in nodes] == sorted(n['step'] for n in nodes), 'flow nodes must follow example order')


@dataclass
class CourseBundle:
    path: Path
    course: dict
    challenges: dict
    assessments: dict


def load_bundle(path):
    path = Path(path).resolve()
    course = json.loads((path / 'course.json').read_text())
    challenges = json.loads((path / 'challenges.json').read_text())
    validate(course, challenges)
    tasks = {('lesson-' + lesson['id']): {
        'id': 'lesson-' + lesson['id'], 'title': lesson['title'],
        'prompt': lesson['transfer'][0],
        'revision': lesson.get('assessment_revision', course['CONTENT_REVISION']),
        'artifact': 'Explain the idea in your own words; use a concrete example where helpful.',
        'context': '\n'.join(lesson['layers']), 'repo_paths': [],
        'criteria': [{'id': 'reason-' + str(i), 'label': rule,
                      'rule': 'The answer correctly demonstrates this requirement: ' + rule,
                      'feedback': 'Make this reasoning explicit: ' + rule}
                     for i, rule in enumerate(lesson['transfer'][1])],
        'follow_up': lesson['predict']
    } for lesson in course['LESSONS']}
    indexed = {x['id']: x for x in challenges}
    return CourseBundle(path, course, indexed, {**indexed, **tasks})


def validate(course, challenges):
    """Fail at startup on broken lesson/source/rubric links, before learners lose work."""
    def require(ok, message):
        if not ok:
            raise ValueError(message)

    def text(value):
        return isinstance(value, str) and bool(value.strip())

    meta = course['META']
    for key in ('id', 'title', 'heading', 'introduction', 'eyebrow', 'start_label', 'footnote', 'about_html'):
        require(text(meta.get(key)), 'META.' + key + ' must be nonempty text')
    require(bool(re.fullmatch(r'[a-z0-9][a-z0-9-]*', meta['id'])), 'Use a lowercase course id')
    require(len(meta['depth_labels']) == 2 and all(map(text, meta['depth_labels'])), 'Supply two depth labels')
    require(text(course['CONTENT_REVISION']), 'Supply a content revision')
    require(isinstance(course['LESSONS'], list) and course['LESSONS'], 'Supply lessons')
    ids = [x['id'] for x in course['LESSONS']]
    require(len(ids) == len(set(ids)), 'Duplicate lesson id')
    for key, source in course['SOURCES'].items():
        require(len(source) == 3 and all(map(text, source)), 'Invalid source: ' + key)
        require(source[1].startswith(('https://', 'http://')), 'Source needs an HTTP URL: ' + key)
    question_ids = set()
    for lesson in course['LESSONS']:
        label = lesson['id']
        for key in ('title', 'phase', 'goal', 'recall', 'predict', 'takeaway'):
            require(text(lesson[key]), label + ': missing ' + key)
        require(set(lesson['needs']) <= set(ids), label + ': unknown prerequisite')
        require(set(lesson['sources']) <= set(course['SOURCES']), label + ': unknown source')
        require(len(lesson['layers']) == 3 and all(map(text, lesson['layers'])), label + ': need three depth layers')
        require(len(lesson['example']) == 2 and len(lesson['example'][1]) >= 2, label + ': need a worked example')
        validate_visual(lesson.get('visual'), lesson)
        require(len(lesson['questions']) == 3, label + ': need three questions, one per depth level')
        require(len(lesson['transfer']) == 3 and lesson['transfer'][1], label + ': need transfer prompt, rubric, example')
        for q in lesson['questions']:
            require(q['id'] not in question_ids, 'Duplicate question id: ' + q['id'])
            question_ids.add(q['id'])
            require(len(q['options']) >= 2 and type(q['correct']) is int and 0 <= q['correct'] < len(q['options']), label + ': invalid answer index')
            for key in ('prompt', 'why', 'hint'):
                require(text(q[key]), label + ': question needs ' + key)
        activity = lesson.get('activity')
        if activity:
            require(activity['kind'] in ('workshop', 'check', 'worksheet'), label + ': unknown activity kind')
            if activity['kind'] == 'workshop':
                require(label == 'workshop' and 'tiny-engine' in course.get('LABS', []), 'The cache lab requires the tiny-engine plugin and workshop lesson id')
    challenge_ids = [c['id'] for c in challenges]
    require(len(challenge_ids) == len(set(challenge_ids)), 'Duplicate challenge id')
    for c in challenges:
        require(not c['id'].startswith('lesson-'), 'Challenge ids cannot use the reserved lesson- prefix')
        require(set(c['guide']['needs']) <= set(ids), c['id'] + ': unknown prerequisite')
        require(c['criteria'] and len({r['id'] for r in c['criteria']}) == len(c['criteria']), c['id'] + ': duplicate or absent criteria')
        for key in ('title', 'prompt', 'context', 'artifact', 'solution', 'revision'):
            require(text(c[key]), c['id'] + ': missing ' + key)
    require(set(course.get('LABS', [])) <= {'tiny-engine'}, 'Unknown executable lab')
    for card in course['CARDS']:
        require(len(card) == 4 and all(map(text, card)) and card[3] in ids, 'Invalid recall card or lesson link')
    require(isinstance(course['GLOSSARY'], dict) and all(map(text, course['GLOSSARY'].values())), 'Invalid glossary')
