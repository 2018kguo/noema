# Write so the learner can reason

Treat the learner as intelligent and unfamiliar with the subject. Explain the
missing knowledge rather than simplifying away the mechanism.

Start with a concrete situation. Introduce the new idea when it solves a problem
the learner can see. Define a term before using it in a question. When a number
matters, give its units and say what it is a share of. Explain what would change
if an assumption changed.

## Teach the topic, not the test

The goal is that the reader understands what the source is about and can think
with it: what problem it addresses, how the thing works, what the author claims,
what the evidence shows, and where people disagree. It is not to produce
material that is easy to grade.

- Spend the words where the source spends them. If an article is about how AI
  agents change drug R&D, the course is mostly about agents, drug R&D and the
  argument, not about the statistics you could attach to them.
- A formula or calculation earns a place only when the topic is quantitative or
  the source's argument rests on it. Then explain it once, in words first, at
  the level that needs it (usually High level or Depth). Never invent arithmetic
  to make an idea checkable.
- Prefer real cases to invented ones: an event the source reports, a named
  system, a decision someone made, a failure that taught the field something.
  Invent a scenario only when no real one shows the idea, and keep it qualitative
  unless the numbers are the point.
- Levels are passes taken in order, so each one assumes the earlier ones and covers
  new ground. Intro gives the situation, the core idea and the real case; High level
  how it works, with the parts Intro left out; Depth the evidence, prior and competing
  work, and what is unsettled. Never rewrite an earlier level at a different reading
  level. `course inspect` reports how much of each level repeats the ones before it.
- A level is optional. Write High level or Depth only when the sources give it
  something to say: how the thing works in the cases they discuss, the evidence
  behind their claims, where people disagree. Textbook material the sources never
  use (sample-size formulas, binding kinetics, derivations) is not depth, however
  rigorous it looks. If a topic has nothing like that at a level, leave the level
  out; that pass skips the topic.
- Questions check whether the idea landed: which explanation fits, what would
  happen if something changed, what a claim does and doesn't show, how two ideas
  relate. Avoid questions whose difficulty is the arithmetic.

Develop one idea per paragraph. Prefer connected sentences over dense noun
phrases, slogan headings, or lists of keywords. A diagram or table should answer
a question that the prose has introduced. Let examples carry the explanation.

For example, avoid:

> Predictive validity is the critical north star underpinning the discovery
> flywheel. Leverage agentic orchestration to unlock translational impact.

Write:

> Suppose a screen finds 100 molecules that bind a protein. Some may still fail
> because the protein does not cause the disease, or because the dose damages
> healthy tissue. A useful early test helps you choose molecules that survive
> those later checks. Finding binders faster helps only part of that problem.

Avoid unexplained acronyms, "delve," "unlock," "seamless," "powerful," "robust"
without a failure mode, "game-changing," "it's worth noting," "at its core,"
"the key takeaway," and repeated "not X, but Y" constructions. Do not praise the
learner for clicking Next or turn every correction into a pep talk.

