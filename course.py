#!/usr/bin/env python3
"""Validate, scaffold, and share a course without copying private source files."""
import argparse
import json
from pathlib import Path
import zipfile
from course_bundle import load_bundle, READER_ASSETS

ROOT = Path(__file__).resolve().parent
RUNTIME = ('serve.py', 'course_bundle.py', 'structured_cli.py', 'tiny_engine.py') + READER_ASSETS


def bundle(course_path, destination):
    selected = load_bundle(course_path)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Deliberate allowlist: raw sources, progress, provider config and keys never enter a share bundle.
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in RUNTIME:
            archive.write(ROOT / name, name)
        for name in ('course.json', 'challenges.json'):
            archive.write(selected.path / name, 'course/' + name)
        archive.write(ROOT / 'LICENSE', 'LICENSE')
        archive.writestr('README.txt', 'Unzip this folder. Requires Python 3.9+.\n'
            'Run: python3 serve.py --course course\n'
            'Open: http://127.0.0.1:8765\n\n'
            'Explanations, quizzes and self-comparison work without an AI account.\n'
            'Optional: append --provider claude --model haiku or --provider codex.\n'
            'The recipient uses their own installed/signed-in CLI and account limits.\n'
            'Do not expose this local grader server on a public port.\n'
            'Source links are included. Raw crawl files and browser progress are excluded.\n')
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    validate = commands.add_parser('validate')
    validate.add_argument('course', type=Path)
    share = commands.add_parser('bundle')
    share.add_argument('course', type=Path)
    share.add_argument('--out', type=Path, required=True)
    init = commands.add_parser('init')
    init.add_argument('course', type=Path)
    init.add_argument('--id', required=True)
    init.add_argument('--title', required=True)
    args = parser.parse_args()
    if args.command == 'bundle':
        print(bundle(args.course, args.out))
    elif args.command == 'validate':
        value = load_bundle(args.course)
        print(f"Valid: {len(value.course['LESSONS'])} lessons, {len(value.challenges)} review scenarios")
    else:
        args.course.mkdir(parents=True, exist_ok=False)
        value = {'META': {'id': args.id, 'title': args.title, 'eyebrow': 'YOUR COURSE',
                 'heading': args.title, 'introduction': '', 'start_label': 'START HERE',
                 'footnote': '', 'depth_labels': ['Show me the mechanism', 'Help me judge the evidence'],
                 'about_html': ''}, 'CONTENT_REVISION': 'draft-1', 'LABS': [],
                 'SOURCES': {}, 'LESSONS': [], 'CARDS': [], 'GLOSSARY': {}}
        (args.course / 'course.json').write_text(json.dumps(value, indent=2) + '\n')
        (args.course / 'challenges.json').write_text('[]\n')
        print('Draft created. Author lessons using docs/AUTHORING.md; validate before serving.')


if __name__ == '__main__':
    main()
