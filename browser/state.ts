export type Compared = { answer: string; revision: string };
export type Answer = {
  choice?: number;
  checked?: boolean;
  correct?: boolean;
  firstCorrect?: boolean;
  firstChoice?: number;
  tries?: number;
  hint?: boolean;
  question_revision?: string;
};
export type ExperimentRow = {
  prefix_length: number;
  max_error: number;
  matches: boolean;
  token_id: number;
  cache_length: number;
  visible_positions: number[];
  weights: number[];
  reference_weights: number[];
  positions: { position: number; token_id: number; value_preview: number[] }[];
  attention_preview: number[];
  reference_logits: number[];
  actual_logits: number[];
};
export type Experiment = {
  case: string;
  rows: ExperimentRow[];
  matches: boolean;
  first_divergence: number | null;
  checks: number;
  groups: { title: string; checks: number; status: string; description: string }[];
};
export type CacheRun = Experiment & {
  start: number;
  prediction: string;
  revision: string;
  at: number;
};
export type CacheLab = {
  start: number;
  prediction: string;
  lastRun?: CacheRun;
  firstAttempt?: { start: number; prediction: string; matches: boolean; at: number };
};
export type ActivityState = {
  values?: Record<string, string>;
  part?: number;
  earlierNotes?: string;
  cacheLab?: CacheLab;
  runs?: unknown;
  comparison?: { revision: string; values: Record<string, string> };
  referenceChecks?: Experiment & { at: number };
};
export type GradeRecord = {
  answer: string;
  grade: {
    summary: string;
    follow_up: string;
    criteria: {
      id: string;
      verdict: "met" | "partial" | "missing" | "unclear";
      evidence: string;
      feedback: string;
    }[];
  };
  meta: {
    provider: string;
    model: string;
    seconds: number;
    context_note: string;
    exercise_revision: string;
    content_revision: string;
  };
};
export type SavedState = {
  version: number;
  depth?: unknown;
  capstone?: unknown;
  answers: Record<string, Answer>;
  notes: Record<string, string>;
  rubrics: Record<string, unknown>;
  cards: Record<string, { due?: number; stage?: number; lastRating?: string }>;
  challengeAnswers: Record<string, string>;
  grades: Record<string, GradeRecord>;
  activities: Record<string, ActivityState>;
  flow: Record<string, { step: string; part?: number }>;
  read: Record<string, { at: number }>;
  blocks: Record<string, { step: string }>;
  completed: Record<string, { at: number }>;
  selfChecks: Record<string, Compared>;
  reviews: Record<
    string,
    {
      step: string;
      prediction?: string;
      hint?: boolean;
      comparison?: Compared;
      completedAt?: number;
    }
  >;
  lastLesson: string | null;
  // The course level (pass) being read; other passes' progress waits in `tracks`.
  level?: number;
  tracks?: Record<string, object>;
  // Older saves chose depth per section and per topic; read once to migrate.
  levels?: Record<string, number>;
  lessonLevels?: Record<string, number>;
  placed?: boolean;
  placement?: Record<string, number>;
};
export type Execution =
  | { kind: "idle" }
  | { kind: "running"; case: string }
  | { kind: "failed"; case: string; message: string };
export type AssessmentState =
  | { kind: "idle"; id?: undefined }
  | { kind: "grading"; id: string }
  | { kind: "failed"; id: string; message: string };
export type SourceState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; functions: Record<string, string> }
  | { kind: "failed"; message: string };
export type Walkthrough =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; baseline: Experiment; broken: Experiment }
  | { kind: "failed"; message: string };
