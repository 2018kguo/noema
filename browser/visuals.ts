import type { Lesson } from "../src/course";
import { bindingFraction, scheduleTimes, screenCounts } from "../src/visual-models";
type Visual = NonNullable<Lesson["visual"]>;
type Funnel = Extract<Visual, { kind: "funnel" }>;
/* Structured teaching visuals. Source content never supplies executable code. */

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const number = (value: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
const overrides = new Map<string, { rate: number }>();
const previous = new Map<string, number>();
const modelValues = new Map<string, number>();
const entries = (lessons: Lesson[]) =>
  lessons.flatMap((l) => [
    ...(l.visual ? [{ id: l.id, visual: l.visual }] : []),
    ...(l.illustrations || []).map((i) => ({ id: l.id + "--" + i.id, visual: i.visual })),
  ]);
const find = (lessons: Lesson[], id: string) => entries(lessons).find((v) => v.id === id);

function bindingPlot(v: Extract<Visual, { kind: "binding" }>, concentration: number) {
  const points = Array.from({ length: 101 }, (_, i) => {
    const x = (v.max_nm * i) / 100;
    return `${i ? "L" : "M"}${i * 6},${200 - 200 * bindingFraction(v.kd_nm, x)}`;
  }).join(" ");
  return `<div class="binding-chart"><p>Occupied binding sites · 0–100%</p><svg viewBox="0 0 600 210" role="img" aria-label="Binding occupancy rises toward saturation as free ligand increases"><path d="M0 100H600 M0 200H600" class="plot-grid"/><path d="${points}" class="binding-curve"/><path d="M${(600 * concentration) / v.max_nm} 200V${200 - 200 * bindingFraction(v.kd_nm, concentration)}H0" class="plot-guide"/><circle cx="${(600 * concentration) / v.max_nm}" cy="${200 - 200 * bindingFraction(v.kd_nm, concentration)}" r="6" class="plot-point"/></svg><div class="plot-axis"><span>0 nM</span><span>Free ligand concentration</span><span>${number(v.max_nm)} nM</span></div></div>`;
}

function modelResult(v: Visual, value: number) {
  if (v.kind === "binding") {
    const baseline = bindingFraction(v.kd_nm, v.ligand_nm),
      current = bindingFraction(v.kd_nm, value);
    return `${bindingPlot(v, value)}<table class="model-comparison"><caption>Original example and your change · Kd stays ${number(v.kd_nm)} nM</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Original</th><th scope="col">Now</th></tr></thead><tbody><tr><th scope="row">Free ligand</th><td>${number(v.ligand_nm)} nM</td><td>${number(value)} nM</td></tr><tr><th scope="row">Sites occupied</th><td>${number(baseline * 100)}%</td><td>${number(current * 100)}%</td></tr></tbody></table><p class="model-readout" role="status">${number(value)} ÷ (${number(v.kd_nm)} + ${number(value)}) = ${number(current * 100)}% occupied. ${value === v.kd_nm ? "At Kd, half the sites are occupied." : "The concentration changes occupancy; Kd stays fixed."}</p>`;
  }
  if (v.kind === "screen") {
    const original = screenCounts(v.population, v.prevalence, v.sensitivity, v.false_positive_rate),
      now = screenCounts(v.population, v.prevalence, v.sensitivity, value),
      percent = (n: number | null) => (n === null ? "No flags" : number(n * 100) + "%");
    return `<div class="screen-counts"><div><h3>Would meet the later criterion</h3><p>${number(now.positive)} of ${number(v.population)} candidates</p><div class="count-pair"><span><b>${number(now.truePositive)}</b> flagged</span><span><b>${number(now.falseNegative)}</b> missed</span></div></div><div><h3>Would fail the later criterion</h3><p>${number(now.negative)} of ${number(v.population)} candidates</p><div class="count-pair"><span><b>${number(now.falsePositive)}</b> false alarms</span><span><b>${number(now.trueNegative)}</b> rejected</span></div></div></div><div class="flagged-mixture" aria-hidden="true"><span style="width:${(now.precision || 0) * 100}%"></span></div><p class="mixture-key"><span>True flags: ${number(now.truePositive)}</span><span>False alarms: ${number(now.falsePositive)}</span></p><table class="model-comparison"><caption>Original example and your change</caption><thead><tr><th scope="col">Flagged candidates</th><th scope="col">Original</th><th scope="col">Now</th></tr></thead><tbody><tr><th scope="row">True flags</th><td>${number(original.truePositive)}</td><td>${number(now.truePositive)}</td></tr><tr><th scope="row">False alarms</th><td>${number(original.falsePositive)}</td><td>${number(now.falsePositive)}</td></tr><tr><th scope="row">Share truly good (PPV)</th><td>${percent(original.precision)}</td><td>${percent(now.precision)}</td></tr></tbody></table><p class="model-readout" role="status">${now.flagged ? `${number(now.truePositive)} of ${number(now.flagged)} flags would meet the later criterion: ${percent(now.precision)}.` : "No candidates are flagged, so the share of flags that are truly good is undefined."} The base rate and true positive rate stay fixed.</p>`;
  }
  if (v.kind === "schedule") {
    const plan = (d: number) =>
        scheduleTimes(v.tasks.map((t) => (t.id === v.adjustable_task ? { ...t, duration: d } : t))),
      original = plan(v.tasks.find((t) => t.id === v.adjustable_task)!.duration),
      now = plan(value),
      span = Math.max(original.finish, now.finish, 1),
      moved = now.finish - original.finish;
    // ponytail: one row per task, bars scaled to the longer of the two plans.
    return `<ol class="schedule-chart">${v.tasks
      .map((t) => {
        const time = now.times.get(t.id)!;
        return `<li class="${now.critical.has(t.id) ? "critical" : ""} ${t.id === v.adjustable_task ? "adjusted" : ""}"><span>${escape(t.label)}</span><span class="schedule-track"><i style="left:${(100 * time.start) / span}%;width:${Math.max(0.5, (100 * (time.end - time.start)) / span)}%"></i></span><b>wk ${number(time.start)}–${number(time.end)}</b></li>`;
      })
      .join(
        "",
      )}</ol><p class="schedule-key">Dark bars are the critical path: a delay there moves the finish.</p><table class="model-comparison"><caption>Original plan and your change</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Original</th><th scope="col">Now</th></tr></thead><tbody><tr><th scope="row">Adjusted task</th><td>${number(v.tasks.find((t) => t.id === v.adjustable_task)!.duration)} weeks</td><td>${number(value)} weeks</td></tr><tr><th scope="row">Finish</th><td>week ${number(original.finish)}</td><td>week ${number(now.finish)}</td></tr></tbody></table><p class="model-readout" role="status">${moved > 0 ? `The finish moves ${number(moved)} week${moved === 1 ? "" : "s"} later. The adjusted task is now on the critical path.` : moved < 0 ? `The finish moves ${number(-moved)} week${moved === -1 ? "" : "s"} earlier.` : now.critical.has(v.adjustable_task) ? "The finish holds, but this task now has no slack left." : "The finish holds. The parallel branch still takes longer, so this task has slack."}</p>`;
  }
  return "";
}

type Explorable = Extract<Visual, { kind: "binding" | "screen" | "schedule" }>;
const control = (v: Explorable) =>
  v.kind === "binding"
    ? {
        label: "Free ligand concentration",
        unit: " nM",
        initial: v.ligand_nm,
        max: v.max_nm,
        step: v.max_nm / 200,
        scale: 1,
      }
    : v.kind === "screen"
      ? {
          label: "False positive rate",
          unit: "%",
          initial: v.false_positive_rate,
          max: 100,
          step: 0.5,
          scale: 100,
        }
      : {
          label: v.tasks.find((t) => t.id === v.adjustable_task)!.label + " duration",
          unit: " weeks",
          initial: v.tasks.find((t) => t.id === v.adjustable_task)!.duration,
          max: v.max_duration,
          step: 1,
          scale: 1,
        };

function interactive(v: Explorable, id: string) {
  const c = control(v),
    value = modelValues.get(id) ?? c.initial;
  return `<div data-explorable="${escape(id)}"><p class="model-prediction">${escape(v.predict)}</p><label for="model-${escape(id)}">${escape(c.label)}: <output data-model-value>${number(value * c.scale)}${c.unit}</output></label><input id="model-${escape(id)}" data-model-control type="range" min="0" max="${c.max}" step="${c.step}" value="${value * c.scale}"><div data-model-result>${modelResult(v, value)}</div><button type="button" class="text-button" data-model-reset>Restore the original example</button></div>`;
}

function funnelCounts(initial: number, rates: number[]) {
  if (
    !Number.isFinite(initial) ||
    initial <= 0 ||
    !rates.length ||
    rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1)
  ) {
    throw new Error("A funnel needs a positive starting count and rates from 0 to 1.");
  }
  return rates.reduce((counts, rate) => [...counts, counts[counts.length - 1] * rate], [initial]);
}

