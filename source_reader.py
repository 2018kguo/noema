"""Bounded public-page reads and explicit source coverage for inbox items."""
import hashlib
import ipaddress
import json
from pathlib import Path
import socket
from urllib.parse import urlsplit, urljoin, urlencode, quote
from urllib.request import HTTPRedirectHandler, Request, build_opener
from crawl import ArticleParser, unwrap


class NeedsInput(ValueError):
    pass


def public_url(url):
    p = urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password or p.port not in (None, 80, 443):
        raise ValueError('Only public http and https pages can be read.')
    addresses = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError('This link resolves to a private network address.')
    return url


class PublicRedirects(HTTPRedirectHandler):
    http_error_308 = HTTPRedirectHandler.http_error_302

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    public_url(url)
    with build_opener(PublicRedirects()).open(Request(url, headers={'User-Agent': 'Noema/0.1 personal learning'}), timeout=30) as response:
        raw = response.read(4_000_001)
        if len(raw) > 4_000_000:
            raise NeedsInput('This page is too large to read here. Paste the section you want to study.')
        mime = response.headers.get('Content-Type', '')
        if not any(kind in mime for kind in ('html', 'text/plain', 'json')):
            raise NeedsInput('This link needs a text version. Paste an excerpt or link to the article’s HTML page.')
        return raw.decode('utf-8', errors='replace'), response.geturl()


def document(url, raw, min_words=60):
    parser = ArticleParser()
    parser.feed(raw)
    parser.flush()
    text = '\n\n'.join(parser.blocks)
    if len(text.split()) < min_words:
        raise NeedsInput('There is too little readable text on this page. Paste the post or article text below.')
    return {'url': url, 'title': parser.title.strip() or urlsplit(unwrap(url)).path.rsplit('/', 1)[-1].replace('-', ' ').capitalize(),
            'text': text, 'sha256': hashlib.sha256(text.encode()).hexdigest(),
            'links': sorted({urljoin(unwrap(url), href) for href in parser.links if urljoin(unwrap(url), href).startswith(('https://', 'http://'))}),
            'embeds': parser.embeds}


