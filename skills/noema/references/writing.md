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
  the level that needs it (usually Mechanism or Frontier). Never invent arithmetic
  to make an idea checkable.
- Prefer real cases to invented ones: an event the source reports, a named
  system, a decision someone made, a failure that taught the field something.
  Invent a scenario only when no real one shows the idea, and keep it qualitative
  unless the numbers are the point.
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

- **Antithesis.** "This is not X, it's Y." "X rather than Y." "Not only X but also Y."
  Say what it is. Mention what it isn't only when a reader would actually assume it.
- **Teaser fragments.** "Three changes. Which part owns each one?" "Not a detail. A
  design decision." "The harder question is…" "Several problems remain open." Write
  the full sentence that carries the point.
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
- **Name-drop lists.** Each cited paper or person gets what they found, in a sentence a
  newcomer can follow, or gets cut.

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

Offer a small prediction before a slider or experiment. Change one assumption
and explain which results depend on it. Keep the original example visible
beside the changed case. Motion should show a meaningful change, stop on its
own, and respect reduced-motion settings. Do not generate bespoke JavaScript
or fetch an external animation just to illustrate a paragraph.
