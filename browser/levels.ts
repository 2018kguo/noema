// Depth levels. Each topic is written at one or more levels; the learner's level per course
// section (set by placement, changeable later) picks the text, the quiz question and the path.
export type Level = 1 | 2 | 3;
export const LEVELS: Level[] = [1, 2, 3];
export const LEVEL_NAMES: Record<Level, string> = { 1: "Intuition", 2: "Mechanism", 3: "Frontier" };
export type LevelState = {
  levels?: Record<string, number>;
  lessonLevels?: Record<string, number>;
  placed?: boolean;
};
type Leveled = { id: string; phase?: string; levels?: Partial<Record<string, unknown>> };

const valid = (n: unknown): n is Level => n === 1 || n === 2 || n === 3;
export const available = (lesson: Leveled) =>
  LEVELS.filter((n) => lesson.levels?.[n] !== undefined && lesson.levels?.[n] !== null);

export function chosen(lesson: Leveled, state: LevelState): Level {
  const own = state.lessonLevels?.[lesson.id],
    section = lesson.phase ? state.levels?.[lesson.phase] : undefined;
  return valid(own) ? own : valid(section) ? section : 1;
}

// "fit": written at your level. "below": only easier levels exist, so placement skips it.
// "above": only deeper levels exist; it stays in your path as a stretch.
export function view(lesson: Leveled, state: LevelState) {
  const want = chosen(lesson, state),
    have = available(lesson);
  if (!have.length) throw Error("Topic has no levels: " + lesson.id);
  if (have.includes(want)) return { level: want, status: "fit" as const, want };
  if (have.at(-1)! < want) return { level: have.at(-1)!, status: "below" as const, want };
  return { level: have.find((n) => n > want)!, status: "above" as const, want };
}

// A topic below your level leaves the path unless you chose to read it.
export const inPath = (lesson: Leveled, state: LevelState) =>
  view(lesson, state).status !== "below" || valid(state.lessonLevels?.[lesson.id]);

export type PlacementQuestion = { id: string; phase: string; level?: number; correct: number };
// Per section: all Mechanism probes right → 2; all Frontier probes right as well → 3.
export function place(questions: PlacementQuestion[], choices: Record<string, number | undefined>) {
  const result: Record<string, Level> = {};
  for (const phase of new Set(questions.map((q) => q.phase))) {
    const right = (level: number) => {
      const probes = questions.filter((q) => q.phase === phase && q.level === level);
      return probes.length > 0 && probes.every((q) => choices[q.id] === q.correct);
    };
    result[phase] = right(2) ? (right(3) ? 3 : 2) : 1;
  }
  return result;
}
