# Write so the learner can reason

Treat the learner as intelligent and unfamiliar with the subject. Explain the
missing knowledge rather than simplifying away the mechanism.

Start with a concrete situation. Introduce the new idea when it solves a problem
the learner can see. Define a term before using it in a question. Give units and
denominators with numbers. Explain what would change if an assumption changed.

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

## Worked examples and visuals

Give the example a title that names the question being answered. Keep the setup
short. Introduce each new assumption when the reader needs it, and show the
earlier results beside the current step. Do not make the learner reopen a
disclosure to find the denominator for the calculation in front of them.

For percentages, say which group the percentage describes. “33% of the 70
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
