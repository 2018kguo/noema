#!/usr/bin/env python3
"""Live smoke evaluation on authored examples. Not a calibrated grader benchmark.

Uses the selected provider/account. No automatic fallback or extra provider calls.
Examples: python3 evaluate_grader.py --provider claude --model haiku
          python3 evaluate_grader.py --provider codex
"""
import argparse
import json
from serve import ROOT, assess
from course_bundle import load_bundle
BUNDLE = load_bundle(ROOT / "courses/deepinfer")

FIXTURES = [
    {'name': 'strong cache review', 'id': 'cache-key', 'minimum_met': 4, 'maximum_met': 4,
     'answer': 'The key aliases different numerical computations. Run prompt IDs [1,2,3] under attention-changing adapter A, then the same IDs under adapter B: B can reuse A’s KV and obtain wrong logits. Restore immutable base revision and adapter identity, plus other state-affecting settings, in the cache namespace. Compare A then B then A on the same token IDs against separate uncached reference logits; also test a valid same-model cache hit.'},
    {'name': 'confident but wrong cache review', 'id': 'cache-key', 'minimum_met': 0, 'maximum_met': 0,
     'answer': 'This is safe because same shapes mean same values. KV contains only raw token IDs, so adapters cannot matter. A high hit rate proves correctness. I would check tuple length and HTTP 200; no reference comparison is needed.'},
    {'name': 'strong prefix-probability review', 'id': 'prefix-sum', 'minimum_met': 4, 'maximum_met': 4,
     'answer': 'Later drafts contribute only if every earlier draft survives. For conditional rates [0.5,0.5], the accepted-draft expectation is 0.5+0.25=0.75, while the patch says 1.0. Restore a running cumulative product and sum those products; this excludes target correction or bonus tokens. Compare to independent enumeration on mixed rates, [0,1] and [1,1].'}
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--provider', choices=['codex', 'claude', 'openrouter', 'jev'], required=True)
    parser.add_argument('--model', default='')
    args = parser.parse_args()
    if args.provider == 'jev':
        parser.error('This smoke suite expects generative rubric verdicts. Jev needs separately labeled criterion-probability evaluation; no pass threshold is calibrated.')
    failures = 0
    for fixture in FIXTURES:
        result = assess(BUNDLE.challenges[fixture['id']], fixture['answer'], args.provider, args.model)
        met = sum(row['verdict'] == 'met' for row in result['grade']['criteria'])
        passed = fixture['minimum_met'] <= met <= fixture['maximum_met']
        failures += not passed
        print(json.dumps({'fixture': fixture['name'], 'met': met, 'smoke_expectation_met': passed,
                          'provider': result['meta']['provider'], 'model': result['meta']['model'],
                          'seconds': result['meta']['seconds']}), flush=True)
    print('These authored examples test obvious cases; they do not establish calibration, robustness or grading accuracy.')
    raise SystemExit(1 if failures else 0)


if __name__ == '__main__':
    main()
