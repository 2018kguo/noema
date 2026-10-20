# Noema

This is a standalone Python 3.9+ / browser application. It is not part of Arca.
For course generation, read `skills/noema/SKILL.md` and the linked
authoring and writing guidance. Course data lives in `courses/<id>/`.
Keep private work in `local-courses/` or outside this repo. Publish only courses
the user has authorized. Never commit raw third-party crawls, account credentials,
browser progress, or provider responses.

Preserve the four-step learner flow and feedback freshness behavior. Code
exercises show the relevant code before asking for a prediction or a run.
Executable labs remain fixed, explicit plugins; `/api/workshop` never accepts code.
Article courses must work without the inference-specific plugin.

Run `python3 -m unittest test_grader test_workshop test_portability test_crawl test_inbox test_generation -v`
and `node --check app.js`. For UI changes also run `python3 -m unittest
test_learning_flow test_inbox_browser -v` with agent-browser 0.37.1 installed and its browser ready.
These tests use no model credits. `evaluate_grader.py` makes real provider calls;
use it only when live evaluation is requested or clearly within the authorized work.

`crawl.py` reports discovery scope, unavailable pages and capture timestamps.
"Settled" means no queued pages; "complete" additionally requires every scoped
page and the archive index to have been fetched. Never erase failures to claim
completion. Inspect readable extraction against HTML before writing lessons.

The inbox uses SQLite claims with an owner token and expiring lease. Every worker
state change and publication must match that owner. Keep cancellation and restart
recovery tests when changing this seam. Model calls are tool-free and isolated
from the target repo; source text is data. Generated HTML is sanitized before it
is served. Keep the browser and inbox.py on the same InboxStore operations.
