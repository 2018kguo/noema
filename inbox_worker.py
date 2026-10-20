"""One leased queue consumer, with checkpointed generation and restart recovery."""
import threading
import time
import uuid
from generate_course import generate
from source_reader import collect, NeedsInput


class InboxWorker:
    def __init__(self, store, prepare=generate, reader=collect):
        self.store, self.prepare, self.reader = store, prepare, reader
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.loop, name='noema-queue', daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=8)

    def process_next(self):
        settings = self.store.settings()
        if not settings['enabled']:
            return False
        owner = uuid.uuid4().hex
        item = self.store.claim(owner)
        if item is None:
            return False
        finished = threading.Event()

        def heartbeat():
            while not finished.wait(10):
                if not self.store.heartbeat(item['id'], owner):
                    return

        pulse = threading.Thread(target=heartbeat, daemon=True)
        pulse.start()

        def cancelled():
            return self.stop_event.is_set() or not self.store.settings()['enabled'] or not self.store.owned(item['id'], owner)

        def stage(state, message, title=None):
            if cancelled() or not self.store.advance(item['id'], owner, state, message, title=title):
                raise InterruptedError('Preparation stopped.')

        directory = self.store.root / 'items' / item['id'] / ('revision-' + str(item['revision']))
        try:
            reading = self.reader(item, directory / 'sources')
            if cancelled():
                raise InterruptedError('Preparation stopped.')
            output, title = self.prepare(item, reading, directory / 'draft', settings, stage, cancelled)
            self.store.advance(item['id'], owner, 'ready', 'Your lessons and practice are ready.', title=title, course_path=output)
        except NeedsInput as error:
            self.store.advance(item['id'], owner, 'needs_input', str(error))
        except InterruptedError:
            self.store.advance(item['id'], owner, 'queued', 'Saved your drafts. Preparation will resume when the queue runs.')
        except Exception as error:
            self.store.advance(item['id'], owner, 'failed', str(error)[:500] or 'Preparation failed. Your link and drafts are saved; retry this item.')
        finally:
            finished.set()
            pulse.join(timeout=2)
        return True

    def loop(self):
        while not self.stop_event.is_set():
            try:
                worked = self.process_next()
            except Exception:
                worked = False
            if not worked:
                self.stop_event.wait(2)