function funnel(visual: Funnel, part: number, id: string) {
  const custom = overrides.get(id);
  const rates = visual.stages.map((stage) => stage.rate);
  const counts = funnelCounts(visual.initial, rates);
  const reached = Math.min(part + 1, visual.stages.length);
  const active = counts[reached],
    before = counts[reached - 1];
  const share = active / visual.initial;
  const stage = visual.stages[reached - 1];
  const countLabel = `${number(active)} ${visual.unit}`;
  return `<div data-funnel="${escape(id)}" data-share="${share}" data-value="${active}">
      <div class="cohort-layout"><div class="cohort-picture"><div class="cohort-head"><div><span class="cohort-stage">${escape(stage.label)}</span><strong>${number(active)}<small> / ${number(visual.initial)}</small></strong></div><span class="visual-unit">${escape(visual.unit)}<br>from the starting group</span></div>
      <div class="cohort-dots" aria-hidden="true">${Array.from({ length: 100 }, (_, i) => `<span><i style="width:${Math.max(0, Math.min(1, share * 100 - i)) * 100}%"></i></span>`).join("")}</div>
      <p class="cohort-key">100 dots represent the starting ${number(visual.initial)} ${escape(visual.unit)}. A partial dot shows an expected fraction.</p>
      </div><div><ol class="funnel-stages">
        <li><span>${escape(visual.start_label)}</span><b>${number(counts[0])}</b><span class="funnel-track"><i style="width:100%"></i></span></li>
        ${visual.stages.map((s, i) => `<li class="${i === reached - 1 ? "current" : i >= reached ? "upcoming" : ""}" ${i === reached - 1 ? 'aria-current="step"' : ""}><span>${escape(s.label)}</span><b>${i < reached ? number(counts[i + 1]) : "…"}</b><span class="funnel-track"><i style="width:${i < reached ? (counts[i + 1] / visual.initial) * 100 : 0}%"></i></span></li>`).join("")}
      </ol>
      <div class="visual-equation" role="status" aria-live="polite"><span>${number(before)} entering this gate × ${number(rates[reached - 1] * 100)}%</span><strong>= ${countLabel}</strong><p>The ${number(rates[reached - 1] * 100)}% applies to the ${number(before)} still here.</p></div></div></div>
      ${reached === visual.stages.length ? `<details class="visual-experiment"><summary>What if one rate changes?</summary><div class="visual-experiment-body"><p>Keep the starting group and the other rates fixed. Predict which counts will change, then move the slider.</p><label for="visual-rate-${escape(id)}">${escape(visual.stages[visual.adjustable_stage].label)}: <output data-visual-rate-label>${number((custom ? custom.rate : rates[visual.adjustable_stage]) * 100)}%</output></label><input id="visual-rate-${escape(id)}" data-visual-rate="${escape(id)}" type="range" min="0" max="100" step="0.5" value="${(custom ? custom.rate : rates[visual.adjustable_stage]) * 100}"><div data-visual-experiment-result></div><button class="text-button" data-visual-reset="${escape(id)}" type="button">Restore the example’s rates</button></div></details>` : ""}
    </div>`;
}

