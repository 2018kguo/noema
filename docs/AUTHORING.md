# Author a course bundle

A course directory has `course.json` and `challenges.json`. The server serves those
through the shared UI. Use the DeepInfer sample as a complete worked schema.
The JSON is trusted authored content: `levels` and `META.about_html` contain HTML.
Never insert raw crawled HTML, scripts, or untrusted user text into them.

Create a draft with `bun run course init local-courses/topic --id topic --title
'My topic'`. Crawl into its `sources/` subdirectory afterward. The scaffold is
deliberately incomplete; validation fails until lessons and metadata are written.

## Course fields

`META` supplies `id`, `title`, `eyebrow`, `heading`, `introduction`, `start_label`,
`footnote`, `about_html` (source scope, dates, evidence limits) and optional
`placement` (see Depth levels). `id` is a stable lowercase slug and separates saved progress. Use a new id
for a different course. `progress_key` is optional; the sample preserves its
original browser storage key.

`CONTENT_REVISION` identifies substantive course changes. Each question can have
`revision`; each lesson can have `assessment_revision`. Review scenarios and
activities require `revision`. Bump the relevant revision when the task or rubric
changes so older feedback is not presented as current.

`SOURCES` maps ids to `[title, URL, what this supports]`. A source entry is a claim
that the author inspected that material. List missing/unread citations separately
in private `coverage.md`. Prose names sources the way a reader would ("the FDA's
page on clinical research"); validation rejects bare ids such as `source3` outside
`sources` and `source_ids`. `META.introduction` is plain text (no HTML, at most 600
characters); scope notes belong in `about_html`. `GLOSSARY` maps terms to plain-English definitions. `LABS` is `[]`
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
  "levels": {
    "1": "<p>Intuition: the situation, the idea, why it matters...</p>",
    "2": "<p>Mechanism: moving parts, numbers, code paths, trade-offs...</p>",
    "3": "<p>Frontier: evidence, where it breaks, open problems...</p>"
  },
  "example": [
    "A concrete setup with all needed facts.",
    ["First worked step.", "Second worked step.", "Third worked step."]
  ],
  "questions": [
    {
      "id": "prediction-1",
      "level": 1,
      "prompt": "...",
      "options": ["...", "...", "..."],
      "correct": 1,
      "why": "Explain the reasoning.",
      "hint": "One small nudge.",
      "repair": "prediction"
    },
    {
      "id": "prediction-2",
      "level": 2,
      "prompt": "...",
      "options": ["...", "..."],
      "correct": 0,
      "why": "...",
      "hint": "...",
      "repair": "prediction"
    },
    {
      "id": "prediction-3",
      "level": 3,
      "prompt": "...",
      "options": ["...", "..."],
      "correct": 1,
      "why": "...",
      "hint": "...",
      "repair": "prediction"
    }
  ],
  "transfer": [
    "Apply the idea to a new situation.",
    ["An explicit reasoning requirement.", "Another requirement."],
    "One worked explanation, not the only acceptable wording."
  ],
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
    { "label": "Model", "detail": "Change learned weights or an adapter.", "step": 0 },
    { "label": "Engine", "detail": "Change how requests run on the computer.", "step": 1 },
    { "label": "Service", "detail": "Route requests to available machines.", "step": 2 }
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
    { "label": "Pass size check", "rate": 0.8 },
    { "label": "Pass strength check", "rate": 0.5 },
    { "label": "Pass final inspection", "rate": 0.75 }
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

### Inline illustrations

`illustrations: [{ id, after_paragraph, visual }]` places up to four figures
after numbered top-level paragraphs of the main explanation. Besides `flow` and
`funnel`, three explorable kinds each have one slider and keep the original
case beside the changed one:

- `binding`: one-site equilibrium occupancy, `kd_nm`, `ligand_nm`, `max_nm`
  (both values ≤ `max_nm`). The slider moves free ligand concentration.
- `screen`: natural-frequency screening, `population`, `prevalence`,
  `sensitivity`, `false_positive_rate` (fractions). The slider moves the false
  positive rate.
- `schedule`: a dependency plan, `tasks: [{ id, label, duration, after }]` with
  dependencies listed earlier, `adjustable_task`, `max_duration` (weeks). The
  chart marks the critical path; the slider shows when slack runs out. Hand-
  authored only for now; generation does not emit it.

Every explorable has a `predict` prompt shown before the slider. Each illustration
names the `level` whose text it sits in. A question may add `option_feedback`, one
sentence per option.

## Depth levels

Each topic is written at one or more of three levels, every one a complete
explanation for its own reader, never the previous level made longer:

- **1 · Intuition**: a smart outsider. The situation, the core idea, why it matters.
- **2 · Mechanism**: someone who will build or run it. Quantities, code paths,
  failure modes, trade-offs.
- **3 · Frontier**: a researcher. Evidence and how it was measured, where it breaks,
  competing approaches, open problems.

Write only the levels that add something: a prerequisite may be level 1 only, a
specialist topic level 3 only. Each written level needs exactly the questions
tagged with that `level`; the reader quizzes the level being read.

`META.placement` holds probes, one level-2 and one level-3 multiple-choice question
per section (`phase`). Getting every level-2 probe right in a section starts it at
Mechanism; every level-3 probe as well starts it at Frontier. The reader adds an "I'm
not sure" option. Learners can change a section's level later or switch depth on
one topic. A topic whose levels are all below the learner's leaves their path (the
course outline marks it skipped); a topic whose levels are all above stays as a
stretch. Reading time and blocks follow the level actually shown.

Cards, disclosures and progress indicators use the MIT-licensed shadcn/ui and Radix
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

Validate cross-references with `bun run course validate <course>`. Read several
lessons from beginning to end, including deeper levels and wrong-answer feedback.
Verify a real browser flow and phone layout. Check source coverage against the
manifest and give the learner an honest account of omissions.

Share only the authored bundle with `bun run course bundle <course> --out
dist/<id>.zip`. It contains no raw sources. Publication permission and rights to
the material are separate from the fact that the app can package it.

## Reading blocks and progress

The default reader combines topics and worked examples until their estimated time reaches about 30 minutes. The estimate includes reading at 170 words per minute and at least three minutes per example; each topic gets at least five minutes. `reading_minutes` can override a topic estimate after editorial review. Only the level shown to the learner is counted. A final lone topic joins the previous block. Questions are collected at the end, with one check action for the whole block, followed by an explanation. No timer gates access.

The dashboard reads the same browser progress key as the course. Marking a block read increases reading progress; completing its quiz and comparing the current explanation records practice. Existing completed lessons remain counted.

## Readable presentation

The shared reader uses 18px lesson prose, 16px controls and ordinary interface text, and a 14px floor for secondary information at the default browser size. These sizes stay readable on phones; layouts wrap rather than shrinking text. Use meaningful headings and connected prose. Do not add all-caps kickers, duplicate headings, decorative badges or labels such as “LET’S MAKE IT CONCRETE.” Sources, field labels and actual status remain visible in sentence case. The browser provides navigation and progress.
