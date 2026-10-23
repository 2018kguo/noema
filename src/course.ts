import { z } from "zod";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paragraphCount } from "./html";
import { available, LEVELS } from "../browser/levels";
export const text = z.string().trim().min(1);
export const levelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const questionSchema = z
  .object({
    id: text,
    prompt: text,
    options: z.array(text).min(2),
    correct: z.number().int().nonnegative(),
    why: text,
    hint: text,
    option_feedback: z.array(text).optional(),
    level: levelSchema,
    revision: z.string().optional(),
  })
  .passthrough()
  .refine((q) => q.correct < q.options.length, "Invalid answer index")
  .refine(
    (q) => !q.option_feedback || q.option_feedback.length === q.options.length,
    "Feedback must cover every option",
  );
const visualText = text.max(1500),
  step = z.number().int().nonnegative();
const finite = z.number().finite(),
  pointSchema = z.object({ x: finite, y: finite }).strict(),
  axisSchema = z
    .object({ label: visualText, log: z.boolean(), min: finite, max: finite })
    .strict()
    .refine((a) => a.max > a.min && (!a.log || a.min > 0), "Axis range must be valid");
export const visualSchema = z.discriminatedUnion("kind", [
  // Rich media from the open web: an image (diagram, photo, chart) or a YouTube video.
  z
    .object({
      kind: z.literal("image"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      url: z.url().refine((u) => u.startsWith("https://"), "Images load over https"),
      alt: visualText,
      credit: visualText,
      credit_url: z.url(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("video"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      youtube_id: z.string().regex(/^[\w-]{11}$/),
      start: z.number().int().nonnegative().optional(),
      credit: visualText,
    })
    .strict(),
  // A video file a source embeds directly (an X post's clip, a page's <video>).
  z
    .object({
      kind: z.literal("clip"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      src: z
        .url()
        .refine(
          (u) => u.startsWith("https://") && /\.(mp4|webm)(\?|$)/.test(u),
          "An https video file",
        ),
      credit: visualText,
    })
    .strict(),
  // A chart drawn by the reader from numbers: lines or points on linear or log axes.
  z
    .object({
      kind: z.literal("plot"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      x: axisSchema,
      y: axisSchema,
      series: z
        .array(
          z
            .object({
              label: visualText,
              style: z.enum(["line", "points"]),
              points: z.array(pointSchema).min(2).max(60),
            })
            .strict(),
        )
        .min(1)
        .max(4),
      marks: z
        .array(pointSchema.extend({ label: visualText }).strict())
        .max(6)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("schedule"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      predict: visualText,
      adjustable_task: text,
      max_duration: z.number().positive().max(1000),
      tasks: z
        .array(
          z
            .object({
              id: text,
              label: visualText,
              duration: z.number().nonnegative().max(1000),
              after: z.array(text),
            })
            .strict(),
        )
        .min(2)
        .max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("binding"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      kd_nm: z.number().positive().max(1e9),
      ligand_nm: z.number().nonnegative().max(1e9),
      max_nm: z.number().positive().max(1e9),
      predict: visualText,
    })
    .strict(),
  z
    .object({
      kind: z.literal("screen"),
      title: visualText,
      caption: visualText,
      source_ids: z.array(text),
      population: z.number().int().positive().max(1e9),
      prevalence: z.number().min(0).max(1),
      sensitivity: z.number().min(0).max(1),
      false_positive_rate: z.number().min(0).max(1),
      predict: visualText,
    })
    .strict(),
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
export const illustrationSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    level: levelSchema,
    after_paragraph: z.number().int().min(1).max(80),
    visual: visualSchema,
  })
  .strict();
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
  // HTML for each depth this topic is written at: 1 Intro, 2 High level, 3 Depth.
  levels: z
    .object({ 1: text.optional(), 2: text.optional(), 3: text.optional() })
    .strict()
    .refine((v) => LEVELS.some((n) => v[n]), "A topic needs at least one level"),
  // One concrete case, shown only at the depth it was written for (default: the lowest written
  // level). Optional: no example beats a filler one.
  example: z.tuple([text, z.array(text).min(2)]).optional(),
  example_title: z.string().optional(),
  example_level: levelSchema.optional(),
  questions: z.array(questionSchema).min(1).max(6),
  illustrations: z.array(illustrationSchema).max(4).optional(),
  transfer: z.tuple([text, z.array(text).min(1), text]),
  assessment_revision: z.string().optional(),
  reading_minutes: z.number().positive().optional(),
  visual: visualSchema.nullish(),
  activity: z
    .object({ kind: z.enum(["workshop", "check", "worksheet"]), revision: text })
    .passthrough()
    .optional(),
});
type Visual = NonNullable<z.infer<typeof lessonSchema>["visual"]>;
const has = (values: string[], set: Set<string>, label: string) => {
  if (values.some((v) => !set.has(v))) throw Error("Unknown " + label);
};
// Rules zod can't express: steps and gates must match the example, and the model must be drawable.
// Generation uses this to drop one bad figure instead of failing a whole course.
export function checkVisual(
  v: Visual,
  l: Pick<z.infer<typeof lessonSchema>, "sources" | "example">,
  inExample: boolean,
) {
  has(v.source_ids, new Set(l.sources), "visual source");
  if (
    v.kind === "funnel" &&
    ((inExample && v.stages.length !== (l.example?.[1].length ?? 0)) ||
      v.adjustable_stage >= v.stages.length)
  )
    throw Error("Invalid funnel gate");
  if (
    v.kind === "flow" &&
    v.nodes.some(
      (n, i) =>
        n.step >= (inExample ? (l.example?.[1].length ?? 0) : v.nodes.length) ||
        (i > 0 && n.step < v.nodes[i - 1].step),
    )
  )
    throw Error("Invalid flow order");
  if (v.kind === "plot") {
    const inside = (p: { x: number; y: number }) =>
      p.x >= v.x.min && p.x <= v.x.max && p.y >= v.y.min && p.y <= v.y.max;
    if (![...v.series.flatMap((s) => s.points), ...(v.marks || [])].every(inside))
      throw Error("Plot points must lie inside the axis ranges");
  }
  if (v.kind === "binding" && (v.ligand_nm > v.max_nm || v.kd_nm > v.max_nm))
    throw Error("Binding plot must include the initial concentration and Kd");
  if (v.kind === "schedule") {
    unique(
      v.tasks.map((t) => t.id),
      "schedule task",
    );
    const seen = new Set<string>();
    for (const task of v.tasks) {
      has(task.after, seen, "earlier schedule dependency");
      seen.add(task.id);
    }
    const task = v.tasks.find((t) => t.id === v.adjustable_task);
    if (!task || task.duration > v.max_duration) throw Error("Invalid adjustable schedule task");
  }
}
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
      // Rendered as plain text on the course home; HTML here shows up as raw tags.
      introduction: text.max(600).refine((v) => !/[<>]/.test(v), "Introduction must be plain text"),
      eyebrow: text,
      start_label: text,
      footnote: text.optional(),
      about_html: text,
      // The link that started the course, shown so people remember where it came from.
      origin: z
        .object({
          url: z.url(),
          title: text,
          image: z.url().optional(),
        })
        .strict()
        .optional(),
      // Probes that set a starting level per course section (phase).
      placement: z
        .array(
          z
            .object({
              id: text,
              phase: text,
              level: z.union([z.literal(2), z.literal(3)]),
              prompt: text,
              options: z.array(text).min(2).max(5),
              correct: z.number().int().nonnegative(),
              why: text,
            })
            .strict()
            .refine((q) => q.correct < q.options.length, "Invalid answer index"),
        )
        .optional(),
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
// Source ids are keys for links, not names a reader understands, so only text outside tags
// counts: a data-source attribute is a citation however the model quoted it. Generation checks
// each answer with this so a leaked id gets a corrected retry instead of failing the course.
export const showsSourceIds = (value: unknown) =>
  /\bsource\d+\b/i.test(
    JSON.stringify(value, (k, v) =>
      ["sources", "source_ids"].includes(k)
        ? undefined
        : typeof v === "string"
          ? v.replace(/<[^>]*>/g, " ")
          : v,
    ),
  );
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
  const placement = course.META.placement || [];
  unique(
    placement.map((q) => q.id),
    "placement question",
  );
  contains(
    placement.map((q) => q.phase),
    new Set(course.LESSONS.map((l) => l.phase)),
    "placement section",
  );
  for (const [label, value] of [
    ...course.LESSONS.map((l) => [l.id, l] as const),
    ...challenges.map((c) => [c.id, c] as const),
    ["glossary", course.GLOSSARY] as const,
  ])
    if (showsSourceIds(value))
      throw Error("Name sources in prose instead of using their ids: " + label);
  // Hover links must resolve: terms to the glossary, citations to a listed source.
  const html = JSON.stringify([course.LESSONS, challenges, course.META.about_html]);
  contains(
    [...html.matchAll(/data-term=\\?"([^"\\]+)/g)].map((m) => m[1]),
    new Set(Object.keys(course.GLOSSARY)),
    "glossary term",
  );
  contains(
    [...html.matchAll(/data-source=\\?"([^"\\]+)/g)].map((m) => m[1]),
    new Set(Object.keys(course.SOURCES)),
    "cited source",
  );
  for (const l of course.LESSONS) {
    contains(l.needs, ids, "prerequisite");
    contains(l.sources, new Set(Object.keys(course.SOURCES)), "source");
    unique(
      (l.illustrations || []).map((v) => v.id),
      "illustration",
    );
    const have = available(l);
    if (l.example_level && !have.includes(l.example_level))
      throw Error("Example is set at a level the topic lacks: " + l.id);
    if (l.visual && !l.example) throw Error("The example's visual needs an example: " + l.id);
    for (const n of have)
      if (!l.questions.some((q) => q.level === n))
        throw Error(`Level ${n} of ${l.id} has no question`);
    if (l.questions.some((q) => !have.includes(q.level)))
      throw Error("Question targets a level the topic lacks: " + l.id);
    for (const illustration of l.illustrations || [])
      if (illustration.after_paragraph > paragraphCount(l.levels[illustration.level] || ""))
        throw Error("Illustration placement exceeds that level's paragraphs: " + l.id);
    for (const visual of [l.visual, ...(l.illustrations || []).map((i) => i.visual)])
      if (visual) checkVisual(visual, l, visual === l.visual);
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
    context: LEVELS.map((n) => l.levels[n] || "").join("\n"),
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
