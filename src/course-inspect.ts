import type { Course } from "./course";
import { paragraphCount, extractArticle } from "./html";
import { progress } from "../browser/progress";

// An authoring inventory, not a claim that a course teaches well.
export function inspectCourse(course: Course) {
  return progress.blocks(course.LESSONS, course.META.reading_block_size).map((block) => ({
    block: block.id,
    estimated_minutes: block.minutes,
    reading: "#block/" + block.id + "/read",
    quiz: "#block/" + block.id + "/practice",
    topics: block.lessons.map((lesson) => {
      const question = lesson.questions[lesson.quiz_question ?? 0];
      return {
        id: lesson.id,
        title: lesson.title,
        paragraphs: paragraphCount(lesson.layers[0]),
        words: extractArticle(lesson.layers[0]).blocks.join(" ").split(/\s+/).filter(Boolean)
          .length,
        illustrations: (lesson.illustrations || []).map((i) => ({
          id: i.id,
          after_paragraph: i.after_paragraph,
          kind: i.visual.kind,
          question: i.visual.title,
        })),
        example_visual: lesson.visual?.kind || null,
        quiz: {
          id: question.id,
          depth: (lesson.quiz_question ?? 0) + 1,
          prompt: question.prompt,
          options: question.options,
          correct: question.correct,
          why: question.why,
          option_feedback: question.option_feedback || null,
        },
      };
    }),
  }));
}
