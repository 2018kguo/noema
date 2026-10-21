import type { Course } from "./course";
import { paragraphCount, extractArticle } from "./html";
import { available, LEVEL_NAMES } from "../browser/levels";
import { tells, titleTells, arithmetic, repetition } from "./tells";

// An authoring inventory, not a claim that a course teaches well. It flags the problems readers
// reported: LLM tells, examples and questions whose difficulty is arithmetic, and examples with no
// level of their own.
function repeats(lesson: Course["LESSONS"][number], n: number) {
  return repetition(
    lesson.levels[n as 1] || "",
    available(lesson)
      .filter((m) => m < n)
      .map((m) => lesson.levels[m])
      .join(" "),
  );
}
export function inspectCourse(course: Course) {
  return course.LESSONS.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    phase: lesson.phase,
    levels: available(lesson).map((n) => ({
      repeats: repeats(lesson, n),
      level: n + " · " + LEVEL_NAMES[n],
      paragraphs: paragraphCount(lesson.levels[n]!),
      words: extractArticle(lesson.levels[n]!).blocks.join(" ").split(/\s+/).filter(Boolean).length,
      illustrations: (lesson.illustrations || [])
        .filter((i) => i.level === n)
        .map((i) => ({ id: i.id, after_paragraph: i.after_paragraph, kind: i.visual.kind })),
      questions: lesson.questions.filter((q) => q.level === n).map((q) => q.prompt),
    })),
    example_visual: lesson.visual?.kind || null,
    example: lesson.example
      ? {
          title: lesson.example_title || null,
          level: lesson.example_level ?? available(lesson)[0],
          arithmetic: arithmetic(lesson.example[0] + " " + lesson.example[1].join(" ")) >= 3,
        }
      : null,
    arithmetic_questions: lesson.questions
      .filter((q) => arithmetic(q.prompt + " " + q.options.join(" ")) >= 2)
      .map((q) => q.id),
    tells: [
      ...[lesson.title, lesson.phase.replace(/^\d+ · /, ""), lesson.example_title || ""]
        .flatMap(titleTells)
        .map((t) => `Title: ${t.kind}: ${t.sentence}`),
      ...tells(lesson.goal).map((t) => `Goal: ${t.kind}: ${t.sentence}`),
      ...available(lesson).flatMap((n) =>
        tells(lesson.levels[n]!).map((t) => `${LEVEL_NAMES[n]}: ${t.kind}: ${t.sentence}`),
      ),
      ...lesson.questions.flatMap((q) =>
        tells([q.prompt, ...q.options, q.why, ...(q.option_feedback || [])].join(" ")).map(
          (t) => `Question ${q.id}: ${t.kind}: ${t.sentence}`,
        ),
      ),
    ].filter((line, i, all) => all.indexOf(line) === i),
  }));
}
// Strong tells per 100 words of lesson text: the number to drive down, as in Sprout's tell-eval.
export function tellRate(course: Course) {
  const text = course.LESSONS.flatMap((l) => available(l).map((n) => l.levels[n]!)).join(" ");
  const words = text
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean).length,
    hits = tells(text);
  const byKind: Record<string, number> = {};
  for (const h of hits) byKind[h.kind] = (byKind[h.kind] || 0) + 1;
  return {
    words,
    strong: hits.filter((h) => h.strong).length,
    per100: +((100 * hits.filter((h) => h.strong).length) / words).toFixed(2),
    titles: course.LESSONS.flatMap((l) => titleTells(l.title)).length,
    byKind,
  };
}
