# Author a course bundle

A course directory has `course.json` and `challenges.json`. The server serves those
through the shared UI. Use the DeepInfer sample as a complete worked schema.
The JSON is trusted authored content: `layers` and `META.about_html` contain HTML.
Never insert raw crawled HTML, scripts, or untrusted user text into them.

Create a draft with `python3 course.py init local-courses/topic --id topic --title
'My topic'`. Crawl into its `sources/` subdirectory afterward. The scaffold is
deliberately incomplete; validation fails until lessons and metadata are written.

## Course fields

`META` supplies `id`, `title`, `eyebrow`, `heading`, `introduction`, `start_label`,
`footnote`, two `depth_labels`, and `about_html` (source scope, dates, evidence
limits). `id` is a stable lowercase slug and separates saved progress. Use a new id
for a different course. `progress_key` is optional; the sample preserves its
original browser storage key.

`CONTENT_REVISION` identifies substantive course changes. Each question can have
`revision`; each lesson can have `assessment_revision`. Review scenarios and
activities require `revision`. Bump the relevant revision when the task or rubric
changes so older feedback is not presented as current.

`SOURCES` maps ids to `[title, URL, what this supports]`. A source entry is a claim
that the author inspected that material. List missing/unread citations separately
in private `coverage.md`. `CARDS` is a list of `[short title, question, answer,
lesson id]`. `GLOSSARY` maps terms to plain-English definitions. `LABS` is `[]`
for ordinary courses or `["tiny-engine"]` for the shipped inference exercise.

## Lessons

Each `LESSONS` entry uses:

```json
{
  "id": "prediction",
  "title": "What would this result let you predict?",
  "phase": "01 · Foundations",
  "mins": 20,
  "goal": "Distinguish a useful early measurement from evidence of clinical benefit.",
  "needs": [],
  "recall": "What outcome do we eventually care about?",
  "predict": "Would doubling the number of measurements settle this question?",
  "layers": ["<p>Full beginner explanation...</p>", "<p>Mechanism and calculation...</p>", "<p>Evidence and design judgment...</p>"],
  "example": ["A concrete setup with all needed facts.", ["First worked step.", "Second worked step.", "Third worked step."]],
  "questions": [
    {"id": "prediction-1", "level": 1, "prompt": "...", "options": ["...", "...", "..."], "correct": 1, "why": "Explain the reasoning.", "hint": "One small nudge.", "repair": "prediction"},
    {"id": "prediction-2", "level": 2, "prompt": "...", "options": ["...", "..."], "correct": 0, "why": "...", "hint": "...", "repair": "prediction"},
    {"id": "prediction-3", "level": 3, "prompt": "...", "options": ["...", "..."], "correct": 1, "why": "...", "hint": "...", "repair": "prediction"}
  ],
  "transfer": ["Apply the idea to a new situation.", ["An explicit reasoning requirement.", "Another requirement."], "One worked explanation, not the only acceptable wording."],
  "sources": ["a-source-id"],
  "takeaway": "One useful connection to remember."
}
```

Three questions correspond to the three depth levels. `needs` references earlier
lesson ids. Keep the beginner question answerable from the main explanation.
Optional `lab` refers to a shipped inference calculator; omit it in other courses.

`example_title` optionally names the concrete question the example answers.
Earlier steps remain visible below the current explanation. Use `visual: null`
or omit it when a visual adds nothing. Otherwise use one of these validated
structures; the runtime renders it without executing generated code:

```json
{
  "kind": "flow",
  "title": "Where does each responsibility belong?",
  "caption": "An authored example of three responsibilities in one system.",
  "source_ids": [],
  "nodes": [
    {"label": "Model", "detail": "Change learned weights or an adapter.", "step": 0},
    {"label": "Engine", "detail": "Change how requests run on the computer.", "step": 1},
    {"label": "Service", "detail": "Route requests to available machines.", "step": 2}
  ]
}
```

Flow nodes use zero-based example steps, in order, with two to six nodes. Show a
relationship the learner must reason about; do not repeat three headings.

```json
{
  "kind": "funnel",
  "title": "How many parts survive all three checks?",
  "caption": "Invented rates for an arithmetic exercise, not production measurements.",
  "source_ids": [],
  "initial": 100,
  "unit": "parts",
  "start_label": "Start inspection",
  "adjustable_stage": 1,
  "stages": [
    {"label": "Pass size check", "rate": 0.8},
    {"label": "Pass strength check", "rate": 0.5},
    {"label": "Pass final inspection", "rate": 0.75}
  ]
}
```

A funnel has one gate per example step. Each rate applies to the survivors of
the previous gate. Counts are computed by the runtime, without rounding between
gates. `adjustable_stage` chooses the zero-based gate for the what-if slider.
The original example remains fixed while a separate table shows the changed
case. Captions must explain assumptions, fractional expected counts and scope
where relevant. `source_ids` must reference sources already on that lesson;
use an empty array for wholly invented examples. Never relabel an intermediate
gate as proof of the ultimate outcome.

Cards, disclosures and progress indicators use the free MIT-licensed Web Awesome
components. Their pinned assets ship locally and inside exported ZIPs. Add new
teaching patterns to the shared renderer, validator and generator schema together;
do not put custom controls, scripts or raw SVG into generated course HTML.

Optional `activity` has kind `check` (select/numeric fields), `worksheet` (a saved
plan with a worked comparison), or `workshop` (the fixed cache experiment).
Inspect the sample's `map`, `phases`, `artifacts`, `bench`, and `workshop` lessons
for concrete examples. `workshop` is currently tied to that lesson id. Do not use
it for an unrelated subject or claim it is a general execution backend.

## Review scenarios

`challenges.json` is an array. Use `[]` if there are none. Scenarios use `id`,
`title`, `kind`, `lesson`, `difficulty`, `prompt`, `artifact` (code, claim, table,
or plan as plain text), `context`, `repo_paths`, `hint`, `criteria`, `follow_up`,
`solution`, `revision`, and `guide`.

Each criterion uses `id`, `label`, `rule`, and `feedback`. `guide` has `needs`,
`setup` (paragraphs of prerequisite explanation), `terms` (name/meaning pairs),
`reading` (label/explanation pairs), `trace`, `trace_hint`, and `takeaway`.
An article critique can use the same structure as a patch review. Keep claims
and assumptions visible before asking for a verdict.

The backend derives lesson graders from `transfer`; never maintain a second
rubric copy. Grader outputs must contain every criterion once and quote exact
substrings of the submitted answer for met/partial decisions. There is no
keyword-based mastery grade. The rubric checks explained reasoning.

## Check before sharing

Validate cross-references with `python3 course.py validate <course>`. Read several
lessons from beginning to end, including deeper levels and wrong-answer feedback.
Verify a real browser flow and phone layout. Check source coverage against the
manifest and give the learner an honest account of omissions.

Share only the authored bundle with `python3 course.py bundle <course> --out
dist/<id>.zip`. It contains no raw sources. Publication permission and rights to
the material are separate from the fact that the app can package it.
