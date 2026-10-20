#!/usr/bin/env python3
"""Archive-first, resumable same-site article crawl with explicit coverage.

python3 crawl.py URL --archive-at 20260606011913 --out local-courses/topic/sources
URLs outside --prefix are inventoried, not recursively crawled. No execution of JS.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import time
from urllib.parse import urljoin, urlparse, urlunparse, urlencode
from urllib.request import Request, urlopen


def unwrap(url):
    parsed = urlparse(url)
    if parsed.hostname == 'web.archive.org' and parsed.path.startswith('/web/'):
        pieces = parsed.path.split('/', 3)
        if len(pieces) == 4:
            return pieces[3] + ('?' + parsed.query if parsed.query else '')
    return url


def canonical(url):
    p = urlparse(unwrap(url))
    if p.scheme not in ('http', 'https') or not p.hostname:
        return None
    # Query parameters on these article URLs are tracking, not content identity.
    return urlunparse(('https', p.netloc.lower(), p.path.rstrip('/') or '/', '', '', ''))


class ArticleParser(HTMLParser):
    """Semantic text blocks and links; script/style/SVG content is never lesson text."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.blocks, self.links, self.current = [], [], []
        self.embeds, self.figures = [], []
        self.title, self.in_title = '', False

    def flush(self):
        text = ' '.join(' '.join(self.current).split())
        if text and text not in self.blocks:
            self.blocks.append(text)
        self.current = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'svg', 'noscript'):
            self.hidden += 1
        if self.hidden:
            return
        if tag == 'title':
            self.in_title = True
        if tag in ('p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote', 'tr', 'br'):
            self.flush()
        if tag == 'a':
            href = dict(attrs).get('href')
            if href:
                self.links.append(href)
        if tag in ('iframe', 'video', 'source'):
            self.embeds.append({'tag': tag, **{k: v for k, v in attrs if k in ('src', 'title')}})
        if tag == 'img':
            self.figures.append({k: v for k, v in attrs if k in ('src', 'alt')})

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'svg', 'noscript'):
            self.hidden = max(0, self.hidden - 1)
        if tag == 'title':
            self.in_title = False
        if not self.hidden and tag in ('p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote', 'tr', 'div', 'section', 'article'):
            self.flush()

    def handle_data(self, data):
        if not self.hidden:
            if self.in_title:
                self.title += data
            else:
                self.current.append(data)


