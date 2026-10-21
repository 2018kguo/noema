# Read a collection without losing its boundaries

For a repo, pin its commit, read its entry points and tests, and follow the code
path needed for the learning goals. Record what you did not run. For article
collections, inspect the starting article's links, the blog index, and related
posts. Follow prerequisites and primary research where they change the lesson.
Do not recursively crawl unrelated external sites.

Use `bun run crawl` for a resumable archived blog crawl. `--archive-at` requests the
nearest available capture; each page's actual timestamp is in the manifest. The
archive index and same-site links define article scope. External links are a
separate inventory, not a claim that their contents were fetched or verified.
Fetch relevant background sources separately and record them in the course's
source map. Keep unavailable citations visible and avoid relying on them alone.

Inspect extracted text against original HTML, especially tables, figures, and
transcripts. The crawler does not execute JavaScript, transcribe video, or OCR
figure labels. An interview page with an embedded video is not a transcript.
If a figure contains essential evidence, inspect it or mark that gap.

Maintain `coverage.md` beside private course JSON. Include requested scope,
discovered/fetched/unavailable article counts, capture dates, video/image gaps,
and which external references were actually read. Link each source to lessons.
The crawler's `settled` flag means no pending URLs. Only `kind: complete` supports
claiming every discovered article and the archive index was fetched. Qualify
this as discovery coverage, not proof that no unindexed page ever existed.

Use original explanations with attribution. Do not package full copyrighted
articles or a third party's codebase as if they were your own. Share generated
lesson JSON through the allowlisted bundle command; raw crawl files stay local.