def collect(item, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    saved = output / 'reading.json'
    if saved.exists():
        return json.loads(saved.read_text())
    documents, gaps = [], []
    if item['source_text']:
        text = item['source_text']
        documents = [{'url': item['url'], 'title': 'Text supplied with your link', 'text': text,
                      'sha256': hashlib.sha256(text.encode()).hexdigest(), 'links': [], 'embeds': []}]
        scope = 'The pasted excerpt only; no claim to have read the whole post, thread, or linked pages.'
    elif item.get('source_dir'):
        corpus = Path(item['source_dir'])
        manifest = json.loads((corpus / 'manifest.json').read_text())
        seen = set()
        for url, entry in manifest['pages'].items():
            path = urlsplit(url).path.rstrip('/')
            if path in seen or path in ('/blog', ''):
                continue
            seen.add(path)
            if entry['status'] != 'fetched':
                gaps.append(url + ': ' + entry['status'])
                continue
            text = (corpus / entry['text_file']).read_text()
            archived = 'https://web.archive.org/web/' + entry['capture'] + '/' + url if entry.get('capture') else url
            documents.append({'url': archived, 'title': entry.get('title') or path.rsplit('/', 1)[-1].replace('-', ' ').capitalize(),
                              'text': text, 'sha256': entry['text_sha256'], 'links': entry.get('links', []), 'embeds': entry.get('embeds', [])})
        extra = corpus / 'background.json'
        if extra.exists():
            documents.extend(json.loads(extra.read_text()))
        scope = manifest['scope'] + ' Archive discovery coverage: ' + json.dumps(manifest['coverage'])
    else:
        try:
            host = urlsplit(item['url']).hostname
            if host in ('x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'):
                raw, _ = fetch('https://publish.twitter.com/oembed?' + urlencode({'url': item['url'], 'omit_script': 'true'}))
                documents = [document(item['url'], json.loads(raw)['html'], min_words=12)]
                scope = 'The single publicly embedded post and up to two linked pages. Its full thread and replies were not read.'
                linked = [u for u in documents[0]['links'] if urlsplit(u).hostname not in ('x.com', 'twitter.com', 'www.x.com', 'www.twitter.com')]
                for link in linked[:2]:
                    try:
                        content, resolved = fetch(link)
                        documents.append(document(resolved, content))
                    except Exception as error:
                        gaps.append(link + ': ' + str(error))
            elif host == 'github.com' and len(urlsplit(item['url']).path.strip('/').split('/')) >= 2:
                parts = urlsplit(item['url']).path.strip('/').split('/')
                owner, repo = parts[:2]
                revision = parts[3] if len(parts) >= 4 and parts[2] in ('blob', 'tree') else 'HEAD'
                api_base = 'https://api.github.com/repos/' + owner + '/' + repo
                raw, _ = fetch(api_base + '/commits/' + quote(revision, safe=''))
                commit = json.loads(raw)['sha']
                raw, _ = fetch(api_base + '/git/trees/' + commit + '?recursive=1')
                tree = json.loads(raw)
                paths = [e['path'] for e in tree.get('tree', []) if e['type'] == 'blob' and e.get('size', 0) <= 50000]
                readmes = [p for p in paths if p.lower() in ('readme.md', 'readme.rst', 'readme')]
                requested = '/'.join(parts[4:]) if len(parts) >= 5 and parts[2] == 'blob' else None
                code = sorted([p for p in paths if p.endswith(('.py', '.ts', '.rs', '.go')) and any(name in p.lower() for name in ('main', 'entrypoint', 'engine', 'scheduler'))], key=lambda p: (p.count('/'), len(p)))[:4]
                if requested in paths:
                    code = [requested] + [p for p in code if p != requested][:3]
                for path in readmes[:1] + code:
                    link = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + commit + '/' + path
                    try:
                        text, _ = fetch(link)
                        documents.append({'url': 'https://github.com/' + owner + '/' + repo + '/blob/' + commit + '/' + path,
                            'title': repo + ' · ' + path, 'text': text, 'sha256': hashlib.sha256(text.encode()).hexdigest(), 'links': [], 'embeds': []})
                    except Exception as error:
                        gaps.append(link + ': ' + str(error))
                scope = 'Repository ' + owner + '/' + repo + ' at commit ' + commit + ': README and up to four selected entry/engine files. No code was executed. Other files and tests were not inspected.'
                if tree.get('truncated'):
                    gaps.append('GitHub returned a truncated tree; file discovery was partial.')
            else:
                raw, final = fetch(item['url'])
                documents = [document(final, raw)]
                scope = 'The submitted page plus up to four reachable same-site article links; external references are inventoried only.'
                primary = documents[0]
                original = urlsplit(unwrap(final))
                links = [u for u in primary['links'] if urlsplit(u).hostname == original.hostname and
                         urlsplit(u).path != original.path and any(s in urlsplit(u).path for s in ('/blog/', '/posts/', '/articles/'))]
                for link in links[:4]:
                    try:
                        content, resolved = fetch(link)
                        documents.append(document(resolved, content))
                    except Exception as error:
                        gaps.append(link + ': ' + str(error))
                if len(links) > 4:
                    gaps.append(str(len(links) - 4) + ' additional related links were outside this bounded read.')
        except (OSError, ValueError, KeyError) as error:
            raise NeedsInput('I couldn’t read enough of this link. Paste the post or article text to continue. ' + str(error)) from error
    if not documents:
        raise NeedsInput('No readable source documents were found. Paste the material you want to study.')
    for index, doc in enumerate(documents):
        doc['id'] = 'source' + str(index + 1)
    value = {'documents': documents, 'scope': scope, 'gaps': gaps,
             'media_note': 'Embedded videos were not transcribed; figure contents were not automatically interpreted.'}
    saved.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    return value