Aim for the tone of a good [Distill](https://distill.pub/) article: a person
explaining something they understand, to someone they respect. Credit people
inside the sentence ("Scannell and Bosley simulated…") and name a source the
way a reader would recognize it, never by an internal id like `source3`. Say
once, plainly, where a number comes from; do not repeat a disclaimer after every
figure. Do not narrate the lesson ("This lesson shows…", "The question here
is…"). State the idea. Do not end paragraphs with a moral.

## LLM tells to remove

Readers recognize machine prose by its shapes more than its words. Each of these
has drawn real complaints ([Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)).
Find them on the second pass and rewrite the sentence as a person would say it.
`src/tells.ts` detects these (shared with [Sprout](https://github.com/2018kguo/sprout)), and
`bun run course inspect <dir>` reports every hit with its rate per 100 words.

- **Antithesis.** "This is not X, it's Y." "X rather than Y." "Not only X but also Y."
  Say what it is. Mention what it isn't only when a reader would actually assume it.
- **Teaser fragments.** "Three changes. Which part owns each one?" "Not a detail. A
  design decision." "The harder question is…" "Several problems remain open." Write
  the full sentence that carries the point.
- **Flashcard openers.** "A protocol is the study's plan, written before enrollment."
  "The comparison group is built by randomization." A clipped X-is-Y line at the top
  of paragraph after paragraph reads like a glossary. Lead in from what the reader
  just learned and fold the definition into the sentence that uses it: "Each of those
  studies follows a protocol, a plan written before anyone enrolls that fixes who
  qualifies, the dose and how the results will be analyzed."
- **Staccato rhythm.** Runs of short declarative sentences. Join the ones that belong
  together and let sentence length vary the way speech does. Do not overcorrect into
  long, comma-chained sentences; that is paper voice (see "Measure the prose").
- **Self-narration.** The text talks about itself: "The table also cuts against us",
  "The programs make the point more plainly than the medians", "this is an inference
  from the pattern, not a measurement of why", "Our thesis is", "here they are first".
  State the content. Put a counterpoint in a plain sentence where it applies, and a
  caveat once, next to the number it changes.
- **Colon and semicolon pivots** that stand in for "because", "but" or "so": "X exists
  in theory; in practice, Y." Use the conjunction.
- **Aphorisms and morals.** A closing line that restates the paragraph as a maxim
  ("A cache has to preserve the right history"). Delete it; the paragraph already said it.
- **Imperative openers and closers.** "Read the figures for what they are." "Ask every
  claim which workload…" State the fact or the check plainly.
- **Groups of three** and announced counts ("Three contracts are in use"). Give the real
  number of things, and don't announce it.
- **Copula avoidance.** "serves as", "stands as", "marks", "boasts", "refers to". Write "is".
- **Signature vocabulary.** honest, load-bearing, the trap, full stop, quietly, crucial,
  pivotal, underscore, leverage, multifaceted, "worth noting", "X matters more".
- **Bold inline labels** that turn a paragraph into a list of mini-headings.
- **Rhetorical setups.** A question answered at once ("The result? Chaos."), "here's the
  thing", "the truth is", and closers like "ultimately" or "at its core". Say the point.
- **Significance tails.** ", highlighting its importance", ", paving the way for…". Cut the clause.
- **Teacher voice.** "Let's break this down", "think of it as". Talk to the reader as a peer.
- **A narrator.** "My reading is…", "my estimate", "I infer". The course has no "I".
  Mark an inference plainly: "The paper doesn't say why; the likely reason is…".
- **Em dashes.** Use a period, comma or parentheses.
- **Titles with a flourish.** "The math you need, without the fog", "What X actually does",
  "Read the code without getting lost", "more than a weights file". Name the topic plainly,
  the way a person labels a chapter: "Tensor shapes and memory sizes".
- **Lists of three** in titles and taglines: "Tokens, logits and choosing what comes next",
  "The evidence, where it breaks and what's still open". Name the one subject.
- **Name-drop lists.** Each cited paper or person gets what they found, in a sentence a
  newcomer can follow, or gets cut.

## Measure the prose, then read it

Slop comes in two forms, and the tell detector catches only the first.

- **Rhetoric** is the tells above: antitheses, punchlines, morals, self-narration.
- **Paper voice** has no tells at all. It reads like a journal abstract: long sentences
  joined by commas, a hedge in every sentence, side findings in every paragraph. Readers
  call it "meandering", "hard to read" and "technically followable but feels like
  reading a paper".

Fixing rhetoric alone tends to produce paper voice, because joining staccato sentences
and adding caveats both make sentences longer. We learned this on a set of data-heavy
blog posts:

- Posts a domain expert called "clearly LLM slop" scored only 0.1 to 0.3 strong tells per
  100 words. The detector is a floor, not a verdict.
- After the tells were removed, the same expert said the posts read like a paper.
  `density()` in `src/tells.ts` separates the two groups:

|                                | Mean sentence  | Over 30 words | Commas per sentence |
| ------------------------------ | -------------- | ------------- | ------------------- |
| Posts the reader liked         | 15 to 17 words | 6 to 9%       | about 1.0           |
| Posts that "read like a paper" | 24 to 27 words | 30 to 36%     | 1.3 to 1.7          |
| Limit (`DENSITY_LIMITS`)       | 18 words       | 10%           | 1.1                 |

`bun run course inspect` reports density for each level and for the whole course. If a
level goes over a limit, split its sentences, not its ideas. Use one idea per sentence,
paragraphs of two to four sentences, and common words ("start", not "commence"). Avoid
noun stacks ("Phase 2 to Phase 3 transition timing").

Structure makes the biggest difference:

- **Answer first.** Answer the title's question, with its main number, in the first two
  sentences. A case or scene can follow in two or three short sentences.
- **Cut rather than compress.** Delete a section that answers a different question than the
  title. Squeezing every finding into shorter sentences keeps the meandering.
- **Caveat once.** Put the main limit next to the number it changes, or in the method
  note. Hedging every sentence makes each one longer and weaker.

The numbers only show that a passage is dense. They don't show that it is good. Prose
that passes every check can still say nothing, repeat itself, or misstate a source.
Read every paragraph yourself before you accept it, and don't trust a writer's or
agent's report that the text is "clean". In the blog posts, the reader who read
everything found problems the checks missed: a snapshot called "the newest" when a
later letter existed, and two posts that gave different counts for the same thing.

## Questions people want to answer

A question should feel like thinking through something real, not a quiz bank.

- Start from a situation: a moment the reader could be in, or a real case from the
  sources. "Your chatbot's answers get more varied after someone changes one setting,
  but its facts don't change. Which setting was it?" beats "What does temperature change?"
- Ask the reader to predict, diagnose, decide or explain: what happens if something
  changes, why a result came out as it did, which check to run next, what a claim
  does and doesn't show. Vary the shape across a course.
- Every option is something a smart person who half-understood the reading might
  pick. No joke options, no options wrong only because of an absolute word, no
  correct answer given away by length. Keep options parallel and short.
- Feedback teaches: say why each wrong option is tempting and where it goes wrong.

## Stand alone, or link

Every name the reader meets must be explained where it appears or be one hover away.
Never write "the Q&A", "the README" or a bare file path as if the reader had it open:
say what the document is the first time ("DeepSeek's Q&A about running DeepInfer in
production"). Mark a specialist term on its first use in a level with
`<dfn data-term="Glossary key">term</dfn>` and give it a plain glossary entry. Cite a
source with `<a data-source="sourceId" data-quote="a short exact phrase from it">readable
name</a>`; the reader shows a preview card and the link opens the source in a new tab,
scrolled to and highlighting that phrase. Copy the phrase verbatim from the source. A term that needs more than a sentence to explain is a prerequisite: teach it.

Use a second pass to ask:

- Which sentence depends on a fact the reader has not learned yet?
- Where does the explanation jump from a name to a conclusion without a mechanism?
- Could a real number or tiny example replace an abstract claim?
- Did I turn the source's reported result into an established fact?
- Do the distractors test reasoning, or merely recognition of the phrasing?
- Does the rubric require something the lesson never taught?
- Does the sample answer connect the observations to the conclusion?

Read several paragraphs aloud. Rewrite anything that sounds like a pitch deck,
an evaluation report, or a compressed research abstract. Check the whole course
for repeated filler. Do not satisfy a word target by restating the same point.

## Examples and visuals

Each topic has one example: a concrete case walked through in two to four steps,
real when possible. Give it a title that names what it shows. Keep the setup
short and introduce each detail when the reader needs it.

When an example does involve numbers, say which group a percentage describes. “33% of the 70
remaining” explains more than “multiply the rates.” Name the endpoint of every
gate. Passing a test, preparing an application, receiving approval and improving
an outcome are different events. A decimal count is an expected value across
repeated groups, not a fraction of an actual person or program.

Do not multiply averages from different populations and present the product as
an observed overall success rate. Use explicitly invented assumptions to teach
the arithmetic when source definitions do not establish a common cohort and
endpoint. Distinguish the arithmetic exercise from a forecast.

Choose a visual that answers the example’s question. Use the runtime’s `flow`
for relationships or sequences and `funnel` for successive conditional retention
rates. Label arrows and stages with what happens. Give quantities units and
state what the diagram leaves out. Use `null` when neither fits; decorative
cards do not explain a mechanism. Write the example and diagram together, then
check that every highlighted step agrees with the prose.

Make a chart for the point the text is making, not as a dump of the data. Highlight
only the marks that carry the point and leave the rest grey. Print each value on its
mark so nobody has to read an axis. Write a caption that says what is measured and
what the chart shows, and don't repeat the heading above it. Check the chart at phone
width (390 px): a chart drawn 800 px wide shrinks its text to about 6 px there. If a
table exists only to compare numbers, replace it with the chart. Keep a table only
when readers will look up a particular row.

Offer a small prediction before a slider or experiment. Change one assumption
and explain which results depend on it. Keep the original example visible
beside the changed case. Motion should show a meaningful change, stop on its
own, and respect reduced-motion settings. Do not generate bespoke JavaScript
or fetch an external animation just to illustrate a paragraph.

## Self-review checklist

Every generated topic is reviewed against this list before a learner sees it, and
rewritten when anything fails. Each item comes from a reader's complaint.

- **Teaches the subject.** The topic explains what the sources are about: what was built
  or found, how it works, why it matters, how it compares with prior work. A topic or
  diagram about how to judge claims in general ("what a cost claim has to show",
  "sorting one sentence from the post") is filler; weave judgment into the subject.
- **Says something substantive.** Every paragraph gives the reader a fact, mechanism or
  case they didn't have. Cut paragraphs that only restate, hedge or announce.
- **Each level adds new ground.** High level does not rephrase Intro at a harder reading
  level, and Depth does not rephrase High level. A level that would mostly repeat is dropped.
- **No textbook padding.** Formulas, derivations and side topics the sources never use
  are dropped, along with any level that would be made of them.
- **Reads plainly.** Density is within `DENSITY_LIMITS`, the point comes first, and
  each caveat appears once. Someone outside the field could follow it on first reading.
- **Sounds like a person.** None of the tells above, no flashcard openers, no staccato,
  no everyday analogies standing in for the real thing (speed limits, roads, kitchens),
  no cute or three-item titles.
- **Examples fit their level.** Intro tells a real case in words. Invented worked
  numbers belong at High level or deeper, and only when the topic is quantitative.
- **Visuals show the subject.** A source figure, the source's own video, or a plot
  when quantities relate; flow diagrams only for a real mechanism. No checklists drawn
  as boxes. Most topics have one.
- **Questions are worth answering.** A situation to reason about, plausible options,
  feedback that explains each choice, a hint that points back to the specific idea in
  that level's words, and an explain-it-back task an Intro reader can do in a few
  sentences.
- **Stands alone.** Every term is explained or linked where it appears; no "the post"
  or "the article" as if the reader had it open; no planner notes ("Reading block 1")
  or internal ids.
