import { z } from "zod";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ROOT,
  loadBundle,
  visualSchema,
  illustrationSchema,
  levelSchema,
  type Lesson,
} from "./course";
import { type Item, type Settings } from "./inbox-store";
import { type Reading } from "./source-reader";
import { runStructured, Cancelled } from "./structured-cli";
import { cleanHTML, escapeHTML } from "./html";
import schemas from "./generation-schemas.json";
const t = z.string(),
  arr = (min: number, max: number) => z.array(t).min(min).max(max);
const pair = z.object({ name: t, explanation: t }).strict();
const planSchema = z
  .object({
    title: t,
    heading: t.max(120),
    introduction: t.max(500),
    lessons: z
      .array(z.object({ title: t, phase: t, goal: t, focus: t, sources: arr(1, 6) }).strict())
      .min(5)
      .max(20),
    glossary: z
      .array(z.object({ term: t, definition: t }).strict())
      .min(15)
      .max(80),
    reviews: arr(3, 6),
    placement: z
      .array(
        z
          .object({
            phase: t,
            level: z.union([z.literal(2), z.literal(3)]),
            prompt: t,
            options: arr(3, 3),
            correct: z.number().int().min(0).max(2),
            why: t,
          })
          .strict(),
      )
      .min(2)
      .max(16),
  })
  .strict();
const generatedQuestion = z
  .object({
    prompt: t,
    options: arr(3, 3),
    correct: z.number().int().min(0).max(2),
    why: t,
    hint: t,
    option_feedback: arr(3, 3).optional(),
    level: levelSchema,
  })
  .strict();
const generatedLesson = z
  .object({
    intuition_html: t.nullable(),
    mechanism_html: t.nullable(),
    frontier_html: t.nullable(),
    example_title: t,
    example_setup: t,
    example_steps: arr(3, 3),
    visual: visualSchema.nullable(),
    illustrations: z.array(illustrationSchema).max(4).default([]),
    questions: z.array(generatedQuestion).min(1).max(4),
    transfer_prompt: t,
    rubric: arr(3, 4),
    transfer_example: t,
    takeaway: t,
  })
  .strict();
const generatedReview = z
  .object({
    title: t,
    prompt: t,
    artifact: t,
    context: t,
    setup: arr(2, 4),
    terms: z.array(pair).min(2).max(5),
    reading: z.array(pair).min(2).max(4),
    prediction: t,
    hint: t,
    criteria: z
      .array(z.object({ label: t, rule: t, feedback: t }).strict())
      .min(3)
      .max(4),
    solution: t,
    takeaway: t,
  })
  .strict();
