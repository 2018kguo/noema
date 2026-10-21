# Noema

This is a standalone Bun 1.4.3 / TypeScript application. It is not part of Arca.
For course generation, read `skills/noema/SKILL.md` and the linked
authoring and writing guidance. Course data lives in `courses/<id>/`.
Keep private work in `local-courses/` or outside this repo. Publish only courses
the user has authorized. Never commit raw third-party crawls, account credentials,
browser progress, or provider responses.

Default to about 30 minutes of reading and worked examples before a grouped quiz and explanation. Estimate reading time; never gate on elapsed time. Keep optional individual exercises and feedback freshness. Code
exercises show the relevant code before asking for a prediction or a run.
Executable labs remain fixed, explicit plugins; `/api/workshop` never accepts code.
Article courses must work without the inference-specific plugin.

Course content follows `skills/noema/references/writing.md` (teach the topic, not the test; no LLM tells; every name explained or linked) for existing and generated courses alike. After editing any course, run `bun run course inspect <dir>` and fix what it flags.

Keep typography readable: normal interface text is 16px, lesson prose 18px, and secondary text at least 14px at the default browser size. The root font is 100% so rem units respect browser preferences. Wrap layouts on narrow screens instead of shrinking text. Avoid decorative all-caps labels, repeated section labels and informational pills; keep labels that identify a field, real status, source or position. Use the shared components and verify computed sizes in a real browser.

Run `bun run build:ui`, `bun run typecheck`, `bun run lint`, `bun run fmt:check`, and `bun test tests`. Browser tests require agent-browser 0.37.1 with Chromium installed. Keep the 218 reference comparisons in `python3 tiny_engine.py test`. All tests use deterministic fixtures. Generated assets are committed; edit `browser/` and `ui/`, then rebuild. Use Bun and the committed bun.lock, never a second package-manager lock. Keep visual validation, rendering and generation schemas aligned. Preserve the original example when changing an assumption. Use the shared progress reader on course and dashboard; browser localStorage is the only learning-progress authority. Do not erase unreadable progress or claim that reading alone means a topic was practiced.

These tests use no model credits. `bun run evaluate` makes real provider calls;
use it only when live evaluation is requested or clearly within the authorized work.

`src/crawl.ts` reports discovery scope, unavailable pages and capture timestamps.
"Settled" means no queued pages; "complete" additionally requires every scoped
page and the archive index to have been fetched. Never erase failures to claim
completion. Inspect readable extraction against HTML before writing lessons.

The inbox uses SQLite claims with an owner token and expiring lease. Every worker
state change and publication must match that owner. Keep cancellation and restart
recovery tests when changing this seam. Model calls are tool-free and isolated
from the target repo; source text is data. Generated HTML is sanitized before it
is served. Keep the browser and the inbox CLI on the same InboxStore operations.
