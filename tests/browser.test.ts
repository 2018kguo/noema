import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBundle, ROOT } from "../src/course";
import { makeServer } from "../src/server";
import { workshop } from "../src/workshop";
const sample = loadBundle(join(ROOT, "courses/deepinfer"));
const directory = mkdtempSync(join(tmpdir(), "noema-browser-"));
const fixture = {
  funnel_fixture: false,
  two_funnels: false,
  fail_grade: false,
  fail_workshop: false,
  submitted_answer: "",
  started: false,
};
let release: () => void = () => {},
  gate = Promise.resolve();
function pauseGrade() {
  fixture.started = false;
  gate = new Promise<void>((r) => (release = r));
}
function releaseGrade() {
  release();
  gate = Promise.resolve();
}
async function waitStarted() {
  for (let i = 0; i < 100; i++) {
    if (fixture.started) return true;
    await Bun.sleep(30);
  }
  return false;
}
const funnel = {
  kind: "funnel" as const,
  title: "Follow parts through three checks",
  caption: "Invented parts inspection; counts are expected values.",
  source_ids: [],
  initial: 100,
  unit: "parts",
  start_label: "Starting parts",
  adjustable_stage: 1,
  stages: [
    { label: "First check", rate: 0.8 },
    { label: "Second check", rate: 0.5 },
    { label: "Third check", rate: 0.75 },
  ],
};
function writeCourse() {
  const c = structuredClone(sample.course);
  if (fixture.funnel_fixture) {
    c.LESSONS[0].visual = funnel;
    c.LESSONS[0].example_title = funnel.title;
    c.LESSONS[0].example = [
      "Invented parts inspection.",
      [
        "Keep 80% of the starting 100.",
        "Keep 50% of the remaining 80.",
        "Keep 75% of the remaining 40.",
      ],
    ];
  }
  if (fixture.two_funnels) {
    c.LESSONS[1].visual = funnel;
    c.LESSONS[1].example = [
      "Another invented inspection.",
      ["Keep 80%.", "Then 50%.", "Then 75%."],
    ];
  }
  writeFileSync(join(directory, "course.json"), JSON.stringify(c));
  writeFileSync(
    join(directory, "challenges.json"),
    JSON.stringify(Object.values(sample.challenges)),
  );
}
writeCourse();
const server = makeServer({
  course: directory,
  port: 0,
  provider: "test-fixture",
  assessor: async (c, answer) => {
    fixture.submitted_answer = answer;
    fixture.started = true;
    await gate;
    if (fixture.fail_grade) throw Error("Deterministic test failure.");
    return {
      grade: {
        summary: "Fixture feedback on the submitted answer.",
        criteria: c.criteria.map((r) => ({
          id: r.id,
          verdict: "missing" as const,
          evidence: "",
          feedback: "Explain the connection using your small example.",
        })),
        follow_up: "What would you compare with a reference?",
      },
      meta: {
        provider: "test-fixture",
        model: "deterministic",
        seconds: 0,
        context: [],
        context_note: "Browser fixture; no model was called.",
        answer_sha256: "fixture",
        rubric_sha256: "fixture",
        content_revision: sample.course.CONTENT_REVISION,
        exercise_revision: c.revision,
      },
    };
  },
  workshopRunner: async (...args) => {
    if (fixture.fail_workshop) throw Error("A test fixture comparison failed.");
    return workshop(...args);
  },
});
const origin = "http://127.0.0.1:" + server.port;
const executable = Bun.which("agent-browser");
if (!executable)
  throw Error("Install agent-browser 0.37.1 and run agent-browser install before browser tests.");
