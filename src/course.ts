import { z } from "zod";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { join } from "node:path";
export const text = z.string().trim().min(1);
export const questionSchema = z
  .object({
    id: text,
    prompt: text,
    options: z.array(text).min(2),
    correct: z.number().int().nonnegative(),
    why: text,
    hint: text,
    revision: z.string().optional(),
  })
  .refine((q) => q.correct < q.options.length, "Invalid answer index");
const visualText = text.max(1500),
  step = z.number().int().nonnegative();
export const visualSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("funnel"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      initial: z.number().positive().max(1e12),
      unit: visualText,
      start_label: visualText,
      adjustable_stage: step,
      stages: z
        .array(z.object({ label: visualText, rate: z.number().min(0).max(1) }).strict())
        .min(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal("flow"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      nodes: z
        .array(z.object({ label: visualText, detail: visualText, step }).strict())
        .min(2)
        .max(6),
    })
    .strict(),
]);
export const lessonSchema = z.object({
  id: text,
  title: text,
  phase: text,
  goal: text,
  recall: text,
  predict: text,
  takeaway: text,
  needs: z.array(text),
  sources: z.array(text),
  layers: z.tuple([text, text, text]),
  example: z.tuple([text, z.array(text).min(2)]),
  example_title: z.string().optional(),
  questions: z.array(questionSchema).length(3),
  transfer: z.tuple([text, z.array(text).min(1), text]),
  assessment_revision: z.string().optional(),
  reading_minutes: z.number().positive().optional(),
  visual: visualSchema.nullish(),
  activity: z
    .object({ kind: z.enum(["workshop", "check", "worksheet"]), revision: text })
    .passthrough()
    .optional(),
});
export const criterionSchema = z.object({ id: text, label: text, rule: text, feedback: text });
export const assessmentSchema = z.object({
  id: text,
  title: text,
  prompt: text,
  artifact: text,
  context: text,
  revision: text,
  repo_paths: z.array(text),
  criteria: z.array(criterionSchema).min(1),
  follow_up: text,
});
export const challengeSchema = assessmentSchema
  .extend({ solution: text, guide: z.object({ needs: z.array(text) }).passthrough() })
  .passthrough();
export const courseSchema = z.object({
  META: z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      title: text,
      heading: text,
      introduction: text,
      eyebrow: text,
      start_label: text,
      footnote: text,
      about_html: text,
      depth_labels: z.tuple([text, text]),
      progress_key: z.string().optional(),
      reading_block_size: z.number().int().min(2).max(12).optional(),
    })
    .passthrough(),
  CONTENT_REVISION: text,
  LABS: z.array(z.literal("tiny-engine")).default([]),
  LESSONS: z.array(lessonSchema).min(1),
  SOURCES: z.record(
    z.string(),
    z.tuple([text, z.url().refine((u) => ["http:", "https:"].includes(new URL(u).protocol)), text]),
  ),
  CARDS: z.array(z.tuple([text, text, text, text])),
  GLOSSARY: z.record(z.string(), text),
});
export type Course = z.infer<typeof courseSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type Challenge = z.infer<typeof challengeSchema>;
export type CourseBundle = {
  path: string;
  course: Course;
  challenges: Record<string, Challenge>;
  assessments: Record<string, Assessment>;
};
export const ROOT = realpathSync(
  existsSync(join(import.meta.dir, "index.html")) ? import.meta.dir : join(import.meta.dir, ".."),
);
export const READER_ASSETS = [
  "index.html",
  "app.js",
  "style.css",
  "lesson-ui.css",
  "visuals.js",
  "progress.js",
  "vendor/reader-ui.js",
  "vendor/reader-ui.js.LEGAL.txt",
  "vendor/reader-ui.css",
  "vendor/geist-latin-wght-normal.woff2",
  "vendor/THIRD-PARTY-LICENSES.txt",
  "vendor/manifest.json",
];
function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw Error("Duplicate " + label);
}
export function validateCourse(raw: unknown, rawChallenges: unknown) {
  const course = courseSchema.parse(raw),
    challenges = z.array(challengeSchema).parse(rawChallenges);
  const ids = new Set(course.LESSONS.map((l) => l.id));
  unique([...course.LESSONS.map((l) => l.id)], "lesson");
  unique(
    course.LESSONS.flatMap((l) => l.questions.map((q) => q.id)),
    "question",
  );
  unique(
    challenges.map((c) => c.id),
    "challenge",
  );
  const contains = (values: string[], set: Set<string>, label: string) => {
    if (values.some((v) => !set.has(v))) throw Error("Unknown " + label);
  };
  for (const l of course.LESSONS) {
    contains(l.needs, ids, "prerequisite");
    contains(l.sources, new Set(Object.keys(course.SOURCES)), "source");
    const v = l.visual;
    if (v) {
      contains(v.source_ids, new Set(l.sources), "visual source");
      if (
        v.kind === "funnel" &&
        (v.stages.length !== l.example[1].length || v.adjustable_stage >= v.stages.length)
      )
        throw Error("Invalid funnel gate");
      if (
        v.kind === "flow" &&
        v.nodes.some(
          (n, i) => n.step >= l.example[1].length || (i > 0 && n.step < v.nodes[i - 1].step),
        )
      )
        throw Error("Invalid flow order");
    }
    if (
      l.activity?.kind === "workshop" &&
      (l.id !== "workshop" || !course.LABS.includes("tiny-engine"))
    )
      throw Error("Cache lab requires the tiny-engine plugin and workshop lesson id");
  }
  for (const c of challenges) {
    if (c.id.startsWith("lesson-")) throw Error("Reserved challenge prefix");
    contains(c.guide.needs, ids, "challenge prerequisite");
    unique(
      c.criteria.map((r) => r.id),
      "criterion",
    );
  }
  for (const c of course.CARDS) contains([c[3]], ids, "recall lesson");
  return { course, challenges };
}
export function loadBundle(path: string): CourseBundle {
  path = realpathSync(path);
  const { course, challenges } = validateCourse(
    JSON.parse(readFileSync(join(path, "course.json"), "utf8")),
    JSON.parse(readFileSync(join(path, "challenges.json"), "utf8")),
  );
  const tasks: Assessment[] = course.LESSONS.map((l) => ({
    id: "lesson-" + l.id,
    title: l.title,
    prompt: l.transfer[0],
    revision: l.assessment_revision || course.CONTENT_REVISION,
    artifact: "Explain the idea in your own words; use a concrete example where helpful.",
    context: l.layers.join("\n"),
    repo_paths: [],
    criteria: l.transfer[1].map((rule, i) => ({
      id: "reason-" + i,
      label: rule,
      rule: "The answer correctly demonstrates this requirement: " + rule,
      feedback: "Make this reasoning explicit: " + rule,
    })),
    follow_up: l.predict,
  }));
  return {
    path,
    course,
    challenges: Object.fromEntries(challenges.map((c) => [c.id, c])),
    assessments: Object.fromEntries([...challenges, ...tasks].map((c) => [c.id, c])),
  };
}
