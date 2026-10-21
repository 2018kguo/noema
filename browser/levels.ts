// A course is taught in three passes over the same subject: Intro, then High level, then Depth.
// Each topic is written at one or more levels; a pass reads the topics written at its level, with
// that level's text and questions, and keeps its own reading progress.
export type Level = 1 | 2 | 3;
export const LEVELS: Level[] = [1, 2, 3];
export const LEVEL_NAMES: Record<Level, string> = { 1: "Intro", 2: "High level", 3: "Depth" };
export const LEVEL_BLURBS: Record<Level, string> = {
  1: "The situation, the core idea and why it matters.",
  2: "How it works: the moving parts, numbers and trade-offs.",
  3: "The evidence, where it breaks and what’s still open.",
};
export type LevelState = { level?: number; tracks?: Record<string, object> };
type Leveled = { id: string; levels?: Partial<Record<string, unknown>> };

const valid = (n: unknown): n is Level => n === 1 || n === 2 || n === 3;
export const available = (lesson: Leveled) =>
  LEVELS.filter((n) => lesson.levels?.[n] !== undefined && lesson.levels?.[n] !== null);
export const levelOf = (state: LevelState): Level => (valid(state.level) ? state.level : 1);
export const passes = (lessons: Leveled[]) =>
  LEVELS.filter((n) => lessons.some((l) => available(l).includes(n)));

// The text a topic is shown at: the course's level, or the nearest written one when a topic is
// opened outside its pass (an old link, a related-topic link).
export function levelFor(lesson: Leveled, state: LevelState): Level {
  const want = levelOf(state),
    have = available(lesson);
  if (!have.length) throw Error("Topic has no levels: " + lesson.id);
  return have.includes(want)
    ? want
    : have.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
}
export const inPath = (lesson: Leveled, state: LevelState) =>
  available(lesson).includes(levelOf(state));

// Progress that belongs to one pass. The live fields hold the current pass; the others wait in
// `tracks` until the learner switches to them.
export const TRACK_FIELDS = ["read", "completed", "blocks", "flow", "lastLesson"] as const;
export function trackState<T extends LevelState>(state: T, level: Level): T {
  if (level === levelOf(state)) return state;
  return {
    ...state,
    read: {},
    completed: {},
    blocks: {},
    flow: {},
    lastLesson: null,
    ...state.tracks?.[level],
    level,
  };
}
export function switchTrack<T extends LevelState>(state: T, level: Level): T {
  const current = levelOf(state);
  if (level === current) return state;
  const parked = Object.fromEntries(TRACK_FIELDS.map((k) => [k, state[k as keyof T]]));
  const next = trackState({ ...state, tracks: { ...state.tracks, [current]: parked } }, level);
  delete next.tracks![level];
  return next;
}

export type PlacementQuestion = { id: string; phase: string; level?: number; correct: number };
// Start at High level when you get at least three in four High-level probes right, and at Depth
// when you do the same with the Depth probes as well.
export function place(
  questions: PlacementQuestion[],
  choices: Record<string, number | undefined>,
): Level {
  const share = (level: number) => {
    const probes = questions.filter((q) => q.level === level);
    return probes.length
      ? probes.filter((q) => choices[q.id] === q.correct).length / probes.length
      : 0;
  };
  return share(2) >= 0.75 ? (share(3) >= 0.75 ? 3 : 2) : 1;
}
