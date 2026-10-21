import type { Course } from "./course";
import { paragraphCount, extractArticle } from "./html";
import { available, LEVEL_NAMES } from "../browser/levels";

// An authoring inventory, not a claim that a course teaches well.
export function inspectCourse(course: Course) {
  return course.LESSONS.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    phase: lesson.phase,
    levels: available(lesson).map((n) => ({
      level: n + " · " + LEVEL_NAMES[n],
      paragraphs: paragraphCount(lesson.levels[n]!),
      words: extractArticle(lesson.levels[n]!).blocks.join(" ").split(/\s+/).filter(Boolean).length,
      illustrations: (lesson.illustrations || [])
        .filter((i) => i.level === n)
        .map((i) => ({ id: i.id, after_paragraph: i.after_paragraph, kind: i.visual.kind })),
      questions: lesson.questions.filter((q) => q.level === n).map((q) => q.prompt),
    })),
    example_visual: lesson.visual?.kind || null,
  }));
}