function render(visual: Visual | null | undefined, part: number, id: string) {
  if (!visual) return "";
  const body =
    visual.kind === "binding" || visual.kind === "screen" || visual.kind === "schedule"
      ? interactive(visual, id)
      : visual.kind === "funnel"
        ? funnel(visual, part, id)
        : `<ol class="concept-flow">${visual.nodes.map((node) => `<li class="${node.step === part ? "current" : node.step > part ? "upcoming" : ""}" ${node.step === part ? 'aria-current="step"' : ""}><span class="flow-node-number">${node.step + 1}</span><div><b>${escape(node.label)}</b><p>${escape(node.detail)}</p></div></li>`).join("")}</ol>`;
  return `<figure class="teaching-visual" data-visual="${escape(id)}"><figcaption><h2>${escape(visual.title)}</h2></figcaption>${body}<p class="visual-caption">${escape(visual.caption)}</p></figure>`;
}

function updateExperiment(lesson: Pick<Lesson, "id" | "visual"> | undefined, rate: number) {
  const visual = lesson?.visual;
  if (!lesson || visual?.kind !== "funnel") return;
  overrides.set(lesson.id, { rate });
  const rates = visual.stages.map((s, i) => (i === visual.adjustable_stage ? rate : s.rate));
  const baseline = funnelCounts(
    visual.initial,
    visual.stages.map((s) => s.rate),
  );
  const counts = funnelCounts(visual.initial, rates);
  const host = [...document.querySelectorAll<HTMLElement>("[data-funnel]")].find(
    (host) => host.dataset.funnel === lesson.id,
  );
  const box = host?.querySelector("[data-visual-experiment-result]");
  if (!box || !host) return;
  const label = host.querySelector("[data-visual-rate-label]");
  if (label) label.textContent = number(rate * 100) + "%";
  box.innerHTML = `<table><caption>Original example → your changed rate</caption><thead><tr><th>Stage</th><th>Original</th><th>Changed</th></tr></thead><tbody>${visual.stages.map((s, i) => `<tr><th scope="row">${escape(s.label)}</th><td>${number(baseline[i + 1])}</td><td>${number(counts[i + 1])}</td></tr>`).join("")}</tbody></table><p role="status">${number(counts[visual.adjustable_stage])} enter the changed gate. ${number(rate * 100)}% of that group continue. Earlier counts stay the same; this gate and later counts are recalculated.</p>`;
}