class Crawler:
    def __init__(self, seed, out, timestamp=None, prefix='/blog', delay=0.7, attempts=3):
        self.seed = canonical(seed)
        self.out = Path(out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.timestamp, self.prefix = timestamp, prefix.rstrip('/')
        self.host = urlparse(self.seed).hostname.removeprefix('www.')
        self.delay, self.attempts = delay, attempts
        manifest = self.out / 'manifest.json'
        self.data = json.loads(manifest.read_text()) if manifest.exists() else {
            'seed': self.seed, 'archive_at': timestamp, 'prefix': prefix,
            'scope': 'Nearest available captures to archive_at; archive index plus all reachable same-site article links under prefix; external references are inventoried only.',
            'index': {}, 'pages': {}, 'references': {}}
        if (self.data['seed'], self.data['archive_at'], self.data['prefix']) != (self.seed, timestamp, prefix):
            raise ValueError('Output directory belongs to a different crawl')

    def request(self, url):
        error = None
        for attempt in range(self.attempts):
            time.sleep(self.delay * (attempt + 1))
            try:
                with urlopen(Request(url, headers={'User-Agent': 'Noema/0.1 (personal learning archive)'}), timeout=35) as r:
                    raw = r.read(8_000_001)
                    if len(raw) > 8_000_000:
                        raise ValueError('Response exceeded 8 MB; coverage is partial')
                    return raw, r.geturl(), r.headers.get('Content-Type', '')
            except Exception as e:
                error = e
        raise RuntimeError(str(error))

    def json(self, url):
        return json.loads(self.request(url)[0])

    def add(self, url, discovered_by):
        url = canonical(url)
        if not url:
            return
        p = urlparse(url)
        same_site = p.hostname.removeprefix('www.') == self.host
        if same_site and (p.path == self.prefix or p.path.startswith(self.prefix + '/')):
            entry = self.data['pages'].setdefault(url, {'status': 'pending', 'discovered_by': []})
        else:
            entry = self.data['references'].setdefault(url, {'status': 'outside_article_scope', 'discovered_by': []})
        if discovered_by not in entry['discovered_by']:
            entry['discovered_by'].append(discovered_by)

    def discover_index(self):
        if not self.timestamp:
            return
        query = {'url': self.host + self.prefix + '*', 'output': 'json', 'filter': 'statuscode:200',
                 'collapse': 'urlkey'}
        url = 'https://web.archive.org/cdx/search/cdx?' + urlencode(query)
        try:
            rows = self.json(url)
            self.data['index'] = {'status': 'fetched', 'url': url, 'entries': len(rows) - 1}
            for row in rows[1:]:
                self.add(row[2], 'archive-index')
        except Exception as error:
            self.data['index'] = {'status': 'unavailable', 'url': url, 'error': str(error)}

    def capture(self, url):
        response = self.json('https://archive.org/wayback/available?' + urlencode({'url': url, 'timestamp': self.timestamp}))
        closest = response.get('archived_snapshots', {}).get('closest')
        if not closest or not closest.get('available'):
            raise ValueError('No available archive capture')
        stamp = closest['timestamp']
        original = unwrap(closest['url'])
        return 'https://web.archive.org/web/' + stamp + 'id_/' + original, stamp

    def fetch_page(self, url, entry):
        try:
            target, stamp = self.capture(url) if self.timestamp else (url, None)
            raw, final, mime = self.request(target)
            if 'html' not in mime:
                raise ValueError('Expected HTML, received ' + mime)
            p = ArticleParser()
            p.feed(raw.decode('utf-8', errors='replace'))
            p.flush()
            text = '\n\n'.join(p.blocks)
            if len(text) < 200:
                raise ValueError('Too little readable text; inspect page manually')
            key = hashlib.sha256(url.encode()).hexdigest()[:16]
            (self.out / (key + '.html')).write_bytes(raw)
            (self.out / (key + '.txt')).write_text(text)
            links = sorted({u for href in p.links if (u := canonical(urljoin(url, unwrap(href))))})
            entry.update(status='fetched', title=p.title.strip(), capture=stamp, fetched_url=final,
                         raw_sha256=hashlib.sha256(raw).hexdigest(), text_sha256=hashlib.sha256(text.encode()).hexdigest(),
                         text_file=key + '.txt', html_file=key + '.html', words=len(text.split()), links=links)
            entry.update(embeds=p.embeds, figures=p.figures)
            for link in links:
                self.add(link, url)
        except Exception as error:
            entry.update(status='unavailable', error=str(error))
        self.save()
        print(entry['status'], url, flush=True)

    def save(self):
        entries = list(self.data['pages'].values())
        pending = sum(e['status'] == 'pending' for e in entries)
        failed = sum(e['status'] != 'fetched' for e in entries)
        index_ok = not self.timestamp or self.data['index'].get('status') == 'fetched'
        self.data['coverage'] = {'kind': 'complete' if not failed and index_ok else 'partial',
                                 'settled': pending == 0, 'pages': len(entries),
                                 'fetched': sum(e['status'] == 'fetched' for e in entries),
                                 'unavailable': sum(e['status'] == 'unavailable' for e in entries),
                                 'pending': pending, 'index_checked': index_ok,
                                 'external_references': len(self.data['references'])}
        (self.out / 'manifest.json').write_text(json.dumps(self.data, indent=2, ensure_ascii=False) + '\n')

    def run(self, retry=False):
        self.add(self.seed, 'user')
        self.add(urljoin(self.seed, self.prefix), 'blog-index')
        self.discover_index()
        if retry:
            for e in self.data['pages'].values():
                if e['status'] == 'unavailable':
                    e['status'] = 'pending'
        while True:
            item = next(((u, e) for u, e in self.data['pages'].items() if e['status'] == 'pending'), None)
            if item is None:
                break
            self.fetch_page(*item)
        self.save()
        print(json.dumps(self.data['coverage']), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('url')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--archive-at')
    p.add_argument('--prefix', default='/blog')
    p.add_argument('--retry-unavailable', action='store_true')
    args = p.parse_args()
    Crawler(args.url, args.out, args.archive_at, args.prefix).run(args.retry_unavailable)


if __name__ == '__main__':
    main()
