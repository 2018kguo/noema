#!/usr/bin/env python3
"""Use the same local inbox from a terminal or coding agent."""
import argparse
import json
from pathlib import Path
from inbox_store import InboxStore
from course import bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path(__file__).resolve().parent / 'local-data')
    commands = parser.add_subparsers(dest='command', required=True)
    add = commands.add_parser('add')
    add.add_argument('url')
    add.add_argument('--note', default='')
    add.add_argument('--text-file', type=Path)
    add.add_argument('--sources', type=Path, help='An already collected crawl directory with manifest.json')
    commands.add_parser('status')
    share = commands.add_parser('bundle')
    share.add_argument('id')
    share.add_argument('--out', type=Path, required=True)
    action = commands.add_parser('retry')
    action.add_argument('id')
    args = parser.parse_args()
    store = InboxStore(args.data)
    if args.command == 'add':
        item, fresh = store.add(args.url, args.note, args.text_file.read_text() if args.text_file else '', args.sources)
        print(json.dumps({'added': fresh, **store.projection(item)}, ensure_ascii=False, indent=2))
    elif args.command == 'status':
        print(json.dumps({'settings': store.settings(), 'items': [store.projection(item) for item in store.list()]}, ensure_ascii=False, indent=2))
    elif args.command == 'retry':
        print(json.dumps(store.projection(store.action(args.id, 'retry')), ensure_ascii=False, indent=2))
    else:
        item = store.get(args.id)
        if item['state'] != 'ready' or not item['course_path']:
            parser.error('This course is not ready to share yet.')
        print(bundle(item['course_path'], args.out))


if __name__ == '__main__':
    main()
