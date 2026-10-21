import type {
  SavedState,
  Execution,
  AssessmentState,
  SourceState,
  Walkthrough,
  ActivityState,
  CacheLab,
} from "./state";
import {
  available,
  levelFor,
  levelOf,
  passes,
  place,
  switchTrack,
  trackState,
  LEVEL_BLURBS,
  LEVEL_NAMES,
  type Level,
} from "./levels";
import { icon } from "./icons";
import { sourceHref } from "./links";

const KEY = META.progress_key || "noema:" + META.id;
const emptyState = (): SavedState => ({
  version: 6,
  answers: {},
  notes: {},
  rubrics: {},
  cards: {},
  challengeAnswers: {},
  grades: {},
  activities: {},
  flow: {},
  read: {},
  blocks: {},
  completed: {},
  selfChecks: {},
  reviews: {},
  lastLesson: null,
});
let state = emptyState();
let storageOK = true;
try {
  state = { ...emptyState(), ...JSON.parse(localStorage.getItem(KEY) || "{}") };
} catch {
  storageOK = false;
}
delete state.depth;
// Depth used to be chosen per section and per topic; it is now one level for the whole course.
if (state.level === undefined && state.levels)
  state.level = Math.min(...Object.values(state.levels));
delete state.levels;
delete state.lessonLevels;
if (!passes(LESSONS).includes(levelOf(state))) state.level = passes(LESSONS)[0];
const previousBrief = state.notes["project-brief"];
if (previousBrief) {
  state.activities.bench = { ...state.activities.bench, earlierNotes: previousBrief };
  delete state.notes["project-brief"];
}
delete state.capstone;
const previousWorkshop = state.activities.workshop;
if (previousWorkshop && !previousWorkshop.cacheLab) {
  const predictions = Object.entries(previousWorkshop.values || {})
    .filter(([key, value]) => key.startsWith("prediction-") && value)
    .map(([key, value]) => `${key.slice(11)}: ${value}`);
  if (predictions.length)
    previousWorkshop.earlierNotes = [previousWorkshop.earlierNotes, ...predictions]
      .filter(Boolean)
      .join("\n\n");
  delete previousWorkshop.values;
  delete previousWorkshop.runs;
  delete previousWorkshop.part;
  previousWorkshop.cacheLab = { start: 1, prediction: "" };
}
state.version = 6;
let readingObserver = null;
// Set for one render when the reader should stay put (a depth switch re-renders in place).
let keepScroll = false;
let challenges = [];
let serverStatus = null;
let assessment: AssessmentState = { kind: "idle" };
let workshopExecution: Execution = { kind: "idle" };
let workshopSource: SourceState = { kind: "idle" };
let cacheWalkthrough: Walkthrough = { kind: "idle" };
let activeWorkshopSource = "cached_step";
const WORKSHOP_FUNCTIONS = [
  [
    "full_logits",
    "Recalculate the complete prefix",
    "This reference path rebuilds all token positions and applies causal attention to each prefix.",
  ],
  [
    "cached_step",
    "Process one new position",
    "This path appends the new key and value, then reads the visible cache. Compare its read boundary with the reference.",
  ],
  [
    "attention",
    "Mix the visible values",
    "Scores become probabilities, and those probabilities weight the value vectors.",
  ],
  [
    "attention_weights",
    "Calculate each visible entry’s weight",
    "The query is compared with the visible keys, then softmax converts the scores into mixture weights.",
  ],
  [
    "input_vector",
    "Look up the token and position",
    "The input combines a token embedding with a learned position vector and enforces the context limit.",
  ],
  [
    "finish_block",
    "Finish the model block",
    "The attention result feeds residual additions and the small feed-forward calculation.",
  ],
  [
    "output_logits",
    "Produce next-token scores",
    "The output head calculates scores, with an optional constructed low-rank update.",
  ],
  [
    "generate",
    "Repeat the next-token loop",
    "This loop can use either cached execution or the full-prefix reference.",
  ],
];
const $ = (selector: string): HTMLInputElement & HTMLTextAreaElement & HTMLFormElement =>
  document.querySelector<HTMLInputElement & HTMLTextAreaElement & HTMLFormElement>(selector);
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const lookup = (id) => LESSONS.find((lesson) => lesson.id === id);
const saved = (id) => state.answers[id] || {};
const savedQuestion = (q) =>
  q.revision && saved(q.id).question_revision !== q.revision ? {} : saved(q.id);
const sourceLinks = (ids) =>
  `<div class="source-links">${ids.map((id) => `<a href="${e(SOURCES[id][1])}" target="_blank" rel="noopener">${e(SOURCES[id][0])} ↗</a>`).join("")}</div>`;
const STEPS = [
  { id: "learn", label: "Learn" },
  { id: "example", label: "See an example" },
  { id: "check", label: "Try it" },
  { id: "explain", label: "Explain it back" },
];
const REVIEW_STEPS = [
  { id: "background", label: "Get the background" },
  { id: "change", label: "Read the change" },
  { id: "predict", label: "Predict a result" },
  { id: "write", label: "Write your review" },
];

function save() {
  if (!storageOK) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    storageOK = false;
  }
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 2600);
}
function focusContent() {
  $("#main").focus({ preventScroll: true });
}
function go(route) {
  if (location.hash.slice(1) === route) {
    render();
    window.scrollTo(0, 0);
    focusContent();
  } else location.hash = route;
}
// An example belongs to the depth it was written for (the lowest written level unless set), so
// a High-level reader never gets an Intro walkthrough. A workshop's example is its lab, so it
// always shows. Topics may have no example at all.
function exampleShown(l) {
  if (!l.example) return false;
  if (l.activity?.kind === "workshop") return true;
  return (l.example_level ?? available(l)[0]) === shownLevel(l);
}
const stepsFor = (l) => STEPS.filter((s) => s.id !== "example" || exampleShown(l));
function flowFor(id) {
  const flow = state.flow[id] || { step: "learn" },
    l = lookup(id);
  return flow.step === "example" && l && !exampleShown(l) ? { step: "check", part: 0 } : flow;
}
function setStep(id, step, part = 0) {
  // Moving past a lesson's reading step means it was read.
  if (step !== "learn") state.read[id] ??= { at: Date.now() };
  state.flow[id] = ["example", "check"].includes(step) ? { step, part } : { step };
  state.lastLesson = id;
  save();
  render();
  window.scrollTo(0, 0);
  focusContent();
  if (step === "example" && part > 0)
    requestAnimationFrame(() => {
      const current = flowFor(id);
      if (current.step === step && current.part === part)
        document
          .querySelector<HTMLInputElement>(".worked-example")
          ?.scrollIntoView({ block: "start" });
    });
}
function resumeLesson() {
  const inPass = NoemaProgress.path(LESSONS, state);
  return (
    lookup(state.lastLesson) ||
    inPass.find((l) => !state.completed[l.id]) ||
    inPass[0] ||
    LESSONS[0]
  );
}
function home() {
  return '<div id="course-home"></div>';
}
// A view with nothing to show sends the reader to the course home instead of a blank page
// (home() alone renders only the mount point; the router fills it on the #home route).
function toHome() {
  history.replaceState(null, "", "#home");
  setTimeout(render);
  return "";
}
const phaseLabel = (phase: string) =>
  phase.includes(" · ") ? phase.split(" · ").slice(1).join(" · ") : phase;
const sections = () => [...new Set(LESSONS.map((l) => l.phase))];
// Placement: a few probes per section pick the pass to start with; any pass stays a click away.
function placementPage() {
  const probes = META.placement || [];
  if (!probes.length) return toHome();
  if (state.placed) {
    const current = levelOf(state);
    return `<div class="lesson-topline"><a href="#home">← Course</a></div><h1>You’ll start at ${LEVEL_NAMES[current]}</h1><p class="lead">The course runs in ${passes(LESSONS).length} passes over the same topics, each with its own reading and questions. Start wherever you like; you can switch from the top of any page.</p><div class="track-choices">${passes(
      LESSONS,
    )
      .map(
        (n) =>
          `<button type="button" class="track-choice" data-track="${n}" aria-pressed="${n === current}">${icon(LEVEL_ICONS[n], 20)}<span><b>${LEVEL_NAMES[n]}</b><small>${LEVEL_BLURBS[n]}</small></span>${n === current ? `<span class="track-choice-mark">Your start</span>` : ""}</button>`,
      )
      .join(
        "",
      )}</div><div class="actions"><button class="primary" data-go="home">Go to the course</button><button class="text-button" data-retake-placement>Retake the placement questions</button></div>`;
  }
  return `<div class="lesson-topline"><a href="#home">← Course</a></div><h1>Where should you start?</h1><p class="lead">Answer what you can. These questions are meant to be hard, so choose “I’m not sure” if you would be guessing. You’ll start at the deepest pass you already know.</p><form id="placement-form">${sections()
    .filter((phase) => probes.some((q) => q.phase === phase))
    .map(
      (phase) =>
        `<section class="placement-section"><h2>${e(phaseLabel(phase))}</h2>${probes
          .filter((q) => q.phase === phase)
          .map(
            (q) =>
              `<div class="question" data-place-q="${e(q.id)}"><fieldset><legend>${e(q.prompt)}</legend>${[...q.options, "I’m not sure"].map((option, i) => `<label class="choice"><input type="radio" name="${e(q.id)}" value="${i < q.options.length ? i : -1}" required><span>${e(option)}</span></label>`).join("")}</fieldset></div>`,
          )
          .join("")}</section>`,
    )
    .join(
      "",
    )}<div class="actions"><button class="primary" type="submit">See where to start</button><button class="text-button" type="button" data-skip-placement>Skip and start at ${LEVEL_NAMES[1]}</button></div></form>`;
}
const readingBlocks = () =>
  NoemaProgress.blocks(NoemaProgress.path(LESSONS, state), META.reading_block_size);
const shownLevel = (l) => levelFor(l, state);
// The question written for the level this learner reads the topic at.
const levelQuestion = (l) => l.questions.find((q) => q.level === shownLevel(l)) || l.questions[0];
const blockById = (id) => readingBlocks().find((block) => block.id === id);
function activeBlock() {
  const parts = location.hash.slice(1).split("/");
  return parts[0] === "block" ? blockById(parts[1]) : null;
}
function blockStep(block, step) {
  state.blocks[block.id] = { ...state.blocks[block.id], step };
  save();
  go("block/" + block.id + "/" + step);
}
function blockQuestions(block) {
  return block.lessons.map(levelQuestion);
}
function blockChecked(block) {
  return blockQuestions(block).every((q) => savedQuestion(q).checked);
}
function blockQuizSummary(block) {
  if (!blockChecked(block)) return "";
  const questions = blockQuestions(block),
    missed = questions.filter((q) => !savedQuestion(q).correct);
  return `<section class="quiz-summary" role="status"><h2>${questions.length - missed.length} of ${questions.length} answers correct</h2>${missed.length ? `<button class="secondary" data-retry-missed="${block.id}">Try the missed questions again</button>` : ""}</section>`;
}
function checkBlock(block) {
  const missing = blockQuestions(block).find((q) => !Number.isInteger(savedQuestion(q).choice));
  if (missing) {
    toast("Choose an answer for each question before checking the block.");
    document.querySelector<HTMLInputElement>(`form[data-q="${missing.id}"] input`)?.focus();
    return;
  }
  for (const q of blockQuestions(block)) recordQuestionCheck(q, savedQuestion(q).choice);
  save();
  render();
  window.scrollTo(0, 0);
  focusContent();
}
// Interactive pieces (code labs) belong to the topic, not one level: the shown level gets every
// placeholder any level has, and folded levels never repeat them.
const PLACEHOLDER = /<div data-(cache-code|cache-visibility|workshop-tools)><\/div>/g;
function levelText(l, level: Level, folded: boolean) {
  const text = l.levels[level] || "";
  if (folded) return text.replace(PLACEHOLDER, "");
  const missing = [
    ...new Set(Object.values(l.levels).flatMap((t) => String(t).match(PLACEHOLDER) || [])),
  ].filter((p) => !text.includes(p));
  return text + missing.join("");
}
function readingHTML(l, level: Level = shownLevel(l), folded = false) {
  const reading = levelText(l, level, folded)
    .replace("<div data-cache-code></div>", () => cacheCode(0, false))
    .replace("<div data-cache-visibility></div>", () => cachePositions([0, 1]))
    .replace("<div data-workshop-tools></div>", workshopTools);
  const container = document.createElement("div");
  container.innerHTML = reading;
  const paragraphs = [...container.children].filter((node) => node.tagName === "P");
  // Insert in reverse order so illustrations at the same paragraph keep their authored order.
  for (const illustration of [...(l.illustrations || [])]
    .filter((i) => i.level === level)
    .reverse()) {
    const anchor = paragraphs[illustration.after_paragraph - 1];
    if (!anchor) continue;
    anchor.insertAdjacentHTML(
      "afterend",
      NoemaVisuals.render(illustration.visual, 100, l.id + "--" + illustration.id),
    );
  }
  return container.innerHTML;
}
const LEVEL_ICONS = { 1: "lightbulb", 2: "cog", 3: "telescope" } as const;
// The end of a pass points to the next one: the same subject again, one level deeper.
function passFinished() {
  const level = levelOf(state),
    next = passes(LESSONS).find((n) => n > level),
    open = NoemaProgress.path(LESSONS, state).filter((l) => !state.completed[l.id]);
  return `<p class="lesson-context">${LEVEL_NAMES[level]} · last block</p><h1>${open.length ? "Last block finished." : `You finished ${LEVEL_NAMES[level]}.`}</h1><p class="lead">${open.length ? `${open.length} topic${open.length === 1 ? " still has" : "s still have"} unanswered questions in this pass.` : "Your answers and notes are saved."}${next ? ` ${LEVEL_NAMES[next]} goes over the same subject again with new reading and new questions: ${LEVEL_BLURBS[next].charAt(0).toLowerCase() + LEVEL_BLURBS[next].slice(1)}` : ""}</p><div class="actions">${next ? `<button class="primary" data-track="${next}" data-track-start>${icon(LEVEL_ICONS[next], 16)} Start ${LEVEL_NAMES[next]} →</button>` : ""}<a ${next ? "" : 'class="primary" '}href="#home">Return to the course</a></div>`;
}
const passDone = (n: Level) =>
  NoemaProgress.snapshot({ META, LESSONS }, trackState(state, n)).complete;
