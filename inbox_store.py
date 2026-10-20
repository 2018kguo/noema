"""Persistent local link queue. Claims and publication are fenced by an expiring lease."""
from contextlib import contextmanager
import ipaddress
import json
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
import uuid

ACTIVE = ('researching', 'writing', 'checking')


def normalize_link(value):
    if not isinstance(value, str) or len(value) > 4000:
        raise ValueError('Paste a valid link.')
    parts = urlsplit(value.strip())
    if parts.scheme not in ('https', 'http') or not parts.hostname or parts.username or parts.password:
        raise ValueError('Use a public http or https link.')
    if parts.port not in (None, 80, 443) or parts.hostname in ('localhost', 'localhost.localdomain'):
        raise ValueError('Use a public web page link.')
    try:
        address = ipaddress.ip_address(parts.hostname)
    except ValueError:
        if '.' not in parts.hostname:
            raise ValueError('Use a public web page link.')
    else:
        if not address.is_global:
            raise ValueError('Use a public web page link.')
    host = parts.hostname.lower()
    if host in ('www.twitter.com', 'twitter.com', 'www.x.com'):
        host = 'x.com'
    social_tracking = {'s', 't', 'ref_src'} if host == 'x.com' else set()
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.startswith('utm_') and k not in social_tracking])
    return urlunsplit((parts.scheme, host, parts.path.rstrip('/') or '/', query, ''))


class InboxStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / 'inbox.sqlite3'
        with self.connection() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS items (
                  id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
                  note TEXT NOT NULL, source_text TEXT NOT NULL, source_dir TEXT,
                  state TEXT NOT NULL, message TEXT NOT NULL, created REAL NOT NULL,
                  updated REAL NOT NULL, owner TEXT, lease_until REAL,
                  course_path TEXT, revision INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS events (
                  item_id TEXT NOT NULL, at REAL NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (
                  id INTEGER PRIMARY KEY CHECK(id=1), provider TEXT NOT NULL,
                  model TEXT NOT NULL, enabled INTEGER NOT NULL
                );
                INSERT OR IGNORE INTO settings VALUES (1, 'none', '', 0);
            ''')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def settings(self):
        with self.connection() as db:
            value = dict(db.execute('SELECT provider, model, enabled FROM settings WHERE id=1').fetchone())
        value['enabled'] = bool(value['enabled'])
        return value

    def configure(self, provider, model, enabled):
        if provider not in ('none', 'claude', 'codex') or not isinstance(model, str) or len(model) > 120 or type(enabled) is not bool:
            raise ValueError('Choose a supported generation provider and model.')
        if enabled and provider == 'none':
            raise ValueError('Choose Claude or Codex before starting the queue.')
        with self.connection() as db:
            db.execute('UPDATE settings SET provider=?, model=?, enabled=? WHERE id=1', (provider, model.strip(), int(enabled)))
        return self.settings()

    def add(self, url, note='', source_text='', source_dir=None):
        url = normalize_link(url)
        if not isinstance(note, str) or len(note) > 4000 or not isinstance(source_text, str) or len(source_text) > 100000:
            raise ValueError('Keep your note under 4,000 characters and pasted text under 100,000.')
        now, item_id = time.time(), uuid.uuid4().hex[:16]
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT * FROM items WHERE url=?', (url,)).fetchone()
            if existing:
                return dict(existing), False
            title = urlsplit(url).hostname + urlsplit(url).path
            db.execute('INSERT INTO items (id,url,title,note,source_text,source_dir,state,message,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (item_id, url, title, note.strip(), source_text.strip(), str(source_dir) if source_dir else None,
                        'queued', 'Waiting to be prepared.', now, now))
            db.execute('INSERT INTO events VALUES (?,?,?,?)', (item_id, now, 'queued', 'Added to your inbox.'))
        return self.get(item_id), True

    def get(self, item_id):
        with self.connection() as db:
            row = db.execute('SELECT * FROM items WHERE id=?', (item_id,)).fetchone()
        if row is None:
            raise ValueError('This inbox item no longer exists.')
        return dict(row)

    def list(self):
        with self.connection() as db:
            return [dict(row) for row in db.execute('SELECT * FROM items ORDER BY created DESC')]

    def events(self, item_id):
        with self.connection() as db:
            return [dict(row) for row in db.execute('SELECT at,state,message FROM events WHERE item_id=? ORDER BY at', (item_id,))]

    def claim(self, owner, now=None):
        now = time.time() if now is None else now
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            # One active preparation per library, even if two server processes are open.
            if db.execute("SELECT 1 FROM items WHERE state IN ('researching','writing','checking') AND lease_until>?", (now,)).fetchone():
                return None
            row = db.execute("SELECT * FROM items WHERE state='queued' OR (state IN ('researching','writing','checking') AND lease_until<=?) ORDER BY created LIMIT 1", (now,)).fetchone()
            if row is None:
                return None
            db.execute("UPDATE items SET state='researching', message='Reading the source and its context.', owner=?, lease_until=?, updated=? WHERE id=?", (owner, now + 60, now, row['id']))
            db.execute('INSERT INTO events VALUES (?,?,?,?)', (row['id'], now, 'researching', 'Reading the source and its context.'))
        return self.get(row['id'])

    def heartbeat(self, item_id, owner):
        with self.connection() as db:
            changed = db.execute("UPDATE items SET lease_until=? WHERE id=? AND owner=? AND state IN ('researching','writing','checking') AND lease_until>?", (time.time() + 60, item_id, owner, time.time())).rowcount
        return changed == 1

    def owned(self, item_id, owner):
        item = self.get(item_id)
        return item['owner'] == owner and item['state'] in ACTIVE and (item['lease_until'] or 0) > time.time()

    def advance(self, item_id, owner, state, message, title=None, course_path=None):
        if state not in (*ACTIVE, 'ready', 'needs_input', 'failed', 'queued'):
            raise ValueError('Invalid worker state.')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM items WHERE id=?', (item_id,)).fetchone()
            if row is None or row['owner'] != owner or row['state'] not in ACTIVE or (row['lease_until'] or 0) <= time.time():
                return False
            done = state not in ACTIVE
            db.execute('UPDATE items SET state=?,message=?,updated=?,title=?,course_path=?,owner=?,lease_until=? WHERE id=?',
                       (state, message, time.time(), title or row['title'], str(course_path) if course_path else row['course_path'],
                        None if done else owner, None if done else time.time() + 60, item_id))
            db.execute('INSERT INTO events VALUES (?,?,?,?)', (item_id, time.time(), state, message))
        return True

    def action(self, item_id, action, source_text=None, note=None):
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM items WHERE id=?', (item_id,)).fetchone()
            if row is None:
                raise ValueError('This item no longer exists.')
            if action == 'cancel' and row['state'] in ('queued', *ACTIVE):
                state, message = 'cancelled', 'Preparation stopped. You can retry it later.'
            elif action in ('retry', 'provide_text') and row['state'] in ('failed', 'needs_input', 'cancelled'):
                if action == 'provide_text' and (not isinstance(source_text, str) or not 100 <= len(source_text.strip()) <= 100000):
                    raise ValueError('Paste at least 100 characters of the source, up to 100,000.')
                state, message = 'queued', 'Waiting to be prepared.'
            else:
                raise ValueError('This action is not available for the item’s current state.')
            text = source_text.strip() if action == 'provide_text' else row['source_text']
            revision = row['revision'] + (1 if action == 'provide_text' else 0)
            db.execute('UPDATE items SET state=?,message=?,source_text=?,revision=?,updated=?,owner=NULL,lease_until=NULL WHERE id=?',
                       (state, message, text, revision, time.time(), item_id))
            db.execute('INSERT INTO events VALUES (?,?,?,?)', (item_id, time.time(), state, message))
        return self.get(item_id)

    def projection(self, item):
        value = {k: item[k] for k in ('id', 'url', 'title', 'note', 'state', 'message', 'created', 'updated')}
        value['course_url'] = '/learn/' + item['id'] + '/' if item['state'] == 'ready' else None
        return value
