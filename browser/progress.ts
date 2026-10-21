import type { Course } from "../src/course";
import { inPath, view, type LevelState } from "./levels";
type Topic = {
  id: string;
  title?: string;
  phase?: string;
  reading_minutes?: number;
  levels?: Partial<Record<string, unknown>>;
  example?: unknown[];
};
type ReadingBlock<T> = { id: string; index: number; start: number; minutes: number; lessons: T[] };
type Summary = { key: string; size?: number; lessons: Topic[] };
type CourseInfo = Pick<Course, "META" | "LESSONS">;
type ProgressState = LevelState & {
  completed?: Record<string, unknown>;
  read?: Record<string, unknown>;
  lastLesson?: string | null;
  blocks?: Record<string, { step?: string }>;
};
// Minutes for the text at one level; summaries store one estimate per written level.
function minutes(lesson: Topic, level = 1) {
  return (
    lesson.reading_minutes ||
    Math.max(
      5,
      Math.ceil(
        (String(lesson.levels?.[level] || "")
          .replace(/<[^>]*>/g, " ")
          .split(/\s+/).length +
          (Array.isArray(lesson.example?.[1]) ? lesson.example[1] : []).join(" ").split(/\s+/)
            .length) /
          170,
      ) + 3,
    )
  );
}
function blocks<T extends Topic>(lessons: T[], size?: number): ReadingBlock<T>[] {
  const count = Number.isInteger(size) && size! >= 2 && size! <= 12 ? size : undefined,
    result: ReadingBlock<T>[] = [];
  for (let i = 0; i < lessons.length;) {
    const start = i,
      topics: T[] = [];
    let duration = 0;
    do {
      const lesson = lessons[i++];
      topics.push(lesson);
      duration += minutes(lesson);
    } while (i < lessons.length && (count ? topics.length < count : duration < 30));
    result.push({
      id: "block-" + topics.map((l) => l.id).join("."),
      index: result.length,
      start,
      minutes: duration,
      lessons: topics,
    });
  }
  if (result.length > 1 && result.at(-1)!.lessons.length === 1) {
    const last = result.pop()!,
      previous = result.at(-1)!;
    previous.lessons.push(...last.lessons);
    previous.minutes += last.minutes;
    previous.id = "block-" + previous.lessons.map((l) => l.id).join(".");
  }
  return result;
}
function summary(course: CourseInfo): Summary {
  if (!course.META || !course.LESSONS?.length) throw Error("Course metadata unavailable.");
  return {
    key: course.META.progress_key || "noema:" + course.META.id,
    size: course.META.reading_block_size,
    lessons: course.LESSONS.map((l) => ({
      id: l.id,
      title: l.title,
      phase: l.phase,
      // Placeholders keep which levels exist; values are minutes, not text.
      levels: Object.fromEntries(
        Object.keys(l.levels).map((n) => [n, minutes({ ...l, reading_minutes: undefined }, +n)]),
      ),
      reading_minutes: l.reading_minutes,
    })),
  };
}
// The topics this learner reads, in order, timed at the level each is shown at.
function path<T extends Topic>(lessons: T[], state: LevelState = {}): T[] {
  return lessons
    .filter((l) => inPath(l, state))
    .map((l) => {
      // Time topics at their section's level, not a one-topic override, so switching depth on
      // one topic never regroups the blocks (block ids come from their topics).
      const level = view(l, { ...state, lessonLevels: {} }).level,
        stored = l.levels?.[level];
      return {
        ...l,
        reading_minutes:
          l.reading_minutes || (typeof stored === "number" ? stored : minutes(l, level)),
      };
    });
}
function snapshot(course: CourseInfo | Summary, state: ProgressState = {}) {
  const info = "lessons" in course ? course : summary(course),
    lessons = path(info.lessons, state);
  if (!lessons.length) throw Error("Course has no topics.");
  const practiced = lessons.filter((l) => state.completed?.[l.id]).length,
    read = lessons.filter((l) => state.read?.[l.id] || state.completed?.[l.id]).length,
    readingBlocks = blocks(lessons, info.size);
  let current =
      lessons.find((l) => l.id === state.lastLesson) ||
      lessons.find((l) => !state.completed?.[l.id]) ||
      lessons[0],
    block = readingBlocks.find((b) => b.lessons.some((l) => l.id === current.id))!,
    step = state.blocks?.[block.id]?.step || "read";
  if (step === "done") {
    block = readingBlocks.find((b) => b.lessons.some((l) => !state.completed?.[l.id])) || block;
    current = block.lessons.find((l) => !state.completed?.[l.id]) || block.lessons.at(-1)!;
    step = state.blocks?.[block.id]?.step || "read";
  }
  if (!["read", "practice", "explain"].includes(step)) step = "read";
  const complete = practiced === lessons.length,
    started = !!state.lastLesson || read > 0 || practiced > 0;
  return {
    kind: "available" as const,
    total: lessons.length,
    read,
    practiced,
    percent: Math.round((100 * read) / lessons.length),
    started,
    complete,
    currentId: current.id,
    currentTitle: current.title || current.id,
    blockIndex: block.index,
    blockCount: readingBlocks.length,
    resumeRoute: complete
      ? "home"
      : "block/" + block.id + "/" + step + (step === "read" && started ? "/" + current.id : ""),
  };
}
function read(course: CourseInfo | Summary, storage: Pick<Storage, "getItem">) {
  try {
    const info = "lessons" in course ? course : summary(course),
      raw = storage.getItem(info.key),
      state = raw === null ? {} : JSON.parse(raw);
    if (!state || typeof state !== "object" || Array.isArray(state))
      throw Error("Saved progress is invalid");
    return snapshot(info, state);
  } catch {
    return { kind: "unavailable" as const };
  }
}
export const progress = { blocks, path, summary, snapshot, read };
declare global {
  interface Window {
    NoemaProgress: typeof progress;
  }
}
if (typeof window !== "undefined") window.NoemaProgress = progress;