// The course-wide level switch in the header. Each pass keeps its own progress.
function trackSwitch() {
  const levels = passes(LESSONS);
  if (levels.length < 2) return "";
  return `<div class="track-switch" role="group" aria-label="Course level">${levels
    .map(
      (n) =>
        `<button type="button" data-track="${n}" aria-pressed="${n === levelOf(state)}" title="${LEVEL_BLURBS[n]}">${icon(LEVEL_ICONS[n], 15)}<span>${LEVEL_NAMES[n]}</span>${passDone(n) ? `<span class="track-done" title="Finished">${icon("check", 13)}</span>` : ""}</button>`,
    )
    .join("")}</div>`;
}
// Switch passes in place: the reader stays on the same topic (or the next one the new pass
// covers), at the same share of the way through it.
function changeTrack(n: Level) {
  const parts = location.hash.slice(1).split("/"),
    reading = parts[0] === "block" && (parts[2] || "read") === "read";
  let topicId = parts[0] === "lesson" ? parts[1] : state.lastLesson,
    through = 0,
    y = 0;
  if (reading) {
    const line = innerHeight * 0.3,
      sections = [...document.querySelectorAll<HTMLElement>(".reading-topic")],
      // A topic heading on screen is the steadiest landmark; otherwise the topic being read.
      on =
        sections.find((el) => {
          const top = el.getBoundingClientRect().top;
          return top >= 0 && top <= innerHeight * 0.6;
        }) ||
        sections.filter((el) => el.getBoundingClientRect().top <= line).at(-1) ||
        sections[0];
    if (on) {
      const r = on.getBoundingClientRect();
      topicId = on.id.slice("read-".length);
      y = Math.max(r.top, 0);
      through = r.height ? (y - r.top) / r.height : 0;
    }
  }
  state = switchTrack(state, n);
  const order = LESSONS.map((l) => l.id),
    inPass = NoemaProgress.path(LESSONS, state),
    target =
      inPass.find((l) => l.id === topicId) ||
      inPass.find((l) => order.indexOf(l.id) > order.indexOf(topicId)) ||
      inPass.at(-1);
  if (parts[0] === "block") {
    const block = readingBlocks().find((b) => b.lessons.some((l) => l.id === target.id));
    state.lastLesson = target.id;
    history.replaceState(
      null,
      "",
      `#block/${block.id}/${reading ? "read/" + target.id : parts[2]}`,
    );
    keepScroll = reading;
  }
  save();
  const update = () => {
    render();
    const now = reading && document.getElementById("read-" + target.id);
    if (!now) return;
    const r = now.getBoundingClientRect();
    if (target.id === topicId) window.scrollBy(0, r.top + through * r.height - y);
    else now.scrollIntoView({ block: "start" });
  };
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.startViewTransition(update);
  else update();
}
function blockPage(id, step = "read") {
  let block = blockById(id);
  // Blocks regroup when the path changes (placement, reading a skipped topic). Follow the topic
  // in the URL, or the last one read, to whichever block holds it now.
  if (!block) {
    const topic = location.hash.split("/")[3] || state.lastLesson;
    block = readingBlocks().find((b) => b.lessons.some((l) => l.id === topic));
    if (!block) return toHome();
    history.replaceState(null, "", `#block/${block.id}/${step}${topic ? "/" + topic : ""}`);
    id = block.id;
  }
  if (!["read", "practice", "explain", "done"].includes(step)) step = "read";
  state.blocks[id] = { ...state.blocks[id], step };
  if (!block.lessons.some((l) => l.id === state.lastLesson)) state.lastLesson = block.lessons[0].id;
  save();
  const topics = `Topics ${block.start + 1}–${block.start + block.lessons.length}`;
  const header = `<div class="lesson-topline"><a href="#home">← Course</a><span>Block ${block.index + 1} of ${readingBlocks().length}</span></div>${
    step !== "done"
      ? stepper(
          block,
          step,
          [
            { id: "read", label: "Read" },
            { id: "practice", label: "Questions" },
            { id: "explain", label: "Explain" },
          ],
          "block-step",
          "block",
        )
      : ""
  }`;
  if (step === "read")
    return (
      header +
      `<header class="reading-block-header"><h1>${topics}</h1><p class="lead">About ${block.minutes} minutes</p><nav aria-label="In this reading block" data-reading-contents></nav></header>${block.lessons.map((l, i) => `<section class="reading-topic" id="read-${l.id}"><div class="reading-topic-heading" data-read-topic="${l.id}"><span class="small">Topic ${block.start + i + 1}${state.read[l.id] ? ` <span class="read-mark" title="Read">${icon("check", 13)}</span>` : ""}</span><h2>${e(l.title)}</h2><p class="lesson-goal">${e(l.goal)}</p></div><article class="prose">${readingHTML(l)}</article>${exampleShown(l) ? `<section data-block-card class="block-worked-example"><h3>${e(l.example_title || "Example")}</h3><p>${e(l.example[0])}</p><ol class="block-example-steps">${l.example[1].map((text) => `<li>${e(text)}</li>`).join("")}</ol>${NoemaVisuals.render(l.visual, l.example[1].length - 1, l.id)}</section>` : ""}${l.activity ? `<p class="block-activity-link"><a href="#lesson/${l.id}">Open the hands-on work for this topic →</a></p>` : ""}${background(l)}<div class="topic-end" data-read-end="${l.id}" aria-hidden="true"></div></section>`).join("")}<div class="block-reading-actions"><button class="primary" data-finish-reading="${id}">Go to the questions →</button></div>`
    );
  if (step === "practice")
    return (
      header +
      `<h1>Questions</h1>${blockQuizSummary(block)}${block.lessons.map((l, i) => `<section class="block-question"><p class="small">${i + 1} · ${e(l.title)}</p>${question(levelQuestion(l), { guided: true, batch: true })}</section>`).join("")}${flowFooter({ back: `<button class="text-button" data-block-step="read" data-block="${id}">← Back to reading</button>`, primary: blockChecked(block) ? "block-explain" : "check-block", value: id, primaryText: blockChecked(block) ? "Next: explain an idea" : "Check all answers", secondary: blockChecked(block) ? "" : `<button class="text-button" data-block-step="explain" data-block="${id}">Skip questions</button>` })}`
    );
  if (step === "explain") return header + explainStep(block.lessons[block.lessons.length - 1]);
  const next = readingBlocks()[block.index + 1];
  if (!next) return header + passFinished();
  return (
    header +
    `<h1>Block finished.</h1><ul class="block-done-topics">${block.lessons.map((l) => `<li>${e(l.title)}</li>`).join("")}</ul><div class="actions">${next ? `<button class="primary" data-go="block/${next.id}/read">Start the next reading block →</button>` : '<a class="primary" href="#home">Return to the course</a>'}<a href="#home">Take a break</a></div>${block.lessons
      .filter((l) => l.activity)
      .map(
        (l) =>
          `<a class="option-row" href="#lesson/${l.id}"><span>Return to hands-on work<small>${e(l.title)}</small></span><span>→</span></a>`,
      )
      .join("")}`
  );
}
function readingContents(block) {
  const nav = document.querySelector("[data-reading-contents]");
  if (nav)
    NoemaUI.contents(nav, {
      items: block.lessons.map((l, i) => ({
        id: l.id,
        n: block.start + i + 1,
        title: l.title,
        href: `#block/${block.id}/read/${l.id}`,
        read: !!state.read[l.id],
      })),
    });
}
function observeReading() {
  const block = activeBlock(),
    parts = location.hash.slice(1).split("/");
  if (!block || parts[2] !== "read") return;
  readingContents(block);
  if (parts[3] && block.lessons.some((l) => l.id === parts[3])) {
    state.lastLesson = parts[3];
    save();
  }
  if (parts[3] && block.lessons.some((l) => l.id === parts[3]) && !keepScroll)
    requestAnimationFrame(() =>
      document.getElementById("read-" + parts[3])?.scrollIntoView({ block: "start" }),
    );
  keepScroll = false;
  readingObserver = new IntersectionObserver(
    (entries) => {
      if (activeBlock()?.id !== block.id || location.hash.split("/")[2] !== "read") return;
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (visible.length) {
        state.lastLesson =
          visible[visible.length - 1].target instanceof HTMLElement
            ? visible[visible.length - 1].target.getAttribute("data-read-topic")
            : state.lastLesson;
        document.title = [lookup(state.lastLesson)?.title, META.title].filter(Boolean).join(" · ");
        save();
      }
    },
    { rootMargin: "-10% 0px -60% 0px" },
  );
  document
    .querySelectorAll<HTMLInputElement>("[data-read-topic]")
    .forEach((heading) => readingObserver.observe(heading));
  // Reaching the end of a topic is what "read" means; the check appears right away.
  const endObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.isIntersecting && (entry.target as HTMLElement).dataset.readEnd;
      if (!id || state.read[id]) continue;
      state.read[id] = { at: Date.now() };
      save();
      endObserver.unobserve(entry.target);
      readingContents(block);
    }
  });
  document.querySelectorAll("[data-read-end]").forEach((end) => endObserver.observe(end));
}
function stepper(l, step, steps = stepsFor(l), action = "step", entity = "lesson") {
  return `<nav class="stepper" aria-label="${steps === REVIEW_STEPS ? "Review" : "Lesson"} steps"><ol>${steps.map((s, i) => `<li><button data-${action}="${s.id}" data-${entity}="${l.id}" ${s.id === step ? 'aria-current="step"' : ""}><span class="step-number">${i + 1}</span><span>${s.label}</span></button>${i < steps.length - 1 ? '<span class="step-line" aria-hidden="true"></span>' : ""}</li>`).join("")}</ol></nav>`;
}
function lessonHeader(l, step) {
  const index = LESSONS.indexOf(l);
  return `<div class="lesson-topline"><a href="#home">← Course</a><span>Lesson ${index + 1} of ${LESSONS.length}</span></div>${step === "learn" ? "" : `<div class="lesson-context">${e(l.title)}</div>`}${stepper(l, step)}`;
}
function flowFooter({
  back,
  primary,
  value,
  primaryText,
  secondary = "",
  disabled = false,
}: {
  back: string;
  primary: string;
  value?: string;
  primaryText: string;
  secondary?: string;
  disabled?: boolean;
}) {
  return `<div class="flow-footer"><div class="flow-footer-inner"><div>${back}</div><div class="footer-actions">${secondary}<button class="primary" data-${primary}="${e(value)}" ${disabled ? "disabled" : ""}>${e(primaryText)}${disabled ? "" : ' <span aria-hidden="true">→</span>'}</button></div></div></div>`;
}
function footer(
  l,
  {
    back = "",
    ...options
  }: {
    back?: string;
    primary: string;
    primaryText: string;
    secondary?: string;
    disabled?: boolean;
  },
) {
  return flowFooter({
    ...options,
    value: l.id,
    back: back
      ? `<button class="text-button" data-step="${back}" data-lesson="${l.id}">← Back</button>`
      : '<a href="#home">Course outline</a>',
  });
}
function background(l) {
  return `<details class="background"><summary>Sources and earlier lessons</summary>${sourceLinks(l.sources)}${l.needs.length ? `<p class="small">Need a refresher? ${l.needs.map((id) => `<a href="#lesson/${id}">${e(lookup(id).title)}</a>`).join(" · ")}</p>` : ""}</details>`;
}
function question(q, { guided = false, batch = false } = {}) {
  const a = savedQuestion(q);
  return `<form class="question" data-q="${q.id}" data-guided="${guided}"><fieldset><legend>${e(q.prompt)}</legend>${q.options.map((option, i) => `<label class="choice ${a.checked ? (i === q.correct ? "answer-correct" : a.choice === i ? "answer-missed" : "") : ""}"><input type="radio" name="choice" value="${i}" ${a.choice === i ? "checked" : ""} required><span>${e(option)}${a.checked && i === q.correct ? '<strong class="answer-marker">Correct answer</strong>' : a.checked && a.choice === i ? '<strong class="answer-marker">Your answer</strong>' : ""}</span></label>`).join("")}</fieldset>${a.hint ? `<p class="hint-text">${e(q.hint)}</p>` : ""}<div class="question-actions">${batch ? "" : !a.checked ? (guided ? "" : '<button class="primary" type="submit">Check my answer</button>') : '<button class="text-button" type="submit">Check again</button>'}${a.hint || a.checked ? "" : `<button class="hint-button" data-hint="${q.id}" type="button">${icon("lightbulb", 14)} Hint</button>`}</div>${a.checked ? `<div class="answer-feedback ${a.correct ? "correct" : "revisit"}" role="status">${q.option_feedback?.[a.choice] ? `<p>${e(q.option_feedback[a.choice])}</p>` : ""}<p>${e(q.why)}</p></div>` : ""}</form>`;
}
function readStep(l) {
  const reading = readingHTML(l);
  return `<h1>${e(l.title)}</h1><p class="lesson-goal">${e(l.goal)}</p><article class="prose">${reading}</article>${background(l)}${footer(l, exampleShown(l) ? { primary: "next-example", primaryText: "Next: see an example" } : { primary: "next-check", primaryText: "Next: try one question" })}`;
}
function cacheCode(start, editable) {
  return `<section class="cache-code-panel"><div class="cache-code-heading"><span>Cache read · two saved positions</span><span>${editable ? "Change the highlighted value" : "Follow the highlighted value"}</span></div><pre class="cache-code" aria-label="Cache read code"><code><span class="code-line active"><span class="line-number">1</span>start = ${editable ? `<select id="cache-start" aria-label="First saved position to read"><option value="0" ${start === 0 ? "selected" : ""}>0</option><option value="1" ${start === 1 ? "selected" : ""}>1</option></select>` : `<mark>${start}</mark>`}</span><span class="code-line"><span class="line-number">2</span>keys = cache.keys[start:]</span><span class="code-line"><span class="line-number">3</span>values = cache.values[start:]</span><span class="code-line"><span class="line-number">4</span>attended = self.attention(q, keys, values)</span></code></pre><div class="code-explanation"><p><b>1 · Choose where the read begins.</b> Position 0 is the first saved entry. Position 1 is the second.</p><p><b>2–3 · Select matching keys and values.</b> <code>[start:]</code> means “from start to the end.” It does not delete anything from the original cache.</p><p><b>4 · Calculate attention.</b> The current query, <code>q</code>, determines how the visible values are mixed.</p></div><p class="small code-caption">This expands the cache-read lines of <code>cached_step</code> for the two-entry case. The exercise selects the corresponding branch of that function.</p></section>`;
}
function cachePositions(visible, trace = null, title = "Which saved entries can attention read?") {
  const entries = trace?.positions || [
    { position: 0, token_id: 1 },
    { position: 1, token_id: 4 },
  ];
  return `<section class="cache-visibility"><h3>${e(title)}</h3><div class="cache-entries">${entries
    .map((entry) => {
      const index = visible.indexOf(entry.position),
        included = index !== -1;
      return `<div class="cache-entry ${included ? "included" : "excluded"}" data-cache-position="${entry.position}" data-included="${included}"><b>Position ${entry.position}</b><span>From input token ${entry.token_id}</span><small>${included ? (trace ? (100 * trace.weights[index]).toFixed(1) + "% of the attention weight" : "Included in this read") : "Not passed to attention"}</small></div>`;
    })
    .join(
      "",
    )}</div><p class="small">Each entry contains calculated key/value vectors. The token ID labels where those vectors came from.</p></section>`;
}
function workshopTools() {
  return `<details class="background" data-engine-tools><summary>Optional: inspect the full function or run wider checks</summary>${engineCodeViewer()}${referenceChecksPanel()}</details>`;
}
function cacheScoreComparison(row) {
  let token = 0;
  row.reference_logits.forEach((value, index) => {
    if (
      Math.abs(value - row.actual_logits[index]) >
      Math.abs(row.reference_logits[token] - row.actual_logits[token])
    )
      token = index;
  });
  return `<div class="score-comparison"><h3>One score used for the next prediction</h3><p>For possible next token ${token}, the two paths calculate:</p><div class="score-pair"><div><small>Full-prefix reference</small><b>${row.reference_logits[token].toFixed(5)}</b></div><div><small>Selected cache read</small><b>${row.actual_logits[token].toFixed(5)}</b></div></div><p class="small">These are model scores, not probabilities. A changed score does not guarantee that the highest-scoring token changes.</p></div>`;
}
function cacheExampleResult(part) {
  if (cacheWalkthrough.kind === "failed")
    return `<p class="notice">${e(cacheWalkthrough.message)}</p><button class="text-button" data-retry-cache-example="workshop">Load the worked example again</button>`;
  if (cacheWalkthrough.kind !== "ready")
    return '<p class="small" role="status">Calculating the worked example with the local engine…</p>';
  const row = (part === 2 ? cacheWalkthrough.broken : cacheWalkthrough.baseline).rows[
    part === 0 ? 0 : 1
  ];
  const mixture = row.weights
    .map(
      (weight, index) =>
        `${weight.toFixed(3)} × ${row.positions[row.visible_positions[index]].value_preview[0].toFixed(3)}`,
    )
    .join(" + ");
  return `${cachePositions(row.visible_positions, row, part === 2 ? "The changed read omits position 0." : "The cached path keeps the intended history.")}<div class="attention-mixture"><h3>Follow one number through the mixture</h3><p>Using the first component of each visible value vector:</p><p class="calculation">${e(mixture)} ≈ ${row.attention_preview[0].toFixed(3)}</p><p class="small">The model mixes every component this way, then runs the rest of the block to produce next-token scores.</p></div>${cacheScoreComparison(row)}${part === 2 ? '<p class="notice">Both slices still have the same length: one key and one value. That structural check passes, but the intended contribution from position 0 has disappeared.</p>' : ""}`;
}
function workshopExample(l, flow) {
  const part = Math.max(0, Math.min(flow.part || 0, 2));
  return `<h1>${["First input: one saved entry.", "Second input: keep both entries.", "Change one line: skip the first entry."][part]}</h1><p class="lead compact">${e(l.example[1][part])}</p><p class="small">${e(l.example[0])}</p>${cacheCode(part === 2 ? 1 : 0, false)}<div id="cache-example-result" data-cache-example="${part}">${cacheExampleResult(part)}</div>${footer(l, { back: part ? "example" : "learn", primary: part === 2 ? "next-check" : "example-next", primaryText: part === 2 ? "Next: repair this read" : "Continue the example" })}`;
}
async function loadCacheWalkthrough() {
  if (
    !document.querySelector<HTMLInputElement>("[data-cache-example]") ||
    cacheWalkthrough.kind !== "idle"
  )
    return;
  cacheWalkthrough = { kind: "loading" };
  try {
    const [baseline, broken] = await Promise.all([
      requestWorkshopCase("baseline"),
      requestWorkshopCase("broken"),
    ]);
    cacheWalkthrough = { kind: "ready", baseline, broken };
  } catch (error) {
    cacheWalkthrough = {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const target = document.querySelector<HTMLInputElement>("[data-cache-example]");
  if (target) target.innerHTML = cacheExampleResult(Number(target.dataset.cacheExample));
}
function cacheLabState(): CacheLab {
  return activityState("workshop").cacheLab || { start: 1, prediction: "" };
}
function cacheLabCurrent() {
  const lab = cacheLabState(),
    run = lab.lastRun;
  return (
    run?.revision === lookup("workshop").activity.revision &&
    run.start === lab.start &&
    run.prediction === lab.prediction
  );
}
function cacheLabFooter(l) {
  const lab = cacheLabState(),
    current = cacheLabCurrent(),
    busy = workshopExecution.kind === "running";
  return footer(l, {
    back: "check",
    primary: busy
      ? "run-cache-lab"
      : current && lab.lastRun.matches
        ? "next-explain"
        : current
          ? "focus-cache-line"
          : "run-cache-lab",
    primaryText: busy
      ? "Calculating your version…"
      : current && lab.lastRun.matches
        ? "Next: explain your repair"
        : current
          ? "Change the highlighted value"
          : "Run my change",
    disabled: busy,
    secondary:
      '<button class="text-button save-later" data-next-explain="workshop">Save and continue later</button>',
  });
}
function cacheLabResult() {
  const lab = cacheLabState(),
    run = lab.lastRun;
  if (
    workshopExecution.kind === "failed" &&
    ["broken", "repaired"].includes(workshopExecution.case)
  )
    return `<p class="notice" role="alert">${e(workshopExecution.message)} Your edit and prediction are saved.</p>`;
  if (!run) return "";
  if (!cacheLabCurrent())
    return '<p class="notice">Your code or prediction changed after the last run. Run this version to compare it with the reference.</p>';
  const row = run.rows[1],
    expected = lab.start === 0 ? "both" : "last",
    predicted = run.prediction === expected;
  return `<section class="cache-lab-result" role="status"><h2>${run.matches ? "The repaired read matches the reference." : "The read skipped information the reference uses."}</h2><p>${predicted ? "Your prediction about which entries remain was right." : `Revisit your prediction: start = ${run.start} passes ${run.start === 0 ? "both positions" : "only position 1"} to attention.`}</p>${cachePositions(row.visible_positions, row, "What your code actually passed to attention")}<p><b>Stored:</b> ${row.cache_length} paired entries. <b>Read:</b> ${row.visible_positions.length} key${row.visible_positions.length === 1 ? "" : "s"} and ${row.visible_positions.length} value${row.visible_positions.length === 1 ? "" : "s"}.</p>${cacheScoreComparison(row)}<p>${run.matches ? "Starting at 0 restores the earlier contribution. The same inputs now produce matching cached and full-prefix scores on all four checked prefixes." : "Position 0 is still stored, but neither slice passes it to attention. The remaining value gets all of the attention weight. Change the highlighted start value so the read includes both positions."}</p><details class="background"><summary>Inspect the comparison at all four prefixes</summary><div class="activity-table"><table><thead><tr><th>Input count</th><th>Positions read</th><th>Largest score difference</th></tr></thead><tbody>${run.rows.map((r) => `<tr><td>${r.prefix_length}</td><td>${r.visible_positions.join(", ")}</td><td>${r.max_error === 0 ? "0" : r.max_error.toPrecision(4)}</td></tr>`).join("")}</tbody></table></div></details><button class="text-button" data-run-cache-lab="workshop">Run this version again</button></section>`;
}
function workshopContent(_l) {
  const lab = cacheLabState();
  return `${cacheCode(lab.start, true)}<fieldset class="cache-prediction"><legend>Before you run: which saved positions will this code pass to attention at the second input?</legend><label class="choice"><input type="radio" name="cache-prediction" value="both" ${lab.prediction === "both" ? "checked" : ""}><span>Both positions 0 and 1.</span></label><label class="choice"><input type="radio" name="cache-prediction" value="last" ${lab.prediction === "last" ? "checked" : ""}><span>Only position 1.</span></label></fieldset><div id="cache-lab-result">${cacheLabResult()}</div>${workshopTools()}`;
}
function refreshCacheLab() {
  if (!document.querySelector<HTMLInputElement>("#cache-start")) return;
  document.querySelector<HTMLInputElement>("#cache-lab-result").innerHTML = cacheLabResult();
  document.querySelector<HTMLInputElement>(".flow-footer").outerHTML = cacheLabFooter(
    lookup("workshop"),
  );
}
async function runCacheLab() {
  if (workshopExecution.kind === "running") return;
  const lab = cacheLabState(),
    start = lab.start,
    prediction = lab.prediction;
  if (!prediction) {
    toast("Choose which positions you expect the code to read.");
    document.querySelector<HTMLInputElement>('[name="cache-prediction"]')?.focus();
    return;
  }
  const caseId = start === 1 ? "broken" : "repaired";
  workshopExecution = { kind: "running", case: caseId };
  refreshCacheLab();
  refreshWorkshopTools();
  try {
    const result = await requestWorkshopCase(caseId),
      previous = activityState("workshop"),
      current = cacheLabState();
    const run = {
      ...result,
      start,
      prediction,
      revision: lookup("workshop").activity.revision,
      at: Date.now(),
    };
    state.activities.workshop = {
      ...previous,
      cacheLab: {
        ...current,
        lastRun: run,
        firstAttempt: current.firstAttempt || {
          start,
          prediction,
          matches: result.matches,
          at: run.at,
        },
      },
    };
    save();
    workshopExecution = { kind: "idle" };
  } catch (error) {
    workshopExecution = {
      kind: "failed",
      case: caseId,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  refreshCacheLab();
  refreshWorkshopTools();
  document.querySelector<HTMLInputElement>(".cache-lab-result")?.scrollIntoView({ block: "start" });
}
function referenceChecksPanel() {
  const record = activityState("workshop").referenceChecks;
  const busy = workshopExecution.kind === "running";
  const failed =
    workshopExecution.kind === "failed" && workshopExecution.case === "reference-checks";
  return `<section class="reference-checks" data-reference-checks-panel><h3>Run the reference checks here.</h3><p>Compare cached calculations, generated tokens, separate request state, a small weight update, and the context limit.</p><button class="secondary" data-run-reference-checks="workshop" ${busy ? "disabled" : ""}>${busy ? "Running engine checks…" : record ? "Run the checks again" : "Run all reference checks"}</button>${failed && workshopExecution.kind === "failed" ? `<p class="notice" role="alert">This run did not pass: ${e(workshopExecution.message)}${record ? " The saved successful run below is from an earlier attempt." : ""}</p>` : ""}${record ? `<div class="reference-result" data-reference-result role="status"><h3>${e(record.checks)} checks passed.</h3><p class="small">Saved run: ${e(new Date(record.at).toLocaleString())}. These are real comparisons executed by the local CPU engine.</p><div class="activity-table"><table><thead><tr><th>What was compared</th><th>Checks</th><th>Result</th></tr></thead><tbody>${record.groups.map((group) => `<tr><td>${e(group.title)}</td><td>${e(group.checks)}</td><td>Passed</td></tr>`).join("")}</tbody></table></div><details class="background"><summary>What does each group establish?</summary>${record.groups.map((group) => `<p><b>${e(group.title)}.</b> ${e(group.description)}</p>`).join("")}</details><p class="small">These checks cover the tiny model and these test cases. They do not establish GPU speed or compatibility with a different model.</p></div>` : ""}</section>`;
}
function engineCodeViewer() {
  const selected = WORKSHOP_FUNCTIONS.find(([name]) => name === activeWorkshopSource);
  return `<section class="engine-source" data-engine-source><h3>Inspect the complete function.</h3><label class="field-label" for="engine-function">Function</label><select class="page-select" id="engine-function">${WORKSHOP_FUNCTIONS.map(([name, label]) => `<option value="${name}" ${name === activeWorkshopSource ? "selected" : ""}>${e(name)} · ${e(label)}</option>`).join("")}</select><div data-engine-code><p class="small">${e(selected[2])}</p>${workshopSource.kind === "ready" ? `<pre><code>${e(workshopSource.functions[activeWorkshopSource])}</code></pre>` : workshopSource.kind === "failed" ? `<p class="notice">${e(workshopSource.message)}</p><button class="text-button" data-retry-engine-source="workshop">Load the code again</button>` : '<p class="small" role="status">Loading the engine code…</p>'}</div><a class="small" href="tiny_engine.py" download>Save a copy of the source (optional)</a></section>`;
}
async function loadWorkshopSource() {
  if (
    !document.querySelector<HTMLInputElement>("[data-engine-source]") ||
    workshopSource.kind !== "idle"
  )
    return;
  workshopSource = { kind: "loading" };
  try {
    const response = await fetch("api/workshop/source"),
      functions = await response.json();
    if (
      !response.ok ||
      !functions ||
      WORKSHOP_FUNCTIONS.some(([name]) => typeof functions[name] !== "string")
    )
      throw new Error("The engine code could not load. Try again.");
    workshopSource = { kind: "ready", functions };
  } catch (error) {
    workshopSource = {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  refreshEngineSource();
}
function refreshEngineSource() {
  document.querySelectorAll<HTMLInputElement>("[data-engine-source]").forEach((panel) => {
    const focused =
        panel.contains(document.activeElement) && document.activeElement.id === "engine-function",
      temporary = document.createElement("div");
    temporary.innerHTML = engineCodeViewer();
    const next = temporary.firstElementChild;
    panel.replaceWith(next);
    if (focused) next.querySelector("select").focus({ preventScroll: true });
  });
}
function refreshWorkshopTools() {
  document
    .querySelectorAll<HTMLInputElement>("[data-reference-checks-panel]")
    .forEach((panel) => (panel.outerHTML = referenceChecksPanel()));
  const parts = location.hash.slice(1).split("/");
  if (
    parts[0] === "lesson" &&
    parts[1] === "workshop" &&
    flowFor("workshop").step === "check" &&
    flowFor("workshop").part === 1
  )
    refreshActivityFeedback(lookup("workshop"));
}
async function requestWorkshopCase(caseId) {
  const response = await fetch("api/workshop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case: caseId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The comparison could not finish.");
  if (
    result.case !== caseId ||
    (caseId === "reference-checks"
      ? !Array.isArray(result.groups) ||
        result.groups.some((group) => group.status !== "passed") ||
        result.checks !== result.groups.reduce((total, group) => total + group.checks, 0)
      : !Array.isArray(result.rows))
  )
    throw new Error("The comparison returned an unexpected result.");
  return result;
}
async function runReferenceChecks() {
  if (workshopExecution.kind === "running") return;
  workshopExecution = { kind: "running", case: "reference-checks" };
  refreshWorkshopTools();
  try {
    const result = await requestWorkshopCase("reference-checks"),
      previous = activityState("workshop");
    state.activities.workshop = { ...previous, referenceChecks: { ...result, at: Date.now() } };
    save();
    workshopExecution = { kind: "idle" };
  } catch (error) {
    workshopExecution = {
      kind: "failed",
      case: "reference-checks",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  refreshWorkshopTools();
  document
    .querySelector<HTMLInputElement>("[data-reference-result]")
    ?.scrollIntoView({ block: "start" });
}
function exampleStep(l, flow) {
  if (l.activity?.kind === "workshop") return workshopExample(l, flow);
  const part = Math.max(0, Math.min(flow.part || 0, l.example[1].length - 1));
  const last = part === l.example[1].length - 1;
  return `<h1>${e(l.example_title || "Walk through an example.")}</h1><p class="example-scenario">${e(l.example[0])}</p><section class="worked-example" data-example-card data-example-step="${part}" data-example-count="${l.example[1].length}"><p class="current-step">${e(l.example[1][part])}</p>${NoemaVisuals.render(l.visual, part, l.id)}</section>${
    part
      ? `<ol class="example-history" aria-label="Earlier steps">${l.example[1]
          .slice(0, part)
          .map((s, i) => `<li><span>${i + 1}</span><p>${e(s)}</p></li>`)
          .join("")}</ol>`
      : ""
  }${last && l.lab ? `<div class="experiment-intro"><h2>Now change one thing.</h2><p>The controls below let you try this idea yourself. Move one control, notice what changes, and connect the result to the example.</p></div>${lab(l.lab)}` : ""}${footer(l, { back: part ? "example" : "learn", primary: last ? "next-check" : "example-next", primaryText: last ? "Next: try one question" : "Continue the example" })}`;
}
function checkStep(l) {
  if (l.activity && flowFor(l.id).part === 1) return appliedStep(l);
  const checked = savedQuestion(levelQuestion(l)).checked;
  return `<h1>Try it yourself.</h1><p class="lead compact">Use the idea you just read. Take a guess if you’re unsure; the explanation afterward is part of the lesson.</p>${question(levelQuestion(l), { guided: true })}${footer(l, { back: exampleShown(l) ? "example" : "learn", primary: checked ? (l.activity ? "open-activity" : "next-explain") : "submit-check", primaryText: checked ? (l.activity ? "Next: put it to work" : "Next: explain it back") : "Check my answer" })}`;
}
function activityState(id): ActivityState {
  return state.activities[id] || { values: {}, part: 0 };
}
function openActivity(id) {
  state.flow[id] = { step: "check", part: 1 };
  state.lastLesson = id;
  save();
  go("lesson/" + id);
}
function activityValues(id) {
  return activityState(id).values || {};
}
function activityPart(l) {
  return l.activity.kind === "workshop"
    ? 0
    : Math.min(activityState(l.id).part || 0, l.activity.fields.length - 1);
}
function activityCompared(l) {
  const record = activityState(l.id).comparison;
  return (
    record?.revision === l.activity.revision &&
    JSON.stringify(record.values) === JSON.stringify(activityValues(l.id))
  );
}
function activityNotes(l) {
  const activity = l.activity,
    record = activityState(l.id),
    values = activityValues(l.id);
  if (activity.kind === "workshop") {
    const lab = cacheLabState(),
      run = lab.lastRun;
    return `<dl class="activity-notes"><dt>Your read boundary</dt><dd>start = ${lab.start}</dd><dt>Your prediction</dt><dd>${lab.prediction === "both" ? "Both positions 0 and 1." : lab.prediction === "last" ? "Only position 1." : "Not recorded yet."}</dd><dt>Your latest comparison</dt><dd>${run ? `With start = ${run.start}, the selected path ${run.matches ? "matched the reference on all four checked prefixes." : "first differed at input count " + run.first_divergence + "."}` : "Not run yet."}</dd></dl>${record.earlierNotes ? `<details class="background"><summary>Your earlier written predictions</summary><p class="saved-notes">${e(record.earlierNotes)}</p></details>` : ""}`;
  }
  return `<dl class="activity-notes">${activity.fields.map((field) => `<dt>${e(field.label)}</dt><dd>${e(field.kind === "select" ? field.options.find(([value]) => value === values[field.id])?.[1] || "Not recorded yet." : values[field.id] || "Not recorded yet.")}</dd>`).join("")}</dl>${record.earlierNotes ? `<details class="background"><summary>Your earlier experiment notes</summary><p class="saved-notes">${e(record.earlierNotes)}</p></details>` : ""}`;
}
function carryNotes(l) {
  return (l.activity.bring || [])
    .map(
      (id) =>
        `<details class="background"><summary>Your saved work from “${e(lookup(id).title)}”</summary>${activityNotes(lookup(id))}<button class="text-button" data-open-activity="${id}">Revisit that activity →</button></details>`,
    )
    .join("");
}
function activityFeedback(l) {
  const a = l.activity,
    record = activityState(l.id);
  if (!record.comparison) return "";
  if (!activityCompared(l))
    return '<p class="notice">You changed your work after comparing it. Compare the new version when you are ready.</p>';
  if (a.kind === "worksheet")
    return `<section class="self-check"><h2>Compare your plan.</h2><p>Read these points against what you wrote. This is a worked comparison; it does not verify model files or results.</p><ul>${a.compare.map((s) => `<li>${e(s)}</li>`).join("")}</ul><div class="sample-answer"><p>${e(a.example)}</p></div><details class="background"><summary>Read your saved notes together</summary>${activityNotes(l)}</details></section>`;
  const values = activityValues(l.id);
  return `<section class="answer-feedback" role="status"><h2>Check each connection.</h2>${a.fields
    .map((field) => {
      const correct =
        field.kind === "number"
          ? Math.abs(Number(values[field.id]) - field.answer) <= field.tolerance
          : values[field.id] === field.answer;
      return `<p><b>${correct ? "Yes." : "Revisit this one."}</b> ${e(field.why)}</p>`;
    })
    .join(
      "",
    )}<p>${e(a.conclusion)}</p><p class="small">You can continue after a mistake. The explanation is part of the practice.</p></section>`;
}
function activityFooter(l) {
  if (l.activity.kind === "workshop") return cacheLabFooter(l);
  const a = l.activity,
    part = activityPart(l);
  let primary = "compare-activity",
    primaryText = a.kind === "check" ? "Check my work" : "Compare my plan",
    disabled = false;
  if (a.kind === "worksheet" && part < a.fields.length - 1) {
    primary = "activity-next";
    primaryText = "Save and continue";
  } else if (activityCompared(l)) {
    primary = "next-explain";
    primaryText = "Next: explain it back";
  }
  const back =
    a.kind !== "check" && part > 0
      ? `<button class="text-button" data-activity-back="${l.id}">← Previous part</button>`
      : `<button class="text-button" data-quick-check="${l.id}">← Quick check</button>`;
  return flowFooter({
    back,
    primary,
    value: l.id,
    primaryText,
    disabled,
    secondary:
      primary !== "next-explain"
        ? `<button class="text-button save-later" data-next-explain="${l.id}">Skip for now</button>`
        : "",
  });
}

function appliedStep(l) {
  const a = l.activity,
    values = activityValues(l.id),
    part = activityPart(l);
  let content = "";
  if (a.kind === "workshop") content = workshopContent(l);
  else if (a.kind === "check")
    content = `<form id="activity-form" data-activity-form="${l.id}">${a.fields.map((field) => `<label class="field-label" for="activity-${field.id}">${e(field.label)}</label>${field.kind === "select" ? `<select class="page-select" id="activity-${field.id}" data-activity-field="${field.id}" data-lesson="${l.id}" required><option value="">Choose an answer</option>${field.options.map(([value, label]) => `<option value="${e(value)}" ${values[field.id] === value ? "selected" : ""}>${e(label)}</option>`).join("")}</select>` : `<input class="activity-number" id="activity-${field.id}" type="number" step="any" required data-activity-field="${field.id}" data-lesson="${l.id}" value="${e(values[field.id] || "")}">`}`).join("")}</form><div id="activity-result">${activityFeedback(l)}</div>`;
  else {
    const field = a.fields[part];
    content = `${carryNotes(l)}<div class="activity-progress">Part ${part + 1} of ${a.fields.length} · notes save as you type</div><label class="field-label" for="activity-answer">${e(field.label)}</label><textarea id="activity-answer" data-activity-field="${field.id}" data-lesson="${l.id}" placeholder="${e(field.placeholder)}">${e(values[field.id] || "")}</textarea>${part ? `<details class="background"><summary>Read your earlier notes</summary>${activityNotes(l)}</details>` : ""}<div id="activity-result">${activityFeedback(l)}</div>`;
  }
  return `<h1>${e(a.title)}</h1><p class="lead compact">${e(a.intro)}</p>${a.source ? `<p class="activity-source"><a href="${e(a.source.url)}" target="_blank" rel="noopener">${e(a.source.label)} ↗</a></p>` : ""}<div id="activity-content">${content}</div>${activityFooter(l)}`;
}
function compareActivity(id) {
  const l = lookup(id);
  if (l.activity.kind === "check" && !$("#activity-form").reportValidity()) return;
  if (
    l.activity.kind === "worksheet" &&
    !Object.values(activityValues(id)).some((value) => value.trim())
  ) {
    toast("Write a first thought, or use Skip for now.");
    return;
  }
  state.activities[id] = {
    ...activityState(id),
    comparison: { revision: l.activity.revision, values: { ...activityValues(id) } },
  };
  save();
  refreshActivityFeedback(l);
  $("#activity-result").scrollIntoView({ block: "start" });
}
function refreshActivityFeedback(l) {
  if ($("#activity-result")) $("#activity-result").innerHTML = activityFeedback(l);
  $(".flow-footer").outerHTML = activityFooter(l);
}
function recordActivityField(el) {
  if (!el.dataset.activityField) return;
  const id = el.dataset.lesson,
    previous = activityState(id);
  if (activityValues(id)[el.dataset.activityField] === el.value) return;
  state.activities[id] = {
    ...previous,
    values: { ...previous.values, [el.dataset.activityField]: el.value },
  };
  save();
  if (lookup(id).activity.kind !== "workshop") refreshActivityFeedback(lookup(id));
}

function teachTask(l) {
  return {
    id: "lesson-" + l.id,
    revision: l.assessment_revision || CONTENT_REVISION,
    criteria: l.transfer[1].map((rule, i) => ({ id: "reason-" + i, label: rule })),
  };
}
function explanationText(id) {
  return state.notes["teach-" + id] || "";
}
function taskRevision(task) {
  return task.revision;
}
function feedbackVersion(record, task, answer) {
  if (!record) return "absent";
  const revision = task.id.startsWith("lesson-")
    ? record.meta?.exercise_revision || record.meta?.content_revision
    : record.meta?.exercise_revision;
  if (revision !== taskRevision(task)) return "earlier";
  return record.answer === answer ? "current" : "edited";
}
function comparedAnswer(comparison, task, answer) {
  return comparison?.revision === taskRevision(task) && comparison.answer === answer;
}
function feedbackConnected() {
  return !!serverStatus?.provider && serverStatus.provider !== "none";
}
function assessmentMessage(id) {
  if (assessment.id !== id) return "";
  if (assessment.kind === "grading")
    return '<p class="feedback-wait" role="status">Reading your answer and checking the reasoning. You can keep editing; this check will refer to the version you submitted.</p>';
  if (assessment.kind === "failed")
    return `<p class="notice" role="alert">${e(assessment.message)} Your answer is still saved. You can try again or compare with the example.</p>`;
  return "";
}
function explanationFooter(l) {
  const task = teachTask(l),
    answer = explanationText(l.id);
  const reviewed =
    feedbackVersion(state.grades[task.id], task, answer) === "current" ||
    comparedAnswer(state.selfChecks[l.id], task, answer);
  const busy = assessment.kind === "grading",
    ownCheck = assessment.id === task.id;
  const block = activeBlock();
  if (block) {
    const checked = blockChecked(block),
      primary = reviewed
        ? checked
          ? "finish-block"
          : "block-quiz"
        : feedbackConnected()
          ? "grade-lesson"
          : "self-check";
    return flowFooter({
      back: `<button class="text-button" data-block-step="practice" data-block="${block.id}">← Questions</button>`,
      primary,
      value: reviewed ? block.id : l.id,
      primaryText: busy
        ? "Reading your explanation…"
        : reviewed
          ? checked
            ? "Finish this block"
            : "Finish the grouped quiz"
          : feedbackConnected()
            ? "Get feedback"
            : "Compare my explanation",
      disabled: busy,
      // Explaining is worth doing, never required to move on.
      secondary: `<button class="text-button" data-skip-explain="${block.id}">Skip</button>`,
    });
  }
  return footer(l, {
    back: "check",
    primary: reviewed ? "finish-lesson" : feedbackConnected() ? "grade-lesson" : "self-check",
    primaryText: busy
      ? ownCheck
        ? "Reading your explanation…"
        : "Feedback is running…"
      : reviewed
        ? "Finish this lesson"
        : feedbackConnected()
          ? state.grades[task.id]
            ? "Check my revision"
            : "Get feedback"
          : "Compare my explanation",
    disabled: busy,
    secondary: !reviewed
      ? `<button class="text-button save-later" data-finish-lesson="${l.id}">Finish for now</button>`
      : "",
  });
}
function selfCheck(l) {
  return `<section class="self-check"><h2>Compare the reasoning.</h2><p>A good explanation should include these ideas:</p><ul>${l.transfer[1].map((s) => `<li>${e(s)}</li>`).join("")}</ul><div class="sample-answer"><p>${e(l.transfer[2])}</p></div><p class="small">You do not need to use the same words. Check whether your explanation makes the same connections.</p></section>`;
}
function explainStep(l) {
  const task = teachTask(l),
    answer = explanationText(l.id),
    record = state.grades[task.id];
  return `<h1>Explain it back.</h1><p class="explain-prompt">${e(l.transfer[0])}</p>${l.activity ? `<details class="background"><summary>Use your saved work from this lesson</summary>${activityNotes(l)}</details>` : ""}<label class="field-label" for="teach-answer">Your explanation</label><textarea id="teach-answer" data-note="teach-${l.id}" placeholder="Explain what happens and why. Use a small example if it helps.">${e(answer)}</textarea><div class="explain-options"><button class="text-button" ${activeBlock() ? `data-block-step="read" data-block="${activeBlock().id}"` : `data-step="learn" data-lesson="${l.id}"`}>Reopen the explanation</button><button class="text-button" data-self-check="${l.id}">Compare without AI feedback</button></div><div id="teach-grade-result">${assessmentMessage(task.id)}${record ? renderGrade(record, task, answer) : ""}${state.selfChecks[l.id] ? selfCheck(l) : ""}</div>${explanationFooter(l)}`;
}
function doneStep(l) {
  const inPass = NoemaProgress.path(LESSONS, state),
    index = inPass.findIndex((x) => x.id === l.id),
    next = index < 0 ? undefined : inPass[index + 1];
  const related = challenges
    .filter((c) => c.lesson === l.id)
    .map(
      (c) =>
        `<button class="option-row" data-go="challenges/${c.id}"><span>Use this idea in a review<small>${e(c.title)} Start with background, then judge the proposal.</small></span><span>→</span></button>`,
    )
    .join("");
  return `<p class="lesson-context">Lesson ${index + 1} · Your place is saved</p><h1>Lesson complete</h1><p class="lead compact">${next ? `Next: ${e(next.title)}.` : "That was the last lesson. Your notes from the activities are saved."}</p><div class="completion-actions"><button class="primary" ${next ? `data-go="lesson/${next.id}"` : `data-open-activity="${l.id}"`}>${next ? "Start the next lesson" : "Revisit your experiment"} →</button><a href="#home">Take a break</a></div><div class="optional-next"><h2>Want to spend more time here?</h2>${l.activity ? `<button class="option-row" data-open-activity="${l.id}"><span>Return to the hands-on activity<small>${e(l.activity.title)} Your notes and results are saved here.</small></span><span>→</span></button>` : ""}${related}<button class="option-row" data-step="learn" data-lesson="${l.id}"><span>Read the explanation again</span><span>→</span></button></div>${background(l)}`;
}
function lesson(id) {
  const l = lookup(id);
  if (!l) return toHome();
  state.lastLesson = id;
  save();
  const flow = flowFor(id);
  if (flow.step === "done") return doneStep(l);
  const content =
    flow.step === "example"
      ? exampleStep(l, flow)
      : flow.step === "check"
        ? checkStep(l)
        : flow.step === "explain"
          ? explainStep(l)
          : readStep(l);
  return lessonHeader(l, flow.step) + content;
}

function reviewState(id) {
  return state.reviews[id] || { step: "background", prediction: "" };
}
function challengeFor(id) {
  return (
    challenges.find((x) => x.id === id) ||
    challenges.find((x) => x.difficulty === "Beginner") ||
    challenges[0]
  );
}
function setReviewStep(id, step) {
  state.reviews[id] = { ...reviewState(id), step };
  save();
  render();
  window.scrollTo(0, 0);
  focusContent();
}
function reviewFooter(
  c,
  {
    back = "",
    ...options
  }: {
    back?: string;
    primary: string;
    primaryText: string;
    secondary?: string;
    disabled?: boolean;
  },
) {
  return flowFooter({
    ...options,
    value: c.id,
    back: back
      ? `<button class="text-button" data-review-step="${back}" data-challenge="${c.id}">← Back</button>`
      : '<a href="#home">Course outline</a>',
  });
}
function reviewWritingFooter(c) {
  const answer = state.challengeAnswers[c.id] || "",
    review = reviewState(c.id);
  const reviewed =
    feedbackVersion(state.grades[c.id], c, answer) === "current" ||
    comparedAnswer(review.comparison, c, answer);
  const busy = assessment.kind === "grading";
  return reviewFooter(c, {
    back: "predict",
    primary: reviewed ? "finish-review" : feedbackConnected() ? "grade" : "compare-review",
    primaryText: busy
      ? assessment.id === c.id
        ? "Reading your review…"
        : "Feedback is running…"
      : reviewed
        ? "Finish this review"
        : feedbackConnected()
          ? state.grades[c.id]
            ? "Check my revision"
            : "Get feedback"
          : "Compare my review",
    disabled: busy,
    secondary: !reviewed
      ? `<button class="text-button save-later" data-finish-review="${c.id}">Finish for now</button>`
      : "",
  });
}
function workedReview(c) {
  return `<section class="self-check"><h2>Compare the reasoning.</h2><p>Look for these connections in your own review:</p><ul>${c.criteria.map((row) => `<li>${e(row.label)}</li>`).join("")}</ul><div class="sample-answer"><p>${e(c.solution)}</p></div><p class="small">You can reach a different conclusion if you can justify it under the stated assumptions. Revise your explanation if the comparison exposes a missing step.</p></section>`;
}
function reviewFeedback(c) {
  const record = state.grades[c.id],
    answer = state.challengeAnswers[c.id] || "";
  return `${assessmentMessage(c.id)}${record ? renderGrade(record, c, answer) : ""}${reviewState(c.id).comparison ? workedReview(c) : ""}`;
}
function challengePage(id) {
  if (!challenges.length)
    return `<h1>Review a change.</h1><p>The practice scenarios are loading. If this persists, restart the local workbook server.</p>`;
  const c = challengeFor(id);
  const review = reviewState(c.id),
    answer = state.challengeAnswers[c.id] || "",
    guide = c.guide;
  const picker = `<details class="background scenario-picker"><summary>Choose a different review</summary><label class="field-label" for="challenge-select">Scenario</label><select class="page-select" id="challenge-select">${challenges.map((x) => `<option value="${x.id}" ${x.id === c.id ? "selected" : ""}>${e(x.title)} · ${e(x.difficulty)}</option>`).join("")}</select></details>`;
  const header = `<div class="lesson-topline"><a href="#home">← Course</a><span>${e(c.kind)} · ${e(c.difficulty)}</span></div>${review.step === "done" ? "" : stepper(c, review.step, REVIEW_STEPS, "review-step", "challenge")}`;
  let content = "";
  if (review.step === "background")
    content = `<h1>${e(c.title)}</h1><article class="prose">${guide.setup.map((p) => `<p>${e(p)}</p>`).join("")}</article><p class="small">Useful earlier lessons: ${guide.needs.map((id) => `<a href="#lesson/${id}">${e(lookup(id).title)}</a>`).join(" · ")}. You can return here afterward; your place is saved.</p><p class="small">This is an illustrative teaching scenario. The proposal was written for this exercise.</p>${reviewFooter(c, { primary: "review-next", primaryText: "Next: inspect the proposal" })}`;
  else if (review.step === "change")
    content = `<h1>What is being proposed?</h1><p class="challenge-prompt">${e(c.prompt)}</p><pre><code>${e(c.artifact)}</code></pre><section class="review-reading"><h2>How to read this</h2>${guide.reading.map(([label, text]) => `<p><b>${e(label)}.</b> ${e(text)}</p>`).join("")}</section><details class="background"><summary>Explain the names and notation</summary><dl class="review-terms">${guide.terms.map(([name, meaning]) => `<dt>${e(name)}</dt><dd>${e(meaning)}</dd>`).join("")}</dl></details><details class="background"><summary>Assumptions for this exercise</summary><p>${e(c.context)}</p></details>${reviewFooter(c, { back: "background", primary: "review-next", primaryText: "Next: predict a result" })}`;
  else if (review.step === "predict")
    content = `<h1>What would happen?</h1><p class="explain-prompt">${e(guide.trace)}</p><p class="small">This is a scratchpad, not a graded answer. A guess gives you something to revisit when you write the full review.</p><details class="background"><summary>See the proposal again</summary><pre><code>${e(c.artifact)}</code></pre></details><label class="field-label" for="review-prediction">Your prediction</label><textarea id="review-prediction" data-review-prediction="${c.id}" placeholder="Walk through the small case. What do you expect to observe, and why?">${e(review.prediction || "")}</textarea><button class="text-button" data-review-hint="${c.id}">I’m stuck</button>${review.hint ? `<p class="hint-text">${e(guide.trace_hint)}</p>` : ""}${reviewFooter(c, { back: "change", primary: "review-next", primaryText: "Next: write your review" })}`;
  else if (review.step === "done")
    content = `<h1>Review complete</h1><p class="lead compact">Your prediction, review and any feedback are saved.</p><div class="completion-actions"><button class="primary" data-go="lesson/${resumeLesson().id}">Continue your course →</button><a href="#home">Return to the course</a></div><button class="option-row" data-review-step="write" data-challenge="${c.id}"><span>Revisit your reasoning<small>Read your prediction alongside your review and revise it.</small></span><span>→</span></button>`;
  else
    content = `<h1>Explain your decision.</h1><p class="challenge-prompt">${e(c.prompt)}</p><details class="background"><summary>See the proposal and your prediction</summary><pre><code>${e(c.artifact)}</code></pre><p><b>Your first prediction:</b> ${e(review.prediction || "You skipped the scratchpad. You can still reason through the example now.")}</p></details><p class="small">Start with your decision and why. Use the small case to support it, say what you would keep or change, and describe a check that could show you are right.</p><label for="challenge-answer" class="field-label">Your review</label><textarea id="challenge-answer" data-challenge-answer="${c.id}" placeholder="I would approve, reject, or investigate this because… In the small case… I would keep or change… To check this, I would…">${e(answer)}</textarea><div class="explain-options"><button class="text-button" data-review-step="change" data-challenge="${c.id}">Reopen the proposal</button><button class="text-button" data-compare-review="${c.id}">Compare without AI feedback</button></div><details class="background"><summary>What should my review explain?</summary><ul>${c.criteria.map((row) => `<li>${e(row.label)}</li>`).join("")}</ul></details><div id="grade-result">${reviewFeedback(c)}</div>${reviewWritingFooter(c)}`;
  return header + content + picker;
}
function renderGrade(record, task, answer) {
  const freshness = feedbackVersion(record, task, answer);
  if (freshness === "earlier")
    return `<section class="written-feedback"><p class="notice">This feedback was written for an earlier version of the exercise. Your answer is saved. Get a fresh check for the question you see now.</p><details><summary>Read the earlier feedback</summary><p>${e(record.grade.summary)}</p>${record.grade.criteria.map((row) => `<p>${e(row.feedback)}</p>`).join("")}</details></section>`;
  const edited = freshness === "edited",
    gap = record.grade.criteria.find((row) => row.verdict !== "met");
  const labels = {
    met: "Explained",
    partial: "Needs more detail",
    missing: "Not yet explained",
    unclear: "Needs review",
  };
  return `<section class="written-feedback">${edited ? '<p class="notice">This feedback refers to your previous answer. Use “Check my revision” when you are ready to review your new wording.</p>' : ""}<p class="feedback-summary">${e(record.grade.summary)}</p>${!edited && gap ? `<div class="feedback-next"><b>One part to work on next</b><p>${e(gap.feedback)}</p><button class="text-button" data-revise="${e(task.id)}">Return to my answer ↑</button></div>` : !edited ? '<p class="small">You can finish here, or try the follow-up to test the idea in a new situation.</p>' : ""}<details class="feedback-breakdown"><summary>See feedback on each part</summary><div class="feedback-points">${record.grade.criteria.map((row) => `<div class="feedback-point"><span class="verdict ${row.verdict}">${labels[row.verdict] || e(row.verdict)}</span><p><b>${e(task.criteria.find((c) => c.id === row.id)?.label || row.id)}</b><br>${e(row.feedback)}</p></div>`).join("")}</div></details><div class="follow-up"><b>Think one step further</b><p>${e(record.grade.follow_up)}</p></div><details class="feedback-evidence"><summary>How this feedback was decided</summary>${record.grade.criteria
    .filter((row) => row.evidence)
    .map((row) => `<blockquote>${e(row.evidence)}</blockquote>`)
    .join(
      "",
    )}<p class="small">${e(record.meta.provider)} · ${e(record.meta.model)} · ${e(record.meta.seconds)} seconds. This is an AI assessment, not a verified correctness result. ${e(record.meta.context_note)}</p></details></section>`;
}
function refreshAssessmentView() {
  const parts = location.hash.slice(1).split("/");
  if (
    (parts[0] === "lesson" && flowFor(parts[1]).step === "explain") ||
    (parts[0] === "block" && parts[2] === "explain")
  ) {
    const block = activeBlock(),
      l = block ? block.lessons[block.lessons.length - 1] : lookup(parts[1]),
      task = teachTask(l),
      record = state.grades[task.id];
    $("#teach-grade-result").innerHTML =
      assessmentMessage(task.id) +
      (record ? renderGrade(record, task, explanationText(l.id)) : "") +
      (state.selfChecks[l.id] ? selfCheck(l) : "");
    $(".flow-footer").outerHTML = explanationFooter(l);
  }
  if (parts[0] === "challenges") {
    const c = challengeFor(parts[1]);
    if (c && reviewState(c.id).step === "write") {
      $("#grade-result").innerHTML = reviewFeedback(c);
      $(".flow-footer").outerHTML = reviewWritingFooter(c);
    }
  }
}
async function requestFeedback(id, answer) {
  if (assessment.kind === "grading") return;
  if (answer.trim().length < 10) {
    toast("Write a few words of your explanation first.");
    return;
  }
  assessment = { kind: "grading", id };
  refreshAssessmentView();
  ($("#teach-grade-result") || $("#grade-result"))?.scrollIntoView({ block: "start" });
  try {
    const response = await fetch("api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id: id, answer }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Feedback could not finish.");
    state.grades[id] = { ...result, answer };
    save();
    assessment = { kind: "idle" };
  } catch (error) {
    assessment = {
      kind: "failed",
      id,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    refreshAssessmentView();
  }
}
// The tab names what is on screen: the topic being read, the lesson, or the reference page.
function pageTitle(parts: string[]) {
  if (parts[0] === "block") {
    const block = blockById(parts[1]);
    return (lookup(parts[3]) || block?.lessons[0])?.title;
  }
  if (parts[0] === "lesson") return lookup(parts[1])?.title;
  if (parts[0] === "challenges") return challengeFor(parts[1])?.title;
  return { glossary: "Glossary", sources: "About this course", placement: "Where to start" }[
    parts[0]
  ];
}
function render() {
  readingObserver?.disconnect();
  readingObserver = null;
  const route = location.hash.slice(1) || "home",
    parts = route.split("/");
  if (["practice", "review", "labs"].includes(parts[0])) {
    const lesson = lookup(parts[1]) || resumeLesson(),
      block = readingBlocks().find((b) => b.lessons.some((l) => l.id === lesson.id));
    history.replaceState(
      null,
      "",
      `#block/${block.id}/${parts[0] === "practice" ? "practice" : "read"}`,
    );
    render();
    return;
  }
  if (parts[0] === "lesson" && lookup(parts[1]) && STEPS.some((step) => step.id === parts[2])) {
    state.flow[parts[1]] = { step: parts[2] };
    save();
    history.replaceState(null, "", "#lesson/" + parts[1]);
    parts.splice(2);
  }
  const c = parts[0] === "challenges" ? challengeFor(parts[1]) : null;
  document.body.classList.toggle(
    "in-lesson",
    (parts[0] === "lesson" && flowFor(parts[1]).step !== "done") ||
      (parts[0] === "block" && ["practice", "explain"].includes(parts[2])) ||
      (!!c && reviewState(c.id).step !== "done"),
  );
  const views = {
    home,
    block: () => blockPage(parts[1], parts[2]),
    lesson: () => lesson(parts[1]),
    placement: placementPage,
    glossary,
    sources,
    challenges: () => challengePage(parts[1]),
  };
  if (!Object.hasOwn(views, parts[0])) {
    history.replaceState(null, "", "#home");
    render();
    return;
  }
  NoemaUI.unmount();
  $("#track-slot").innerHTML = trackSwitch();
  document.title = [pageTitle(parts), META.title].filter(Boolean).join(" · ");
  document.body.classList.toggle("course-overview", parts[0] === "home");
  $("#main").innerHTML = (views[parts[0]] || home)();
  if (parts[0] === "home") {
    const progress = NoemaProgress.snapshot({ META, LESSONS }, state),
      routes = Object.fromEntries(
        readingBlocks().flatMap((block) =>
          block.lessons.map((l) => [l.id, "block/" + block.id + "/read/" + l.id]),
        ),
      );
    NoemaUI.home($("#course-home"), {
      meta: META,
      lessons: NoemaProgress.path(LESSONS, state),
      passes: passes(LESSONS).map((n) => {
        const p = NoemaProgress.snapshot({ META, LESSONS }, trackState(state, n));
        return {
          level: n,
          name: LEVEL_NAMES[n],
          blurb: LEVEL_BLURBS[n],
          total: p.total,
          read: p.read,
          practiced: p.practiced,
          complete: p.complete,
          current: n === levelOf(state),
        };
      }),
      switchPass: (n: Level, start?: boolean) => {
        changeTrack(n);
        if (start) go(NoemaProgress.snapshot({ META, LESSONS }, state).resumeRoute);
      },
      placement: META.placement?.length ? { placed: !!state.placed } : null,
      current: lookup(progress.currentId) || resumeLesson(),
      started: progress.started,
      completed: state.completed,
      read: state.read,
      progress,
      routes,
      storageOK,
      navigate: go,
    });
  } else NoemaUI.lesson();
  NoemaVisuals.mount(LESSONS);
  calculateLabs();
  loadWorkshopSource();
  loadCacheWalkthrough();
  observeReading();
}
function recordQuestionCheck(q, choice) {
  const old = savedQuestion(q);
  state.answers[q.id] = {
    ...old,
    question_revision: q.revision,
    choice,
    checked: true,
    correct: choice === q.correct,
    firstCorrect: old.firstCorrect ?? (choice === q.correct && !old.hint),
    firstChoice: old.firstChoice ?? choice,
    tries: (old.tries || 0) + 1,
  };
  // Answering a topic's question is what "practiced" means.
  const topic = LESSONS.find((l) => l.questions.some((x) => x.id === q.id));
  if (topic) state.completed[topic.id] ??= { at: Date.now() };
}
document.addEventListener("submit", (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  if (event.target.id === "placement-form") {
    event.preventDefault();
    const choices = Object.fromEntries(
      [...new FormData(event.target)].map(([id, value]) => [id, Number(value)]),
    );
    state.placement = choices;
    state = switchTrack(state, place(META.placement || [], choices));
    state.placed = true;
    save();
    render();
    window.scrollTo(0, 0);
    return;
  }
  const activityForm = event.target.closest<HTMLFormElement>("[data-activity-form]");
  if (activityForm) {
    event.preventDefault();
    compareActivity(activityForm.dataset.activityForm);
    return;
  }
  const form = event.target.closest<HTMLFormElement>("[data-q]");
  if (!form) return;
  event.preventDefault();
  if (activeBlock() && location.hash.split("/")[2] === "practice") {
    checkBlock(activeBlock());
    return;
  }
  const q = LESSONS.flatMap((l) => l.questions).find((item) => item.id === form.dataset.q);
  const choiceValue = new FormData(form).get("choice");
  if (choiceValue === null) {
    toast("Choose an answer first.");
    return;
  }
  const choice = Number(choiceValue);
  recordQuestionCheck(q, choice);
  save();
  const position = window.scrollY;
  render();
  window.scrollTo(0, position);
});
document.addEventListener("input", (event) => {
  const el = event.target;
  if (
    !(
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    )
  )
    return;
  if (el.dataset.visualRate) {
    NoemaVisuals.updateExperiment(
      NoemaVisuals.find(LESSONS, el.dataset.visualRate),
      Number(el.value) / 100,
    );
    return;
  }
  recordActivityField(el);
  if (el.dataset.note) {
    state.notes[el.dataset.note] = el.value;
    save();
    if (el.dataset.note.startsWith("teach-")) refreshAssessmentView();
  }
  if (el.dataset.challengeAnswer) {
    state.challengeAnswers[el.dataset.challengeAnswer] = el.value;
    save();
    refreshAssessmentView();
  }
  if (el.dataset.reviewPrediction) {
    const id = el.dataset.reviewPrediction;
    state.reviews[id] = { ...reviewState(id), prediction: el.value };
    save();
  }
  if (el.matches('input[type="radio"][name="choice"]')) {
    const form = el.closest<HTMLFormElement>("[data-q]"),
      id = form.dataset.q,
      choice = el.value,
      q = LESSONS.flatMap((l) => l.questions).find((x) => x.id === id);
    state.answers[id] = {
      ...savedQuestion(q),
      question_revision: q.revision,
      choice: Number(choice),
      checked: false,
    };
    save();
    const position = window.scrollY;
    render();
    document
      .querySelector<HTMLInputElement>(`form[data-q="${id}"] input[value="${choice}"]`)
      .focus({ preventScroll: true });
    window.scrollTo(0, position);
  }
  if (el.hasAttribute("data-lab-input")) calculateLabs();
  if (el.id === "glossary-filter") {
    const tmp = document.createElement("div");
    tmp.innerHTML = glossary(el.value);
    $("#glossary-entries").innerHTML = tmp.querySelector("#glossary-entries").innerHTML;
  }
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (
    !(
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    )
  )
    return;
  recordActivityField(el);
  if (el.hasAttribute("data-lab-input")) calculateLabs();
  if (el.id === "challenge-select") go("challenges/" + el.value);
  if (el.id === "engine-function") {
    activeWorkshopSource = el.value;
    refreshEngineSource();
  }
  if (el.id === "cache-start") {
    const previous = activityState("workshop");
    state.activities.workshop = {
      ...previous,
      cacheLab: { ...cacheLabState(), start: Number(el.value), prediction: "" },
    };
    save();
    document
      .querySelectorAll<HTMLInputElement>('[name="cache-prediction"]')
      .forEach((input) => (input.checked = false));
    refreshCacheLab();
  }
  if (el.name === "cache-prediction") {
    const previous = activityState("workshop");
    state.activities.workshop = {
      ...previous,
      cacheLab: { ...cacheLabState(), prediction: el.value },
    };
    save();
    refreshCacheLab();
  }
});
document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("[data-skip-placement]")) {
    state.placed = true;
    save();
    go("home");
    return;
  }
  if (event.target.closest("[data-retake-placement]")) {
    state.placed = false;
    save();
    render();
    return;
  }
  const track = event.target.closest<HTMLElement>("[data-track]");
  if (track) {
    const n = Number(track.dataset.track) as Level;
    if (n !== levelOf(state)) changeTrack(n);
    if (track.hasAttribute("data-track-start"))
      go(NoemaProgress.snapshot({ META, LESSONS }, state).resumeRoute);
    return;
  }
  const jump = event.target.closest<HTMLAnchorElement>("[data-read-jump]");
  if (jump) {
    event.preventDefault();
    state.lastLesson = jump.dataset.readJump;
    save();
    history.replaceState(null, "", jump.getAttribute("href"));
    document.getElementById("read-" + jump.dataset.readJump)?.scrollIntoView({ block: "start" });
    return;
  }
  const button = event.target.closest("button");
  if (!button) return;
  const b = button.dataset;
  if (b.blockStep) {
    const block = blockById(b.block);
    if (block) blockStep(block, b.blockStep);
    return;
  }
  if (b.finishReading) {
    const block = blockById(b.finishReading);
    for (const l of block.lessons) state.read[l.id] = { at: Date.now() };
    blockStep(block, "practice");
    return;
  }
  if (b.checkBlock) {
    checkBlock(blockById(b.checkBlock));
    return;
  }
  if (b.retryMissed) {
    const block = blockById(b.retryMissed);
    for (const q of blockQuestions(block)) {
      const answer = savedQuestion(q);
      if (answer.checked && !answer.correct) state.answers[q.id] = { ...answer, checked: false };
    }
    save();
    render();
    document
      .querySelector<HTMLInputElement>(
        ".block-question:has(.question:not(:has(.answer-feedback))) input",
      )
      ?.focus();
    return;
  }
  if (b.blockExplain) {
    blockStep(blockById(b.blockExplain), "explain");
    return;
  }
  if (b.blockQuiz) {
    blockStep(blockById(b.blockQuiz), "practice");
    return;
  }
  if (b.skipExplain) {
    blockStep(blockById(b.skipExplain), "done");
    return;
  }
  if (b.finishBlock) {
    const block = blockById(b.finishBlock),
      l = block.lessons[block.lessons.length - 1],
      task = teachTask(l),
      answer = explanationText(l.id);
    if (
      !blockChecked(block) ||
      !(
        feedbackVersion(state.grades[task.id], task, answer) === "current" ||
        comparedAnswer(state.selfChecks[l.id], task, answer)
      )
    ) {
      toast("Check the grouped questions and compare your current explanation first.");
      return;
    }
    for (const topic of block.lessons) {
      state.read[topic.id] = { at: Date.now() };
      state.completed[topic.id] = { at: Date.now() };
    }
    blockStep(block, "done");
    return;
  }
  if (b.visualReset) {
    const l = NoemaVisuals.find(LESSONS, b.visualReset),
      slider = document.querySelector<HTMLInputElement>(
        '[data-visual-rate="' + b.visualReset + '"]',
      );
    if (l.visual?.kind !== "funnel" || !slider) return;
    slider.value = String(l.visual.stages[l.visual.adjustable_stage].rate * 100);
    NoemaVisuals.updateExperiment(l, Number(slider.value) / 100);
    return;
  }
  if (b.go) {
    go(b.go);
    return;
  }
  if (b.runReferenceChecks) {
    await runReferenceChecks();
    return;
  }
  if (b.retryEngineSource) {
    workshopSource = { kind: "idle" };
    await loadWorkshopSource();
    return;
  }
  if (b.retryCacheExample) {
    cacheWalkthrough = { kind: "idle" };
    await loadCacheWalkthrough();
    return;
  }
  if (b.runCacheLab) {
    await runCacheLab();
    return;
  }
  if (b.focusCacheLine) {
    document.querySelector<HTMLInputElement>("#cache-start")?.focus();
    document.querySelector<HTMLInputElement>("#cache-start")?.scrollIntoView({ block: "center" });
    return;
  }
  if (b.openActivity) {
    openActivity(b.openActivity);
    return;
  }
  if (b.quickCheck) {
    setStep(b.quickCheck, "check");
    return;
  }
  if (b.activityNext || b.activityBack) {
    const id = b.activityNext || b.activityBack,
      l = lookup(id),
      count = Array.isArray(l.activity.fields) ? l.activity.fields.length : 0;
    state.activities[id] = {
      ...activityState(id),
      part: Math.max(0, Math.min(count - 1, activityPart(l) + (b.activityNext ? 1 : -1))),
    };
    save();
    setStep(id, "check", 1);
    return;
  }
  if (b.compareActivity) {
    compareActivity(b.compareActivity);
    return;
  }
  if (b.reviewStep) {
    setReviewStep(b.challenge, b.reviewStep);
    return;
  }
  if (b.reviewNext) {
    const old = reviewState(b.reviewNext),
      index = REVIEW_STEPS.findIndex((step) => step.id === old.step);
    setReviewStep(b.reviewNext, REVIEW_STEPS[Math.min(index + 1, 3)].id);
    return;
  }
  if (b.reviewHint) {
    state.reviews[b.reviewHint] = { ...reviewState(b.reviewHint), hint: true };
    save();
    const position = window.scrollY;
    render();
    window.scrollTo(0, position);
    return;
  }
  if (b.compareReview) {
    const id = b.compareReview,
      answer = state.challengeAnswers[id] || "",
      c = challengeFor(id);
    if (answer.trim().length < 10) {
      toast("Try a few words of your own review before comparing.");
      return;
    }
    state.reviews[id] = { ...reviewState(id), comparison: { answer, revision: taskRevision(c) } };
    save();
    refreshAssessmentView();
    $(".self-check")?.scrollIntoView({ block: "start" });
    return;
  }
  if (b.finishReview) {
    state.reviews[b.finishReview] = { ...reviewState(b.finishReview), completedAt: Date.now() };
    setReviewStep(b.finishReview, "done");
    return;
  }
  if (b.revise) {
    const input = b.revise.startsWith("lesson-") ? $("#teach-answer") : $("#challenge-answer");
    input?.focus();
    return;
  }
  if (b.step) {
    const old = flowFor(b.lesson);
    const back = !!button.closest(".flow-footer");
    const part =
      back && b.step === "example" && old.step === "example"
        ? Math.max(0, (old.part || 0) - 1)
        : back && b.step === "example" && old.step === "check"
          ? lookup(b.lesson).example[1].length - 1
          : back && b.step === "check" && old.step === "explain" && lookup(b.lesson).activity
            ? 1
            : 0;
    setStep(b.lesson, b.step, part);
    return;
  }
  if (b.nextExample) {
    setStep(b.nextExample, "example");
    return;
  }
  if (b.exampleNext) {
    setStep(b.exampleNext, "example", (flowFor(b.exampleNext).part || 0) + 1);
    return;
  }
  if (b.nextCheck) {
    setStep(b.nextCheck, "check");
    return;
  }
  if (b.submitCheck) {
    const form = $("form[data-q]");
    if (form.reportValidity()) form.requestSubmit();
    return;
  }
  if (b.nextExplain) {
    setStep(b.nextExplain, "explain");
    return;
  }
  if (b.selfCheck) {
    const answer = explanationText(b.selfCheck);
    if (answer.trim().length < 10) {
      toast("Try a few words of your own explanation before comparing.");
      return;
    }
    state.selfChecks[b.selfCheck] = { answer, revision: teachTask(lookup(b.selfCheck)).revision };
    save();
    refreshAssessmentView();
    $(".self-check")?.scrollIntoView({ block: "start" });
    return;
  }
  if (b.finishLesson) {
    state.completed[b.finishLesson] = { at: Date.now() };
    setStep(b.finishLesson, "done");
    return;
  }
  if (b.hint) {
    const q = LESSONS.flatMap((l) => l.questions).find((x) => x.id === b.hint);
    state.answers[b.hint] = { ...savedQuestion(q), question_revision: q.revision, hint: true };
    save();
    const position = window.scrollY;
    render();
    window.scrollTo(0, position);
    return;
  }
  const lessonId = b.gradeLesson;
  if (lessonId) {
    await requestFeedback("lesson-" + lessonId, explanationText(lessonId));
    return;
  }
  if (b.grade) {
    await requestFeedback(b.grade, state.challengeAnswers[b.grade] || "");
    return;
  }
  if (button.id === "export") {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = META.id + "-learning-progress.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
window.addEventListener("hashchange", () => {
  document
    .querySelectorAll<HTMLInputElement>(".reference-menu[open]")
    .forEach((el) => el.removeAttribute("open"));
  render();
  window.scrollTo(0, 0);
  focusContent();
});
document.querySelector<HTMLInputElement>(".skip").addEventListener("click", (event) => {
  event.preventDefault();
  focusContent();
  $("#main").scrollIntoView({ block: "start" });
});

function slider(id, label, min, max, value, step = 1) {
  return `<label>${label} <output id="${id}-out">${value}</output><input id="${id}" type="range" min="${min}" max="${max}" value="${value}" step="${step}" data-lab-input></label>`;
}

function lab(id) {
  const introductions = {
    softmax: [
      "The sampling dial",
      "Predict which probability changes most as temperature falls.",
      "This is a four-token vocabulary with invented logits, not a real tokenizer or model.",
    ],
    roofline: [
      "Where is the bottleneck?",
      "Predict when more batching stops amortizing weight reads.",
      "A toy dense projection only: ignores KV, activation traffic, communication, launches and capacity. Not a GPU benchmark.",
    ],
    kv: [
      "How big does the KV cache get?",
      "Predict the effect of doubling both batch and context.",
      "Conventional uncompressed cache, not DeepSeek-V4.1. Raw entries only; no allocator or workspace overhead.",
    ],
    overlap: [
      "Find the idle gap",
      "Predict whether CPU optimization helps when GPU work is already longer.",
      "An idealized steady-state pipeline with assumed safe dependencies. It is not a trace of DeepInfer.",
    ],
    spec: [
      "Spend the verification budget",
      "Predict whether the fifth draft deserves a slot more than another request’s first.",
      "Toy fixed-budget expected accepted drafts. Excludes target slots, bonus/correction tokens and hardware cost profiles.",
    ],
  };
  const [title, predict, limit] = introductions[id];
  let controls = "";
  if (id === "softmax") controls = slider("temperature", "Temperature", 0.1, 2, 1, 0.1);
  if (id === "roofline")
    controls =
      slider("batch-size", "Tokens sharing weights", 1, 256, 16) +
      slider("compute-rate", "Compute (TFLOP/s)", 20, 400, 100, 10) +
      slider("memory-rate", "Memory (GB/s)", 100, 3000, 1000, 100);
  if (id === "kv")
    controls =
      slider("kv-batch", "Requests", 1, 32, 4) +
      slider("kv-context", "Tokens per request", 1024, 65536, 4096, 1024) +
      `<label>KV heads <select id="kv-heads" data-lab-input><option value="1">1 · MQA-like</option><option value="8" selected>8 · GQA-like</option><option value="32">32 · MHA-like</option></select></label><label>Bytes / element <select id="kv-bytes" data-lab-input><option value="1">1 · illustrative 8-bit</option><option value="2" selected>2 · BF16/FP16</option><option value="4">4 · FP32</option></select></label>`;
  if (id === "overlap")
    controls =
      slider("cpu-ms", "CPU work (ms/round)", 1, 20, 3) +
      slider("gpu-ms", "GPU work (ms/round)", 1, 20, 8);
  if (id === "spec")
    controls =
      slider("verify-budget", "Total draft slots", 0, 10, 5) +
      slider("confidence-b", "Request B conditional acceptance (%)", 10, 99, 60);
  return `<section class="lab" data-lab="${id}"><h3 style="margin-top:10px">${title}</h3><p style="font-size:16px">${predict}</p><div class="lab-controls">${controls}</div><div class="lab-results" id="lab-results-${id}" role="status" aria-live="polite"></div><p class="small" style="margin-top:13px">${limit}</p></section>`;
}

function calculateLabs() {
  const val = (id) => Number(document.querySelector<HTMLInputElement>("#" + id)?.value);
  document.querySelectorAll<HTMLInputElement>("[data-lab-input]").forEach((input) => {
    const out = document.getElementById(input.id + "-out");
    if (out) out.textContent = input.value;
  });
  if ($("#lab-results-softmax")) {
    const t = val("temperature"),
      logits = [2, 1, 0, -1],
      exp = logits.map((x) => Math.exp((x - 2) / t)),
      sum = exp.reduce((a, b) => a + b, 0);
    $("#lab-results-softmax").innerHTML =
      `<b>Same logits [2, 1, 0, −1]. Different probabilities.</b><div class="bars">${exp.map((x, i) => `<div class="bar-row"><span>Token ${"ABCD"[i]}</span><div class="bar-track"><div class="bar-fill" style="width:${(100 * x) / sum}%"></div></div><span>${((100 * x) / sum).toFixed(1)}%</span></div>`).join("")}</div>Greedy still picks A. Sampling can choose another token.`;
  }
  if ($("#lab-results-roofline")) {
    const b = val("batch-size"),
      c = val("compute-rate"),
      m = val("memory-rate"),
      math = (8 * b) / c,
      mem = 8000 / m,
      time = Math.max(math, mem);
    $("#lab-results-roofline").innerHTML =
      `<b>${time.toFixed(2)} ms</b> ideal-overlap lower bound · ${math > mem ? "compute" : "weight-bandwidth"} limited<br>8 GB weights, 8 GFLOPs/token: math = ${math.toFixed(2)} ms; read weights = ${mem.toFixed(2)} ms.<br>Illustrative aggregate rate: ${((b / time) * 1000).toFixed(0)} token positions/s. Arithmetic intensity ≈ ${b} FLOPs/byte. <b>This is not a full model throughput estimate.</b>`;
  }
  if ($("#lab-results-kv")) {
    const b = val("kv-batch"),
      t = val("kv-context"),
      h = val("kv-heads"),
      bytes = val("kv-bytes"),
      total = 2 * 32 * b * t * h * 128 * bytes;
    $("#lab-results-kv").innerHTML =
      `<b>${(total / 2 ** 30).toFixed(2)} GiB</b> raw KV (${(total / 1e9).toFixed(2)} decimal GB)<br><code>2 × 32 layers × ${b} requests × ${t} tokens × ${h} KV heads × 128 dimensions × ${bytes} bytes</code><br>Weights, temporary activations, paging overhead and headroom are additional.`;
  }
  if ($("#lab-results-overlap")) {
    const c = val("cpu-ms"),
      g = val("gpu-ms"),
      serial = c + g,
      overlap = Math.max(c, g);
    $("#lab-results-overlap").innerHTML =
      `<b>Serial: ${serial} ms/round. Ideal overlap: ${overlap} ms/round</b> after startup.<br>Upper illustrative speedup: ${(serial / overlap).toFixed(2)}×.<div class="timeline"><span class="cpu" style="flex:${c}">CPU</span><span class="gpu" style="flex:${g}">GPU</span></div><div class="timeline"><span class="gpu" style="flex:${g}">current GPU</span>${c > g ? `<span class="idle" style="flex:${c - g}">wait</span>` : ""}</div><div class="timeline"><span class="cpu" style="flex:${c}">future CPU</span>${g > c ? `<span class="blank" style="flex:${g - c}"></span>` : ""}</div>Overlap changes steady-state spacing; it does not remove the first round’s setup or dependencies.`;
  }
  if ($("#lab-results-spec")) {
    const k = val("verify-budget"),
      rates = [[0.96, 0.9, 0.82, 0.68, 0.5], Array(5).fill(val("confidence-b") / 100)],
      candidates = [];
    rates.forEach((row, r) => {
      let p = 1;
      row.forEach((a, j) => {
        p *= a;
        candidates.push({ r, j, p });
      });
    });
    candidates.sort((a, b) => b.p - a.p || a.r - b.r || a.j - b.j);
    const chosen = candidates.slice(0, k),
      lengths = [0, 0];
    chosen.forEach((x) => lengths[x.r]++);
    const expected = chosen.reduce((s, x) => s + x.p, 0),
      fixed = [Math.ceil(k / 2), Math.floor(k / 2)],
      fixedScore = rates.reduce((s, row, r) => {
        let p = 1;
        return (
          s +
          row.slice(0, fixed[r]).reduce((n, a) => {
            p *= a;
            return n + p;
          }, 0)
        );
      }, 0);
    $("#lab-results-spec").innerHTML =
      `<b>Confidence allocation: A gets ${lengths[0]} slots, B gets ${lengths[1]}.</b><br>Expected accepted drafts: ${expected.toFixed(3)} versus ${fixedScore.toFixed(3)} with an even split.<table><tr><th>Prefix length</th><th>A survival</th><th>B survival</th></tr>${rates[0]
        .map(
          (_, j) =>
            `<tr><td>${j + 1}</td>${rates
              .map(
                (row, r) =>
                  `<td>${row
                    .slice(0, j + 1)
                    .reduce((p, a) => p * a, 1)
                    .toFixed(3)}${j < lengths[r] ? " ✓" : ""}</td>`,
              )
              .join("")}</tr>`,
        )
        .join(
          "",
        )}</table>This greedy selection is optimal only for this toy equal-cost budget with nonincreasing prefix contributions. The real engine has more constraints.`;
  }
}

function glossary(filter = "") {
  const entries = Object.entries(GLOSSARY).filter(([k, v]) =>
    (k + " " + v).toLowerCase().includes(filter.toLowerCase()),
  );
  return `<h1>Glossary</h1><input class="glossary-search" id="glossary-filter" type="search" aria-label="Search the glossary" placeholder="Search ${Object.keys(GLOSSARY).length} terms" value="${e(filter)}"><dl id="glossary-entries">${entries.map(([k, v]) => `<div class="glossary-item"><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl>`;
}

function sources() {
  const about = document.createElement("div");
  about.innerHTML = META.about_html;
  about.querySelectorAll(".eyebrow").forEach((label) => label.remove());
  return `${about.innerHTML}<h2>Reading library</h2>${Object.entries(SOURCES)
    .map(
      ([_id, s]) =>
        `<div class="source-item"><a href="${e(s[1])}" target="_blank" rel="noopener">${e(s[0])} ↗</a><p>${e(s[2])}</p></div>`,
    )
    .join(
      "",
    )}<p>AI feedback is provisional. See the project README for provider setup and sharing.</p>`;
}

save();
render();
Promise.allSettled([
  fetch("challenges.json").then((r) => r.json()),
  fetch("api/status").then((r) => r.json()),
]).then((results) => {
  if (results[0].status === "fulfilled" && Array.isArray(results[0].value))
    challenges = results[0].value;
  if (results[1].status === "fulfilled") serverStatus = results[1].value;
  const route = location.hash.slice(1).split("/");
  if (
    route[0] === "challenges" ||
    (route[0] === "lesson" && flowFor(route[1]).step === "explain") ||
    (route[0] === "block" && route[2] === "explain")
  )
    render();
});

// Hover previews, like Wikipedia's page previews: a marked term shows its glossary entry and a
// citation shows its source card. Keyboard focus and taps open them too.
const preview = document.createElement("div");
preview.className = "hover-card";
preview.id = "hover-card";
preview.setAttribute("role", "tooltip");
preview.hidden = true;
document.body.append(preview);
let previewFor: Element | null = null,
  hideTimer: ReturnType<typeof setTimeout> | undefined;
function enhanceMarks() {
  document.querySelectorAll<HTMLElement>("dfn[data-term]").forEach((d) => {
    d.tabIndex = 0;
    d.setAttribute("aria-describedby", "hover-card");
  });
  document.querySelectorAll<HTMLAnchorElement>("a[data-source]").forEach((a) => {
    const source = SOURCES[a.dataset.source];
    if (!source) return;
    a.href = sourceHref(source[1], a.dataset.quote);
    a.target = "_blank";
    a.rel = "noopener";
    a.setAttribute("aria-describedby", "hover-card");
  });
  // Every outside link in course content opens in a new tab, so the reader keeps their place.
  document.querySelectorAll<HTMLAnchorElement>('#main a[href^="http"]').forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener";
  });
}
function showPreview(el: HTMLElement) {
  clearTimeout(hideTimer);
  if (previewFor === el && !preview.hidden) return;
  if (el.dataset.term) {
    const definition = GLOSSARY[el.dataset.term];
    if (!definition) return;
    preview.innerHTML = `<p class="hover-kind">${icon("book-bookmark", 14)}Glossary</p><h4>${e(el.dataset.term)}</h4><p>${e(definition)}</p><a href="#glossary">All terms</a>`;
  } else {
    const source = SOURCES[el.dataset.source];
    if (!source) return;
    const quote = el.dataset.quote;
    preview.innerHTML = `<p class="hover-kind">${icon("file-text", 14)}${e(new URL(source[1]).hostname.replace(/^www\./, ""))}</p><h4>${e(source[0])}</h4>${quote ? `<blockquote>${e(quote)}</blockquote>` : `<p>${e(source[2])}</p>`}<a href="${e(sourceHref(source[1], quote))}" target="_blank" rel="noopener">${quote ? "Open at this passage" : "Open the source"} ${icon("external-link", 14)}</a>`;
  }
  previewFor = el;
  preview.hidden = false;
  const r = el.getBoundingClientRect(),
    w = preview.offsetWidth,
    h = preview.offsetHeight,
    below = r.bottom + 8 + h < innerHeight;
  preview.style.left = Math.max(16, Math.min(r.left, innerWidth - w - 16)) + scrollX + "px";
  preview.style.top = (below ? r.bottom + 8 : r.top - h - 8) + scrollY + "px";
}
function hidePreview(delay = 150) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    preview.hidden = true;
    previewFor = null;
  }, delay);
}
const markOf = (t: EventTarget | null) =>
  t instanceof Element ? t.closest<HTMLElement>("dfn[data-term], a[data-source]") : null;
document.addEventListener("mouseover", (event) => {
  const mark = markOf(event.target);
  if (mark) showPreview(mark);
  else if (!(event.target instanceof Node && preview.contains(event.target)) && previewFor)
    hidePreview();
});
document.addEventListener("focusin", (event) => {
  const mark = markOf(event.target);
  if (mark) showPreview(mark);
});
document.addEventListener("focusout", (event) => {
  if (markOf(event.target)) hidePreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !preview.hidden) hidePreview(0);
});
// Touch: a tap on a term opens its card; a tap elsewhere closes it.
document.addEventListener("pointerdown", (event) => {
  const mark = markOf(event.target);
  if (event.pointerType !== "mouse" && mark?.dataset.term) showPreview(mark);
  else if (!(event.target instanceof Node && preview.contains(event.target))) hidePreview(0);
});
new MutationObserver(enhanceMarks).observe(document.getElementById("main")!, {
  childList: true,
  subtree: true,
});
enhanceMarks();