function mount(lessons: Lesson[]) {
  document.querySelectorAll<HTMLElement>("[data-explorable]").forEach((host) => {
    const id = host.dataset.explorable!,
      entry = find(lessons, id),
      visual = entry?.visual;
    if (
      !visual ||
      (visual.kind !== "binding" && visual.kind !== "screen" && visual.kind !== "schedule")
    )
      return;
    const c = control(visual);
    const input = host.querySelector<HTMLInputElement>("[data-model-control]")!,
      output = host.querySelector<HTMLOutputElement>("[data-model-value]")!,
      result = host.querySelector<HTMLElement>("[data-model-result]")!,
      reset = host.querySelector<HTMLButtonElement>("[data-model-reset]")!;
    const update = () => {
      const value = Number(input.value) / c.scale;
      modelValues.set(id, value);
      output.textContent = number(Number(input.value)) + c.unit;
      result.innerHTML = modelResult(visual, value);
    };
    input.oninput = update;
    reset.onclick = () => {
      input.value = String(c.initial * c.scale);
      update();
    };
  });
  document.querySelectorAll<HTMLElement>("[data-funnel]").forEach((host) => {
    const id = host.dataset.funnel!,
      share = Number(host.dataset.share);
    const old = previous.get(id);
    if (
      old !== undefined &&
      old !== share &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      host.querySelectorAll(".cohort-dots span").forEach((dot, i) => {
        const from = Math.max(0, Math.min(1, old * 100 - i));
        const to = Math.max(0, Math.min(1, share * 100 - i));
        if (from !== to)
          dot.firstElementChild?.animate([{ width: from * 100 + "%" }, { width: to * 100 + "%" }], {
            duration: 240,
            easing: "ease-out",
          });
      });
    }
    previous.set(id, share);
    const slider = host.querySelector<HTMLInputElement>("[data-visual-rate]");
    const lesson = find(lessons, id);
    if (slider && lesson) updateExperiment(lesson, Number(slider.value) / 100);
  });
}

const api = { render, mount, find, updateExperiment, funnelCounts };
export const visuals = api;
declare global {
  interface Window {
    NoemaVisuals: typeof visuals;
  }
}
if (typeof window !== "undefined") window.NoemaVisuals = visuals;