const prefix = [
  executable,
  "--namespace",
  "noema-ts-browser-tests",
  "--session",
  "test-" + process.pid,
  "--json",
];
async function command(...args: string[]) {
  if (["reload", "open"].includes(args[0])) writeCourse();
  const process = Bun.spawn([...prefix, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(process.stdout).text(),
    stderr = await new Response(process.stderr).text();
  if (await process.exited) throw Error(stdout + stderr);
  const response = JSON.parse(stdout);
  if (!response.success) throw Error(stdout);
  return response.data;
}
async function js(source: string) {
  const p = Bun.spawn([...prefix, "eval", "--stdin"], {
    stdin: new Blob([source]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(p.stdout).text();
  if (await p.exited) throw Error(out + (await new Response(p.stderr).text()));
  const value = JSON.parse(out);
  if (!value.success) throw Error(out);
  return value.data.result;
}
async function wait(expression: string) {
  await command("wait", "--fn", expression);
}
async function click(selector: string) {
  await js(
    "document.querySelector(" +
      JSON.stringify(selector) +
      ').scrollIntoView({block:"center"});true',
  );
  await command("click", selector);
}
async function openRoute(route: string) {
  await command("open", origin + "/#" + route);
  await wait("document.querySelector('.flow-footer') !== null");
}
async function lessonAnswer(
  text = "The engine runs learned numbers and the service routes requests.",
) {
  await click("[data-step=explain]");
  await command("fill", "#teach-answer", text);
}
async function appliedActivity(id: string) {
  await openRoute("lesson/" + id);
  await click("[data-step=check]");
  const lesson = sample.course.LESSONS.find((l) => l.id === id)!;
  await click('form[data-q] input[value="' + lesson.questions[0].correct + '"]');
  await click("[data-submit-check]");
  await click(".primary[data-open-activity]");
}
beforeEach(async () => {
  fixture.funnel_fixture = false;
  fixture.two_funnels = false;
  fixture.fail_grade = false;
  fixture.fail_workshop = false;
  fixture.started = false;
  releaseGrade();
  await openRoute("lesson/map");
  await js("localStorage.clear();true");
  await command("reload");
  await wait("document.querySelector('[data-step=explain]') !== null");
  await command("set", "viewport", "1280", "900");
});
afterAll(async () => {
  releaseGrade();
  await command("close");
  await server.stop(true);
  rmSync(directory, { recursive: true, force: true });
});
test("all review routes have one action and save predictions", async () => {
  for (const task of Object.values(sample.challenges)) {
    await openRoute("challenges/" + task["id"]);
    expect(await js("document.querySelectorAll('.primary').length")).toEqual(1);
    expect(await js("!!document.querySelector('textarea')")).toBeFalsy();
    await click("[data-review-next]");
    expect(await js("!!document.querySelector('.review-reading')")).toBeTruthy();
    await click("[data-review-next]");
    const prediction = "A saved prediction for " + task["id"];
    await command("fill", "#review-prediction", prediction);
    await click("[data-review-hint]");
    await command("reload");
    await wait("document.querySelector('#review-prediction') !== null");
    expect(await js("document.querySelector('#review-prediction').value")).toEqual(prediction);
    expect(await js("!!document.querySelector('.hint-text')")).toBeTruthy();
    await click("[data-review-next]");
    await command(
      "fill",
      "#challenge-answer",
      "My review applies the small example and compares its results.",
    );
    await click("[data-compare-review]");
    expect(await js("document.querySelectorAll('.self-check').length")).toEqual(1);
    expect(await js("!!document.querySelector('[data-finish-review].primary')")).toBeTruthy();
    await command("fill", "#challenge-answer", "I edited this review after comparing it.");
    expect(await js("!!document.querySelector('[data-grade].primary')")).toBeTruthy();
    expect(await js("!!document.querySelector('[data-finish-review].primary')")).toBeFalsy();
    await click("[data-finish-review]");
    expect(await js("document.querySelector('h1').textContent")).toContain("Review complete");
  }
}, 120000);

test("visual counts follow steps and keyboard experiment preserves original", async () => {
  fixture.funnel_fixture = true;
  await command("reload");
  await wait("document.querySelector('[data-step=example]') !== null");
  await click("[data-step=example]");
  expect(await js("Number(document.querySelector('[data-funnel]').dataset.value)")).toEqual(80);
  await click("[data-example-next]");
  expect(await js("Number(document.querySelector('[data-funnel]').dataset.value)")).toEqual(40);
  expect(await js("document.querySelector('.visual-equation').textContent")).toContain(
    "80 entering this gate",
  );
  expect(await js("document.querySelectorAll('.example-history li').length")).toEqual(1);
  await click("[data-example-next]");
  expect(await js("Number(document.querySelector('[data-funnel]').dataset.value)")).toEqual(30);
  await click(".visual-experiment > summary");
  await wait("document.querySelector('details.visual-experiment').open");
  await command("focus", "[data-visual-rate]");
  await command("press", "ArrowRight");
  expect(await js("document.querySelector('[data-visual-rate]').value")).toEqual("50.5");
  expect(
    await js("document.querySelector('[data-visual-experiment-result]').textContent"),
  ).toContain("30.3");
  expect(await js("Number(document.querySelector('[data-funnel]').dataset.value)")).toEqual(30);
  await click("[data-visual-reset]");
  expect(await js("document.querySelector('[data-visual-rate]').value")).toEqual("50");
  await click(".flow-footer [data-step]");
  expect(await js("Number(document.querySelector('[data-funnel]').dataset.value)")).toEqual(40);
  expect(await js("document.querySelectorAll('.primary').length")).toEqual(1);
}, 120000);

test("visual mobile layout and reduced motion need no external assets", async () => {
  fixture.funnel_fixture = true;
  await command("set", "media", "light", "reduced-motion");
  try {
    await command("set", "viewport", "390", "844");
    await command("reload");
    await wait("document.querySelector('[data-step=example]') !== null");
    await click("[data-step=example]");
    await click("[data-example-next]");
    expect(await js("Number(document.querySelector('[data-funnel]').dataset.value)")).toEqual(40);
    expect(await js("document.querySelectorAll('.cohort-dots span').length")).toEqual(100);
    expect(
      await js("document.querySelector('.cohort-dots').getAnimations({subtree:true}).length"),
    ).toEqual(0);
    expect(await js("document.documentElement.scrollWidth > innerWidth")).toBeFalsy();
    expect(
      await js(
        "performance.getEntriesByType('resource').filter(r=>!r.name.startsWith(location.origin)).length",
      ),
    ).toEqual(0);
    await click("[data-example-next]");
    await click(".visual-experiment > summary");
    await wait("document.querySelector('details.visual-experiment').open");
    expect(await js("document.documentElement.scrollWidth > innerWidth")).toBeFalsy();
  } finally {
    await command("set", "media", "light");
  }
}, 120000);

test("lesson comparison is for the answer compared", async () => {
  await lessonAnswer();
  await click("[data-self-check]");
  expect(await js("!!document.querySelector('[data-finish-lesson].primary')")).toBeTruthy();
  await command("fill", "#teach-answer", "A revised explanation should get a fresh check.");
  expect(await js("!!document.querySelector('[data-grade-lesson].primary')")).toBeTruthy();
  expect(await js("!!document.querySelector('[data-finish-lesson].primary')")).toBeFalsy();
}, 120000);

test("grade keeps submitted answer when edited during request", async () => {
  await lessonAnswer();
  pauseGrade();
  await click("[data-grade-lesson]");
  expect(await waitStarted()).toBeTruthy();
  const original = fixture.submitted_answer;
  const revised = "I changed my explanation while the first check was running.";
  await command("fill", "#teach-answer", revised);
  releaseGrade();
  await wait("document.querySelector('.written-feedback') !== null");
  expect(await js("document.querySelector('#teach-answer').value")).toEqual(revised);
  expect(await js("document.querySelector('.notice').textContent")).toContain("previous answer");
  expect(await js("document.querySelector('.flow-footer .primary').textContent")).toContain(
    "Check my revision",
  );
  const stored = await js(
    "JSON.parse(localStorage.getItem('inside-inference-v1')).grades['lesson-map'].answer",
  );
  expect(stored).toEqual(original);
  await click("[data-self-check]");
  expect(
    await js(
      "!!document.querySelector('.written-feedback') && !!document.querySelector('.self-check')",
    ),
  ).toBeTruthy();
}, 120000);

test("grade can finish after navigation without disabling new view", async () => {
  await lessonAnswer();
  pauseGrade();
  await click("[data-grade-lesson]");
  expect(await waitStarted()).toBeTruthy();
  await openRoute("challenges/benchmark-claim");
  await click("[data-review-step=write]");
  expect(await js("document.querySelector('.flow-footer .primary').disabled")).toBeTruthy();
  releaseGrade();
  await wait("document.querySelector('.flow-footer .primary').disabled === false");
  expect(await js("!!document.querySelector('.written-feedback')")).toBeFalsy();
  await openRoute("lesson/map");
  await wait("document.querySelector('.written-feedback') !== null");
  expect(await js("!!document.querySelector('[data-finish-lesson].primary')")).toBeTruthy();
}, 120000);

test("failed grade preserves answer and allows retry", async () => {
  await lessonAnswer();
  fixture.fail_grade = true;
  await click("[data-grade-lesson]");
  await wait("document.querySelector('[role=alert]') !== null");
  expect(await js("document.querySelector('[role=alert]').textContent")).toContain(
    "Deterministic test failure",
  );
  expect(await js("document.querySelector('.flow-footer .primary').disabled")).toBeFalsy();
  fixture.fail_grade = false;
  await click("[data-grade-lesson]");
  await wait("document.querySelector('.written-feedback') !== null");
  expect(await js("!!document.querySelector('[data-finish-lesson].primary')")).toBeTruthy();
}, 120000);

test("mobile review has no horizontal overflow", async () => {
  await command("set", "viewport", "390", "844");
  await openRoute("challenges/stable-softmax");
  for (const step of ["background", "change", "predict", "write"]) {
    await click("[data-review-step=" + step + "]");
    expect(await js("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
    expect(await js("document.querySelectorAll('.primary').length")).toEqual(1);
    expect(
      await js("document.querySelector('.flow-footer').getBoundingClientRect().right"),
    ).toBeLessThanOrEqual(390);
  }
}, 120000);

test("skip link focuses current content without changing lesson", async () => {
  await lessonAnswer();
  await js("document.querySelector('.skip').focus(); true");
  await command("press", "Enter");
  expect(await js("location.hash")).toEqual("#lesson/map");
  expect(await js("document.activeElement.id")).toEqual("main");
  expect(await js("!!document.querySelector('#teach-answer')")).toBeTruthy();
}, 120000);

test("quiz leads to application before explanation", async () => {
  await appliedActivity("map");
  for (const [name, value] of [
    ["weights", "model"],
    ["batch", "engine"],
    ["route", "service"],
  ]) {
    await command("select", "#activity-" + name, value);
  }
  await click("[data-compare-activity]");
  expect(await js("document.querySelector('#activity-result').textContent")).toContain(
    "Check each connection.",
  );
  expect(await js("document.querySelectorAll('.primary').length")).toEqual(1);
  await click(".primary[data-next-explain]");
  expect(await js("!!document.querySelector('#teach-answer')")).toBeTruthy();
  expect(await js("document.querySelector('.activity-notes').textContent")).toContain(
    "The inference engine",
  );
  await click(".flow-footer [data-step=check]");
  expect(await js("!!document.querySelector('#activity-form')")).toBeTruthy();
}, 120000);

test("worksheet saves one prompt at a time and carries notes", async () => {
  await appliedActivity("artifacts");
  for (const [index, text] of [
    "Base R1 exact revision",
    "Adapter A with config",
    "Tokenizer T1 and custom completion format",
    "Prompt IDs [1,4]",
  ].entries()) {
    expect(await js("document.querySelectorAll('textarea').length")).toEqual(1);
    await command("fill", "#activity-answer", text);
    expect(await js("document.querySelectorAll('.primary').length")).toEqual(1);
    if (index < 3) {
      await click(".primary[data-activity-next]");
    }
  }
  await click("[data-compare-activity]");
  expect(await js("document.querySelector('#activity-result').textContent")).toContain(
    "Compare your plan.",
  );
  await command("reload");
  await wait("document.querySelector('#activity-answer') !== null");
  expect(await js("document.querySelector('#activity-answer').value")).toEqual("Prompt IDs [1,4]");
  await appliedActivity("deploy");
  expect(await js("document.querySelector('#activity-content').textContent")).toContain(
    "Base R1 exact revision",
  );
}, 120000);

test("numerical activity and comparison invalidate after edit", async () => {
  await appliedActivity("correctness");
  await command("fill", "#activity-difference", "0.005");
  await command("select", "#activity-accept", "no");
  await click("[data-compare-activity]");
  expect(await js("document.querySelector('#activity-result').textContent")).not.toContain(
    "Revisit this one.",
  );
  await command("fill", "#activity-difference", "0.0005");
  expect(await js("!!document.querySelector('.primary[data-compare-activity]')")).toBeTruthy();
  await click("[data-compare-activity]");
  expect(await js("document.querySelector('#activity-result').textContent")).toContain(
    "Revisit this one.",
  );
}, 120000);

test("workshop requires a prediction then runs the edited read", async () => {
  await appliedActivity("workshop");
  expect(await js("document.querySelector('#cache-start').value")).toEqual("1");
  expect(await js("document.querySelector('.cache-code').checkVisibility()")).toBeTruthy();
  await click(".primary[data-run-cache-lab]");
  expect(await js("document.querySelector('#toast').textContent")).toContain(
    "Choose which positions",
  );
  await click("[name=cache-prediction][value=last]");
  await click(".primary[data-run-cache-lab]");
  await wait("document.querySelector('.cache-lab-result') !== null");
  expect(await js("document.querySelector('.cache-lab-result h2').textContent")).toContain(
    "skipped information",
  );
  expect(
    await js(
      "document.querySelector('.cache-lab-result [data-cache-position=\"0\"]').dataset.included",
    ),
  ).toEqual("false");
  await command("select", "#cache-start", "0");
  expect(
    await js("document.querySelector('[name=cache-prediction]:checked') !== null"),
  ).toBeFalsy();
  expect(await js("document.querySelector('#cache-lab-result').textContent")).toContain(
    "changed after",
  );
  await click("[name=cache-prediction][value=both]");
  await click(".primary[data-run-cache-lab]");
  await wait("document.querySelector('.cache-lab-result h2')?.textContent.includes('repaired')");
  const result = await js(
    "JSON.parse(localStorage.getItem('inside-inference-v1')).activities.workshop.cacheLab",
  );
  expect(result["lastRun"]["matches"]).toBeTruthy();
  expect(result["lastRun"]["start"]).toEqual(0);
  expect(result["firstAttempt"]["start"]).toEqual(1);
  expect(result["firstAttempt"]["matches"]).toBeFalsy();
  await command("reload");
  await wait("document.querySelector('.cache-lab-result') !== null");
  expect(await js("document.querySelector('#cache-start').value")).toEqual("0");
  await click(".primary[data-next-explain]");
  expect(await js("!!document.querySelector('#teach-answer')")).toBeTruthy();
}, 120000);

test("worked example connects positions weights and scores", async () => {
  await openRoute("lesson/workshop");
  await click("[data-next-example]");
  await wait("document.querySelector('#cache-example-result .score-pair') !== null");
  expect(
    await js("document.querySelectorAll('#cache-example-result .cache-entry').length"),
  ).toEqual(1);
  expect(await js("document.querySelector('#cache-example-result').textContent")).toContain(
    "100.0%",
  );
  await click("[data-example-next]");
  expect(
    await js("document.querySelectorAll('#cache-example-result .cache-entry.included').length"),
  ).toEqual(2);
  await click("[data-example-next]");
  expect(
    await js("document.querySelectorAll('#cache-example-result .cache-entry.excluded').length"),
  ).toEqual(1);
  expect(await js("document.querySelector('#cache-example-result').textContent")).toContain(
    "one key and one value",
  );
  const scores = await js(
    "[...document.querySelectorAll('#cache-example-result .score-pair b')].map(x=>x.textContent)",
  );
  expect(scores[0]).not.toEqual(scores[1]);
}, 120000);

test("new workshop keeps prior written predictions", async () => {
  const old = {
    activities: {
      workshop: {
        part: 2,
        values: { "prediction-broken": "My previous written reasoning" },
        runs: { broken: { matches: false } },
      },
    },
  };
  await js(
    "localStorage.setItem('inside-inference-v1', " +
      JSON.stringify(JSON.stringify(old)) +
      "); true",
  );
  await command("reload");
  await wait("document.querySelector('[data-step=learn]') !== null");
  const record = await js(
    "JSON.parse(localStorage.getItem('inside-inference-v1')).activities.workshop",
  );
  expect(record["earlierNotes"]).toContain("My previous written reasoning");
  expect(record["cacheLab"]["start"]).toEqual(1);
  expect(record).not.toHaveProperty("runs");
}, 120000);

test("full reference checks run inline and survive reload", async () => {
  await openRoute("lesson/workshop");
  expect(await js("document.querySelector('.prose').textContent")).not.toContain("open a terminal");
  await click("[data-engine-tools] > summary");
  await click("[data-run-reference-checks]");
  await wait("document.querySelector('[data-reference-result]') !== null");
  expect(await js("location.hash")).toEqual("#lesson/workshop");
  expect(await js("document.querySelector('.stepper [aria-current]').textContent")).toContain(
    "Learn",
  );
  expect(await js("document.querySelectorAll('[data-reference-result] tbody tr').length")).toEqual(
    5,
  );
  expect(await js("document.querySelector('[data-reference-result]').textContent")).toContain(
    "218 checks passed",
  );
  await command("reload");
  await wait("document.querySelector('[data-reference-result]') !== null");
  expect(await js("document.querySelectorAll('.primary').length")).toEqual(1);
}, 120000);

test("code is visible before controls and full function is optional", async () => {
  await openRoute("lesson/workshop");
  expect(await js("document.querySelector('.cache-code').checkVisibility()")).toBeTruthy();
  expect(
    await js("document.querySelector('.cache-code').getBoundingClientRect().top"),
  ).toBeLessThan(700);
  expect(
    await js("document.querySelector('[data-reference-checks-panel]').checkVisibility()"),
  ).toBeFalsy();
  expect(await js("document.querySelector('.cache-code').textContent")).toContain(
    "cache.keys[start:]",
  );
  await click("[data-engine-tools] > summary");
  await wait("document.querySelector('[data-engine-code] pre') !== null");
  await command("select", "#engine-function", "cached_step");
  expect(await js("document.querySelector('[data-engine-code] pre').textContent")).toContain(
    "broken_offset",
  );
  expect(
    await js(
      "getComputedStyle(document.querySelector('[data-engine-code] pre code')).backgroundColor",
    ),
  ).toEqual("rgba(0, 0, 0, 0)");
  await command("set", "viewport", "390", "844");
  expect(await js("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
}, 120000);

test("failed inline run is distinct from saved success", async () => {
  await openRoute("lesson/workshop");
  await click("[data-engine-tools] > summary");
  await click("[data-run-reference-checks]");
  await wait("document.querySelector('[data-reference-result]') !== null");
  fixture.fail_workshop = true;
  await click("[data-run-reference-checks]");
  await wait("document.querySelector('[data-reference-checks-panel] [role=alert]') !== null");
  const message = await js(
    "document.querySelector('[data-reference-checks-panel] [role=alert]').textContent",
  );
  expect(message).toContain("earlier attempt");
  expect(message).toContain("did not pass");
  expect(await js("document.querySelector('[data-run-reference-checks]').disabled")).toBeFalsy();
}, 120000);

test("retired page is removed and final lesson returns to own activity", async () => {
  expect(await js("!!document.querySelector('a[href=\"#capstone\"]')")).toBeFalsy();
  await command("open", origin + "/#capstone");
  await wait("location.hash === '#home'");
  await openRoute("lesson/bench");
  await lessonAnswer();
  await click("[data-self-check]");
  await click(".primary[data-finish-lesson]");
  await click(".primary[data-open-activity]");
  expect(await js("location.hash")).toEqual("#lesson/bench");
  expect(await js("!!document.querySelector('#activity-answer')")).toBeTruthy();
}, 120000);

test("previous project notes migrate without losing other answers", async () => {
  const old = {
    version: 3,
    notes: { "project-brief": "Earlier experiment notes", "teach-map": "Existing lesson answer" },
    answers: { map1: { choice: 1, checked: true } },
    capstone: { "0": true },
  };
  await js(
    "localStorage.setItem('inside-inference-v1', " +
      JSON.stringify(JSON.stringify(old)) +
      "); true",
  );
  await command("reload");
  await wait("document.querySelector('[data-step=explain]') !== null");
  const state = await js("JSON.parse(localStorage.getItem('inside-inference-v1'))");
  expect(state["activities"]["bench"]["earlierNotes"]).toEqual("Earlier experiment notes");
  expect(state["notes"]["teach-map"]).toEqual("Existing lesson answer");
  expect(state["answers"]["map1"]["checked"]).toBeTruthy();
  expect(state["notes"]).not.toHaveProperty("project-brief");
  expect(state).not.toHaveProperty("capstone");
}, 120000);

test("applied activities fit mobile one prompt at a time", async () => {
  await command("set", "viewport", "390", "844");
  for (const lesson of sample.course["LESSONS"]) {
    if (!lesson["activity"]) {
      continue;
    }
    await appliedActivity(lesson["id"]);
    expect(await js("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
    expect(await js("document.querySelectorAll('.primary').length")).toEqual(1);
    expect(await js("document.querySelectorAll('textarea').length")).toBeLessThanOrEqual(1);
  }
}, 120000);

test("course overview rows use the full content width and fit a phone", async () => {
  await command("open", origin + "/#home");
  await wait('!!document.querySelector("[data-course-outline]")');
  expect(
    await js('document.querySelector("[data-course-outline]").getBoundingClientRect().width'),
  ).toBeGreaterThan(600);
  expect(
    await js('document.querySelector("[data-course-lesson]").getBoundingClientRect().width'),
  ).toBeGreaterThan(500);
  await command("set", "viewport", "390", "844");
  expect(await js("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  await click("[data-course-continue]");
  await wait('document.querySelectorAll(".reading-topic").length>1');
  expect(await js("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  expect(await js('document.querySelectorAll("form[data-q]").length')).toBe(0);
}, 30000);

test("reading is uninterrupted and grouped quiz saves drafts before checking together", async () => {
  await command("open", origin + "/#home");
  await wait('!!document.querySelector("[data-course-continue]")');
  await click("[data-course-continue]");
  const topics = await js(
    '[...document.querySelectorAll("[data-read-topic]")].map(x=>x.dataset.readTopic)',
  );
  expect(topics.length).toBeGreaterThanOrEqual(3);
  expect(await js('document.querySelectorAll(".block-worked-example").length')).toBe(topics.length);
  expect(await js('document.querySelectorAll("form[data-q]").length')).toBe(0);
  expect(await js('document.querySelector(".reading-block-header").textContent')).toContain(
    "minutes",
  );
  await click("[data-finish-reading]");
  await wait('!!document.querySelector("[data-check-block]")');
  expect(await js('document.querySelectorAll("form[data-q]").length')).toBe(topics.length);
  expect(await js('document.querySelectorAll("form[data-q] button[type=submit]").length')).toBe(0);
  await click("[data-check-block]");
  expect(await js('document.querySelectorAll(".answer-feedback").length')).toBe(0);
  for (const id of topics) {
    const l = sample.course.LESSONS.find((l) => l.id === id)!;
    await click(
      'form[data-q="' + l.questions[0].id + '"] input[value="' + l.questions[0].correct + '"]',
    );
  }
  await command("reload");
  await wait('!!document.querySelector("[data-check-block]")');
  expect(await js('document.querySelectorAll("form[data-q] input:checked").length')).toBe(
    topics.length,
  );
  await click("[data-check-block]");
  expect(await js('document.querySelectorAll(".answer-feedback").length')).toBe(topics.length);
  await click("[data-block-explain]");
  await command("fill", "#teach-answer", "I can explain this using the example and what changes.");
  await click("[data-self-check]");
  expect(await js('!!document.querySelector("[data-finish-block]")')).toBe(true);
  await command("fill", "#teach-answer", "I edited this after the comparison.");
  expect(await js('!!document.querySelector("[data-finish-block]")')).toBe(false);
  await click("[data-self-check]");
  await click("[data-finish-block]");
  expect(await js('document.querySelector("h1").textContent')).toBe("Block finished.");
  const stored = await js('JSON.parse(localStorage.getItem("inside-inference-v1"))');
  expect(Object.keys(stored.read)).toHaveLength(topics.length);
  expect(Object.keys(stored.completed)).toHaveLength(topics.length);
}, 45000);

test("dashboard shows per-course progress and resumes the saved block", async () => {
  const { InboxStore } = await import("../src/inbox-store");
  const data = mkdtempSync(join(tmpdir(), "noema-dashboard-")),
    store = new InboxStore(data),
    inboxServer = makeServer({ course: sample.path, port: 0, inbox: store });
  const url = "http://127.0.0.1:" + inboxServer.port;
  try {
    await command("open", url + "/learn/deepinfer/#home");
    await wait('!!document.querySelector("[data-course-continue]")');
    await js("localStorage.clear();true");
    await command("reload");
    await wait('!!document.querySelector("[data-course-continue]")');
    await click("[data-course-continue]");
    await click("[data-finish-reading]");
    const read = await js(
      'Object.keys(JSON.parse(localStorage.getItem("inside-inference-v1")).read).length',
    );
    await command("open", url + "/#learning");
    await wait(
      'document.querySelector("[data-learning-card]")?.textContent.includes("topics read")',
    );
    expect(await js('document.querySelector("[data-learning-card]").textContent')).toContain(
      read + " of 18 topics read · 0 questions answered",
    );
    expect(await js('document.querySelector(".sample-row").getAttribute("href")')).toContain(
      "/practice",
    );
    await command("set", "viewport", "390", "844");
    expect(await js("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
    await click(".sample-row");
    await wait('!!document.querySelector("[data-check-block]")');
    expect(await js('document.querySelectorAll("form[data-q]").length')).toBe(read);
    await command("open", url + "/#inbox");
    await wait('!!document.querySelector("#links")');
    await command("fill", "#links", "https://example.org/a\nhttps://example.org/b");
    await click("#add-button");
    await wait('document.querySelectorAll(".item-row").length===2');
    expect(store.list()).toHaveLength(2);
  } finally {
    await inboxServer.stop(true);
    store.close();
    rmSync(data, { recursive: true, force: true });
  }
}, 35000);

test("revised workshop preserves the answer while invalidating old checks and feedback", async () => {
  const task = sample.assessments["lesson-workshop"];
  const old = {
    notes: { "teach-workshop": "My earlier explanation" },
    answers: { work1: { choice: 1, checked: true } },
    grades: {
      "lesson-workshop": {
        answer: "My earlier explanation",
        meta: {
          content_revision: sample.course.CONTENT_REVISION,
          exercise_revision: sample.course.CONTENT_REVISION,
        },
        grade: {
          summary: "Older feedback",
          follow_up: "Older question",
          criteria: task.criteria.map((c) => ({
            id: c.id,
            verdict: "missing",
            evidence: "",
            feedback: "Older feedback",
          })),
        },
      },
    },
  };
  await js(
    'localStorage.setItem("inside-inference-v1",' + JSON.stringify(JSON.stringify(old)) + ");true",
  );
  await command("reload");
  await wait('!!document.querySelector("[data-step=learn]")');
  await command("open", origin + "/#lesson/workshop/check");
  await wait('!!document.querySelector(".primary[data-submit-check]")');
  await command("open", origin + "/#lesson/workshop/explain");
  await wait('!!document.querySelector("#teach-answer")');
  expect(await js('document.querySelector(".written-feedback").textContent')).toContain(
    "earlier version",
  );
  expect(await js('document.querySelector("#teach-answer").value')).toBe("My earlier explanation");
}, 20000);

test("multiple cohort experiments keep independent labels, inputs and calculations", async () => {
  fixture.funnel_fixture = true;
  fixture.two_funnels = true;
  await command("open", origin + "/#home");
  await command("reload");
  await wait('!!document.querySelector("[data-course-continue]")');
  await click("[data-course-continue]");
  expect(await js('document.querySelectorAll("[data-visual-rate]").length')).toBe(2);
  expect(
    await js('new Set([...document.querySelectorAll("[data-visual-rate]")].map(i=>i.id)).size'),
  ).toBe(2);
  await click('[data-funnel="numbers"] .visual-experiment > summary');
  await command("focus", '[data-visual-rate="numbers"]');
  await command("press", "ArrowRight");
  await wait(
    'document.querySelector("[data-funnel=numbers] [data-visual-rate-label]").textContent === "50.5%"',
  );
  expect(
    await js(
      'document.querySelector("[data-funnel=numbers] [data-visual-rate-label]").textContent',
    ),
  ).toBe("50.5%");
  expect(
    await js('document.querySelector("[data-funnel=map] [data-visual-rate-label]").textContent'),
  ).toBe("50%");
  expect(await js('document.querySelector("[data-funnel=numbers]").dataset.value')).toBe("30");
}, 20000);

test("course typography stays readable and wraps at narrow phone widths", async () => {
  for (const width of [1280, 390, 320]) {
    await command("set", "viewport", String(width), "900");
    await command("open", origin + "/#home");
    await wait('!!document.querySelector("[data-course-outline]")');
    const overview = await js(
      '({root:parseFloat(getComputedStyle(document.documentElement).fontSize),title:parseFloat(getComputedStyle(document.querySelector("[data-course-lesson] > span:nth-child(2) > span")).fontSize),overflow:document.documentElement.scrollWidth>innerWidth,pills:document.querySelectorAll("[data-course-home] [data-slot=badge]").length})',
    );
    expect(overview.root).toBe(16);
    expect(overview.title).toBeGreaterThanOrEqual(16);
    expect(overview.overflow).toBe(false);
    expect(overview.pills).toBe(0);
    await click("[data-course-continue]");
    await wait('!!document.querySelector(".reading-topic .prose")');
    expect(
      await js(
        'parseFloat(getComputedStyle(document.querySelector(".reading-topic .prose")).fontSize)',
      ),
    ).toBeGreaterThanOrEqual(18);
    expect(await js("document.documentElement.scrollWidth>innerWidth")).toBe(false);
    expect(await js('document.querySelectorAll(".eyebrow").length')).toBe(0);
  }
}, 40000);

test("dashboard metadata and capture controls stay readable on desktop and phones", async () => {
  const { InboxStore } = await import("../src/inbox-store");
  const data = mkdtempSync(join(tmpdir(), "noema-readable-")),
    store = new InboxStore(data),
    inboxServer = makeServer({ course: sample.path, port: 0, inbox: store }),
    url = "http://127.0.0.1:" + inboxServer.port;
  try {
    for (const width of [1280, 390, 320]) {
      await command("set", "viewport", String(width), "900");
      await command("open", url + "/#learning");
      await wait(
        'document.querySelector("[data-learning-card]")?.textContent.includes("topics read")',
      );
      const sizes = await js(
        '({title:parseFloat(getComputedStyle(document.querySelector("[data-learning-card] h3")).fontSize),metadata:parseFloat(getComputedStyle(document.querySelector("[data-learning-card] a > div")).fontSize),nav:parseFloat(getComputedStyle(document.querySelector(".nav-item")).fontSize),overflow:document.documentElement.scrollWidth>innerWidth})',
      );
      expect(sizes.title).toBeGreaterThanOrEqual(20);
      expect(sizes.metadata).toBeGreaterThanOrEqual(14);
      expect(sizes.nav).toBeGreaterThanOrEqual(16);
      expect(sizes.overflow).toBe(false);
      await command("open", url + "/#inbox");
      await wait('document.querySelector("#capture").checkVisibility()');
      expect(
        await js('parseFloat(getComputedStyle(document.querySelector("#links")).fontSize)'),
      ).toBeGreaterThanOrEqual(16);
      expect(await js("document.documentElement.scrollWidth>innerWidth")).toBe(false);
    }
  } finally {
    await inboxServer.stop(true);
    store.close();
    rmSync(data, { recursive: true, force: true });
  }
}, 40000);
// Clear saved progress and reload, so no in-memory state from an earlier test is saved back.
async function resetProgress() {
  await command("open", origin + "/#home");
  await js(`localStorage.removeItem(META.progress_key || "noema:" + META.id); true`);
  await command("open", origin + "/?fresh=" + Date.now() + "#home");
  await wait("document.querySelector('[data-course-outline]') !== null");
}
test("switching the course level or following a stale block link never blanks the page", async () => {
  await resetProgress();
  const first = await js(
    "NoemaProgress.blocks(NoemaProgress.path(LESSONS, {}), META.reading_block_size)[0]",
  );
  const topic = first.lessons[0].id;
  await command("open", origin + "/#block/" + first.id + "/read/" + topic);
  await wait("document.querySelector('[data-track=\"2\"]') !== null");
  await click('[data-track="2"]');
  await wait(
    "document.querySelector('[data-track=\"2\"]').getAttribute('aria-pressed') === 'true'",
  );
  await wait(`document.getElementById('read-${topic}') !== null`);
  expect(await js("location.hash")).toContain("/read/" + topic);
  // A block id that no longer exists follows its topic; an unknown lesson goes home.
  await command("open", origin + "/#block/block-gone/read/" + topic);
  await wait(`document.getElementById('read-${topic}') !== null`);
  expect(
    await js(
      "NoemaProgress.blocks(NoemaProgress.path(LESSONS, JSON.parse(localStorage.getItem(META.progress_key || 'noema:' + META.id))), META.reading_block_size).some((b) => b.id === location.hash.split('/')[1])",
    ),
  ).toBe(true);
  await command("open", origin + "/#lesson/not-a-topic");
  await wait("document.querySelector('[data-course-outline]') !== null");
  expect(await js("location.hash")).toBe("#home");
});
test("switching level keeps the reader at the same place in the same topic", async () => {
  await resetProgress();
  const first = await js(
    "NoemaProgress.blocks(NoemaProgress.path(LESSONS, {}), META.reading_block_size)[0]",
  );
  const second = first.lessons[1].id;
  await command("open", origin + "/#block/" + first.id + "/read/" + first.lessons[0].id);
  await wait(`document.getElementById('read-${second}') !== null`);
  await js(`document.querySelector('#read-${second} h2').scrollIntoView({block: 'center'}); true`);
  await Bun.sleep(100);
  const before = await js(`document.getElementById('read-${second}').getBoundingClientRect().top`);
  await command("click", '[data-track="2"]');
  await wait(
    "document.querySelector('[data-track=\"2\"]').getAttribute('aria-pressed') === 'true'",
  );
  await Bun.sleep(400);
  const after = await js(`document.getElementById('read-${second}').getBoundingClientRect().top`);
  expect(Math.abs(after - before)).toBeLessThan(4);
  expect(await js("location.hash")).toContain("/read/" + second);
  // Each pass keeps its own reading progress.
  expect(
    await js(
      `NoemaProgress.snapshot({META, LESSONS}, JSON.parse(localStorage.getItem(META.progress_key || 'noema:' + META.id))).level`,
    ),
  ).toBe(2);
});
test("an example shows only at its own level, and the lesson skips the example step elsewhere", async () => {
  await resetProgress();
  const l = sample.course.LESSONS.find(
    (x) => x.example && !x.activity && x.levels[1] && x.levels[2],
  )!;
  await openRoute("lesson/" + l.id);
  expect(
    await js(
      "[...document.querySelectorAll('.stepper button')].map((b) => b.textContent).join('|')",
    ),
  ).toContain("See an example");
  await click('[data-track="2"]');
  await wait("!document.querySelector('.stepper').textContent.includes('See an example')");
  expect(await js("document.querySelector('.flow-footer .primary')?.textContent")).toContain(
    "try one question",
  );
  await click('[data-track="1"]');
});
test("reaching the end of a topic marks it read with a visible check", async () => {
  const first = await js(
    "NoemaProgress.blocks(NoemaProgress.path(LESSONS, {}), META.reading_block_size)[0]",
  );
  const topic = first.lessons[0].id;
  await command("open", origin + "/#block/" + first.id + "/read/" + topic);
  await wait(`document.querySelector('[data-read-end="${topic}"]') !== null`);
  expect(
    await js(
      `!!JSON.parse(localStorage.getItem(META.progress_key || "noema:" + META.id) || "{}").read?.["${topic}"]`,
    ),
  ).toBe(false);
  await js(
    `document.querySelector('[data-read-end="${topic}"]').scrollIntoView({block: 'center'}); true`,
  );
  await wait(`document.querySelector('[data-read-jump="${topic}"]').classList.contains('is-read')`);
  expect(
    await js(
      `!!JSON.parse(localStorage.getItem(META.progress_key || "noema:" + META.id)).read["${topic}"]`,
    ),
  ).toBe(true);
});