export type Stage = (state: "writing" | "checking", message: string, title?: string) => void;
export function lessonContext(
  documents: Reading["documents"],
  outline: z.infer<typeof planSchema>["lessons"][number],
  limit = 18000,
) {
  const stop = new Set(
    "that with this from have what which their source would they then also only into before after about".split(
      " ",
    ),
  );
  const terms = (outline.title + " " + outline.focus)
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3 && !stop.has(t));
  return documents
    .filter((d) => d.id && outline.sources.includes(d.id))
    .map((d) => {
      const paragraphs = d.text.split("\n\n"),
        ranked = paragraphs
          .map((p, i) => ({ i, score: terms.filter((t) => p.toLowerCase().includes(t)).length }))
          .sort((a, b) => b.score - a.score);
      let size = 0;
      const selected: number[] = [];
      for (const { i } of ranked)
        if (size + paragraphs[i].length <= limit) {
          selected.push(i);
          size += paragraphs[i].length;
        }
      selected.sort((a, b) => a - b);
      return {
        id: d.id,
        title: d.title,
        url: d.url,
        sha256: d.sha256,
        paragraphs: selected,
        excerpt: selected.map((i) => paragraphs[i]).join("\n\n"),
        excerpt_clipped: selected.length !== paragraphs.length,
      };
    });
}
export async function generate(
  item: Item,
  reading: Reading,
  directory: string,
  settings: Settings,
  stage: Stage,
  cancelled: () => boolean,
  caller = runStructured,
) {
  await mkdir(directory, { recursive: true });
  const writing = await readFile(join(ROOT, "skills/noema/references/writing.md"), "utf8"),
    documents = reading.documents,
    context = documents.map((d) => ({
      id: d.id,
      title: d.title,
      url: d.url,
      excerpt: d.text.slice(0, 45000),
      excerpt_clipped: d.text.length > 45000,
    }));
  const corpus = JSON.stringify({
    sources: context,
    coverage: { scope: reading.scope, gaps: reading.gaps, media_note: reading.media_note },
    learner_goal:
      item.note || "Understand this from first principles, judge its claims, and apply it.",
  });
  async function checkpoint<T>(
    name: string,
    instruction: string,
    schema: z.ZodType<T>,
    jsonSchema?: Record<string, unknown>,
  ): Promise<T> {
    const path = join(directory, name + ".json");
    try {
      return schema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (cancelled()) throw new Cancelled("Preparation stopped.");
    const raw = await caller(
      settings.provider,
      settings.model,
      schemas.SYSTEM + "\n" + writing + "\n" + instruction,
      jsonSchema || z.toJSONSchema(schema),
      900,
      cancelled,
    );
    const value = schema.parse(raw);
    if (cancelled()) throw new Cancelled("Preparation stopped before saving.");
    const temp = path + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
    await rename(temp, path);
    return value;
  }
  stage("writing", "Planning prerequisites and reading blocks.", documents[0].title);
  const plan = await checkpoint(
    "plan",
    'Plan 8–12 topics, up to 20 for a broad goal. Order prerequisite concepts before applications. Name phases as "01 · Foundations". Each focus names one concrete idea; group related topics into roughly 30-minute reading blocks before quizzes. Introduce terms in plain English. Introductions use two short sentences. Review descriptions give situations without revealing verdicts. For every phase, write placement probes: one level-2 (Mechanism) and one level-3 (Frontier) multiple-choice question that a reader who already works at that depth answers quickly and a newcomer cannot guess; never test vocabulary alone.\n' +
      corpus,
    planSchema,
  );
  const sourceIds = new Set(documents.map((d) => d.id));
  if (plan.lessons.some((l) => l.sources.some((id) => !sourceIds.has(id))))
    throw Error("Plan referenced an unknown source.");
  const lessons: Lesson[] = [];
  for (const [i, outline] of plan.lessons.entries()) {
    stage(
      "writing",
      `Writing topic ${i + 1} of ${plan.lessons.length}: ${outline.title}`,
      plan.title,
    );
    const result = await checkpoint(
      "lesson-" + (i + 1),
      "Write one topic at up to three depths, each a self-contained 300–600 word explanation for its reader, never the same text made longer: intuition_html (level 1) for a smart outsider: the concrete situation, the core idea and why it matters; mechanism_html (level 2) for someone who will build or operate it: real moving parts, numbers, code paths and trade-offs; frontier_html (level 3) for a researcher: evidence, how it was measured and where it breaks, competing approaches and open problems. Set a depth to null when it would add nothing (a prerequisite topic may be level 1 only; a specialist topic may be level 3 only). Anchor every level high; do not talk down. Define prerequisites before using them. Explain one small invented example in three steps, with a concrete title. Use a small number of purposeful visuals. Inline illustrations name the level whose text they sit in and go after a numbered top-level paragraph of that text: flow for relationships, binding for a one-site equilibrium occupancy model in nM, screen for natural-frequency true/false positives. Each has its own unique slug id. Use at most two inline illustrations and only where prose has introduced the question. Keep the worked-example visual null if it would repeat an inline illustration. A funnel is only for successive conditional retention rates from the same group. Binding assumes one-to-one binding, equilibrium and free ligand concentration; it says nothing about patient benefit. screen rates are fractions, not percentages. Always label invented assumptions. State units, denominator, assumptions, exact endpoint, and that fractional counts are expectations. Funnel has three gates, one per example step; flow steps are zero-based and ordered. Source_ids must be this lesson’s sources. Do not treat invented rates as measurements. Write one question per written level, tagged with that level; level 1 tests application, level 2 mechanism, level 3 judgment of evidence. Make the question self-contained and answerable from the main reading, with plausible misconceptions and similarly concise options. option_feedback explains the specific reasoning in each option. Do not make the correct answer obvious from length or wording. Transfer task is new, concrete and answerable from this lesson, with reasoning criteria.\n" +
        JSON.stringify({
          outline,
          earlier_lessons: plan.lessons.slice(0, i),
          course_title: plan.title,
          sources: lessonContext(documents, outline),
        }),
      generatedLesson,
      schemas.LESSON,
    );
    const id = "idea-" + (i + 1);
    lessons.push({
      id,
      title: outline.title,
      phase: outline.phase,
      goal: outline.goal,
      needs: i ? ["idea-" + i] : [],
      recall: result.transfer_prompt,
      predict: result.questions.at(-1)!.prompt,
      levels: Object.fromEntries(
        (
          [
            [1, result.intuition_html],
            [2, result.mechanism_html],
            [3, result.frontier_html],
          ] as const
        ).flatMap(([n, html]) => (html ? [[n, cleanHTML(html)]] : [])),
      ),
      example: [result.example_setup, result.example_steps],
      example_title: result.example_title,
      visual: result.visual,
      illustrations: result.illustrations,
      questions: result.questions.map((q, n) => ({ ...q, id: id + "-q" + (n + 1) })),
      transfer: [result.transfer_prompt, result.rubric, result.transfer_example],
      sources: outline.sources,
      takeaway: result.takeaway,
    });
  }
  stage("checking", "Editing explanations and checking the teaching sequence.", plan.title);
  const edited = await checkpoint(
    "editorial-v2",
    "Edit each topic's lowest written level and its example. Keep its length. Define terms and fix jumps in logic. Preserve every fact, number, lesson ID, quiz meaning, transfer task, visual, paragraph count and the relationship between inline illustrations and their preceding paragraphs. Remove slogans. Keep three example steps. Explain each percentage’s denominator and fractional expected counts. Name precise endpoints.\n" +
      JSON.stringify(lessons),
    z
      .object({
        lessons: z
          .array(
            z
              .object({ id: t, lowest_level_html: t, example_setup: t, example_steps: arr(3, 3) })
              .strict(),
          )
          .length(lessons.length),
      })
      .strict(),
  );
  if (
    new Set(edited.lessons.map((l) => l.id)).size !== lessons.length ||
    lessons.some((l) => !edited.lessons.some((e) => e.id === l.id))
  )
    throw Error("Editorial pass omitted a lesson. Drafts are saved.");
  for (const l of lessons) {
    const e = edited.lessons.find((e) => e.id === l.id)!;
    const lowest = ([1, 2, 3] as const).find((n) => l.levels[n])!;
    l.levels[lowest] = cleanHTML(e.lowest_level_html);
    l.example = [e.example_setup, e.example_steps];
  }
  const reviews = [];
  for (const [i, proposal] of plan.reviews.entries()) {
    stage("checking", `Preparing guided review ${i + 1} of ${plan.reviews.length}.`, plan.title);
    const r = await checkpoint(
      "review-" + (i + 1),
      "Write a guided review about: " +
        proposal +
        ". Title must not reveal the answer. Give background, all facts for a small prediction, and a worked review connecting evidence to a decision. Label this an illustrative teaching scenario, not an upstream patch or quote.\n" +
        JSON.stringify({
          course: plan,
          lessons: lessons.map((l) => ({ id: l.id, title: l.title, takeaway: l.takeaway })),
        }) +
        "\n" +
        corpus,
      generatedReview,
      schemas.REVIEW,
    );
    reviews.push({
      id: "review-" + (i + 1),
      kind: "Claim and design review",
      lesson: lessons.at(-1)!.id,
      title: r.title,
      difficulty: "Applied",
      prompt: r.prompt,
      artifact: r.artifact,
      context: r.context,
      repo_paths: [],
      hint: r.hint,
      criteria: r.criteria.map((c, n) => ({ ...c, id: "reason-" + n })),
      follow_up: r.prediction,
      solution: r.solution,
      revision: "1",
      guide: {
        needs: [lessons.at(-1)!.id],
        setup: r.setup,
        terms: r.terms.map((p) => [p.name, p.explanation]),
        reading: r.reading.map((p) => [p.name, p.explanation]),
        trace: r.prediction,
        trace_hint: r.hint,
        takeaway: r.takeaway,
      },
    });
  }
  let about =
    "<h1>What this course is built on</h1><p>" +
    escapeHTML(reading.scope) +
    "</p><p>" +
    escapeHTML(reading.media_note) +
    "</p>";
  if (reading.gaps.length)
    about +=
      "<h2>Reading gaps</h2><ul>" +
      reading.gaps.map((g) => "<li>" + escapeHTML(g) + "</li>").join("") +
      "</ul>";
  if (context.some((d) => d.excerpt_clipped))
    about +=
      "<p>Generation used bounded source excerpts. The local reading manifest records the collected text.</p>";
  const course = {
    META: {
      id: item.id,
      title: plan.title,
      heading: plan.heading,
      eyebrow: "YOUR COURSE",
      introduction: plan.introduction,
      start_label: "START HERE",
      footnote:
        "Read and work through the examples in roughly 30-minute blocks. Questions come together afterward. Deeper reading is optional.",
      placement: plan.placement.map((q, i) => ({ ...q, id: "place-" + (i + 1) })),
      about_html: about,
    },
    CONTENT_REVISION: "generated-" + item.revision,
    LABS: [],
    SOURCES: Object.fromEntries(
      documents.map((d) => [
        d.id,
        [d.title, d.url, "Collected source; teaching examples are original."],
      ]),
    ),
    LESSONS: lessons,
    GLOSSARY: Object.fromEntries(plan.glossary.map((g) => [g.term, g.definition])),
  };
  if (cancelled()) throw new Cancelled("Preparation stopped before publication.");
  const output = join(directory, "course-" + randomUUID().replaceAll("-", "").slice(0, 12));
  await mkdir(output);
  await writeFile(join(output, "course.json"), JSON.stringify(course, null, 2) + "\n");
  await writeFile(join(output, "challenges.json"), JSON.stringify(reviews, null, 2) + "\n");
  loadBundle(output);
  return { output, title: plan.title };
}
