/* Structured teaching visuals. Source content never supplies executable code. */
(function(root) {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => new Intl.NumberFormat('en', {maximumFractionDigits: 1}).format(value);
  const overrides = new Map();
  const previous = new Map();

  function funnelCounts(initial, rates) {
    if (!Number.isFinite(initial) || initial <= 0 || !rates.length ||
        rates.some(rate => !Number.isFinite(rate) || rate < 0 || rate > 1)) {
      throw new Error('A funnel needs a positive starting count and rates from 0 to 1.');
    }
    return rates.reduce((counts, rate) => [...counts, counts[counts.length - 1] * rate], [initial]);
  }

  function funnel(visual, part, id) {
    const custom = overrides.get(id);
    const rates = visual.stages.map(stage => stage.rate);
    const counts = funnelCounts(visual.initial, rates);
    const reached = Math.min(part + 1, visual.stages.length);
    const active = counts[reached], before = counts[reached - 1];
    const share = active / visual.initial;
    const stage = visual.stages[reached - 1];
    const countLabel = `${number(active)} ${visual.unit}`;
    return `<div data-funnel="${escape(id)}" data-share="${share}" data-value="${active}">
      <div class="cohort-layout"><div class="cohort-picture"><div class="cohort-head"><div><span class="visual-label">${escape(stage.label)}</span><strong>${number(active)}<small> / ${number(visual.initial)}</small></strong></div><span class="visual-unit">${escape(visual.unit)}<br>from the starting group</span></div>
      <div class="cohort-dots" aria-hidden="true">${Array.from({length:100}, (_, i) => `<span><i style="width:${Math.max(0, Math.min(1, share * 100 - i)) * 100}%"></i></span>`).join('')}</div>
      <p class="cohort-key">100 dots represent the starting ${number(visual.initial)} ${escape(visual.unit)}. A partial dot shows an expected fraction.</p>
      </div><div><ol class="funnel-stages">
        <li><span>${escape(visual.start_label)}</span><b>${number(counts[0])}</b><span class="funnel-track"><i style="width:100%"></i></span></li>
        ${visual.stages.map((s, i) => `<li class="${i === reached - 1 ? 'current' : i >= reached ? 'upcoming' : ''}" ${i === reached - 1 ? 'aria-current="step"' : ''}><span>${escape(s.label)}</span><b>${i < reached ? number(counts[i + 1]) : '…'}</b><span class="funnel-track"><i style="width:${i < reached ? counts[i + 1] / visual.initial * 100 : 0}%"></i></span></li>`).join('')}
      </ol>
      <div class="visual-equation" role="status" aria-live="polite"><span>${number(before)} entering this gate × ${number(rates[reached - 1] * 100)}%</span><strong>= ${countLabel}</strong><p>The ${number(rates[reached - 1] * 100)}% applies to the ${number(before)} still here.</p></div></div></div>
      ${reached === visual.stages.length ? `<wa-details class="visual-experiment" summary="What if one rate changes?"><p>Keep the starting group and the other rates fixed. Predict which counts will change, then move the slider.</p><label for="visual-rate">${escape(visual.stages[visual.adjustable_stage].label)}: <output id="visual-rate-label">${number((custom ? custom.rate : rates[visual.adjustable_stage]) * 100)}%</output></label><input id="visual-rate" data-visual-rate="${escape(id)}" type="range" min="0" max="100" step="0.5" value="${(custom ? custom.rate : rates[visual.adjustable_stage]) * 100}"><div data-visual-experiment-result></div><button class="text-button" data-visual-reset="${escape(id)}" type="button">Restore the example’s rates</button></wa-details>` : ''}
    </div>`;
  }

  function render(visual, part, id) {
    if (!visual) return '';
    const body = visual.kind === 'funnel' ? funnel(visual, part, id) :
      `<ol class="concept-flow">${visual.nodes.map(node => `<li class="${node.step === part ? 'current' : node.step > part ? 'upcoming' : ''}" ${node.step === part ? 'aria-current="step"' : ''}><span class="flow-node-number">${node.step + 1}</span><div><b>${escape(node.label)}</b><p>${escape(node.detail)}</p></div></li>`).join('')}</ol>`;
    return `<figure class="teaching-visual" data-visual="${escape(id)}"><figcaption><span class="visual-label">${visual.kind === 'funnel' ? 'FOLLOW THE GROUP' : 'FOLLOW THE CONNECTION'}</span><h2>${escape(visual.title)}</h2></figcaption>${body}<p class="visual-caption">${escape(visual.caption)}</p></figure>`;
  }

  function updateExperiment(lesson, rate) {
    const visual = lesson.visual;
    overrides.set(lesson.id, {rate});
    const rates = visual.stages.map((s, i) => i === visual.adjustable_stage ? rate : s.rate);
    const baseline = funnelCounts(visual.initial, visual.stages.map(s => s.rate));
    const counts = funnelCounts(visual.initial, rates);
    const box = document.querySelector('[data-visual-experiment-result]');
    if (!box) return;
    const label = document.querySelector('#visual-rate-label');
    label.textContent = number(rate * 100) + '%';
    box.innerHTML = `<table><caption>Original example → your changed rate</caption><thead><tr><th>Stage</th><th>Original</th><th>Changed</th></tr></thead><tbody>${visual.stages.map((s, i) => `<tr><th scope="row">${escape(s.label)}</th><td>${number(baseline[i + 1])}</td><td>${number(counts[i + 1])}</td></tr>`).join('')}</tbody></table><p role="status">${number(counts[visual.adjustable_stage])} enter the changed gate. ${number(rate * 100)}% of that group continue. Earlier counts stay the same; this gate and later counts are recalculated.</p>`;
  }

  function mount(lessons) {
    document.querySelectorAll('[data-funnel]').forEach(host => {
      const id = host.dataset.funnel, share = Number(host.dataset.share);
      const old = previous.get(id);
      if (old !== undefined && old !== share && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        host.querySelectorAll('.cohort-dots span').forEach((dot, i) => {
          const from = Math.max(0, Math.min(1, old * 100 - i));
          const to = Math.max(0, Math.min(1, share * 100 - i));
          if (from !== to) dot.firstElementChild.animate([{width: from * 100 + '%'}, {width: to * 100 + '%'}], {duration: 240, easing: 'ease-out'});
        });
      }
      previous.set(id, share);
      const slider = host.querySelector('[data-visual-rate]');
      if (slider) updateExperiment(lessons.find(l => l.id === id), Number(slider.value) / 100);
    });
  }

  const api = {render, mount, updateExperiment, funnelCounts};
  if (typeof module !== 'undefined') module.exports = api;
  else root.NoemaVisuals = api;
})(typeof window === 'undefined' ? globalThis : window);
