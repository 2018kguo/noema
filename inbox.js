"use strict";
(() => {
  // browser/icons.ts
  var SHAPES = {
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    "book-open": '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    cog: '<path d="M11 10.27 7 3.34"/><path d="m11 13.73-4 6.93"/><path d="M12 22v-2"/><path d="M12 2v2"/><path d="M14 12h8"/><path d="m17 20.66-1-1.73"/><path d="m17 3.34-1 1.73"/><path d="M2 12h2"/><path d="m20.66 17-1.73-1"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m3.34 7 1.73 1"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8"/>',
    telescope: '<path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44"/><path d="m13.56 11.747 4.332-.924"/><path d="m16 21-3.105-6.21"/><path d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z"/><path d="m6.158 8.633 1.114 4.456"/><path d="m8 21 3.105-6.21"/><circle cx="12" cy="13" r="2"/>',
    "book-bookmark": '<path d="M10 2v7.751a.25.25 0 00.407.195l2.28-1.834a.5.5 0 01.627 0l2.28 1.834A.25.25 0 0016 9.751V2"/><path d="M4 19.5v-15A2.5 2.5 0 016.5 2H19a1 1 0 011 1v18a1 1 0 01-1 1H6.5a1 1 0 010-5H20"/>',
    "external-link": '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    "file-text": '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    "graduation-cap": '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    "list-checks": '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
    "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    plug: '<path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/>',
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    "circle-alert": '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>'
  };
  var icon = (name, size = 16) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHAPES[name]}</svg>`;

  // browser/inbox.ts
  var $ = (selector) => document.querySelector(selector);
  var escapeHTML = (value) => String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
  var activeStates = ["researching", "writing", "checking"];
  var stateNames = {
    queued: "Queued",
    researching: "Reading sources",
    writing: "Writing lessons",
    checking: "Editing & checking",
    ready: "Ready to learn",
    needs_input: "Needs your input",
    failed: "Couldn\u2019t finish",
    cancelled: "Stopped"
  };
  var inbox = null;
  var filter = "all";
  var detailId = null;
  var detailRecord = null;
  var lastList = "";
  var toastTimer;
  var refreshing = false;
  var lastControls = "";
  var courseSummaries = /* @__PURE__ */ new Map();
  function courseCards() {
    if (!inbox || !window.NoemaUI || !window.NoemaProgress) return;
    const courses = [
      ...inbox.items.filter((i) => i.state === "ready").map((i) => ({ ...i, courseUrl: i.course_url, sample: false })),
      {
        id: "deepinfer",
        title: inbox.sample.title,
        url: "https://github.com/deepseek-ai/DeepInfer",
        courseUrl: inbox.sample.url,
        sample: true
      }
    ];
    for (const item of courses) {
      const element = document.querySelector('[data-ready-course="' + item.id + '"]');
      if (!element) continue;
      if (!courseSummaries.has(item.courseUrl)) {
        courseSummaries.set(item.courseUrl, { kind: "loading" });
        fetch(item.courseUrl + "course.json").then((r) => {
          if (!r.ok) throw Error("Course unavailable");
          return r.json();
        }).then(
          (c) => courseSummaries.set(item.courseUrl, { kind: "ready", info: NoemaProgress.summary(c) })
        ).catch(() => courseSummaries.set(item.courseUrl, { kind: "unavailable" })).finally(courseCards);
      }
      const cached = courseSummaries.get(item.courseUrl);
      const progress = cached.kind === "ready" ? NoemaProgress.read(cached.info, localStorage) : cached.kind === "loading" ? null : { kind: "unavailable" };
      NoemaUI.readyCourse(element, {
        id: item.id,
        title: item.title,
        domain: item.sample ? "Included course \xB7 DeepInfer" : domain(item.url),
        url: item.courseUrl,
        sample: item.sample,
        progress
      });
    }
  }
  window.addEventListener("noema-ui-ready", courseCards);
  window.addEventListener("storage", courseCards);
  window.addEventListener("focus", courseCards);
  async function api(path, body = void 0) {
    const response = await fetch(
      "/api/inbox" + path,
      body === void 0 ? {} : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    const value = await response.json();
    if (!response.ok) throw Error(value.error || "The request could not finish. Try again.");
    return value;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.add("show");
    toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
  }
  function domain(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "web.archive.org") {
        const original = parsed.pathname.split("/").slice(3).join("/");
        return new URL(original).hostname.replace(/^www\./, "") + " \xB7 archived";
      }
      return parsed.hostname.replace(/^www\./, "");
    } catch {
      return "Saved source";
    }
  }
  function age(seconds) {
    const minutes = Math.max(0, Math.floor((Date.now() / 1e3 - seconds) / 60));
    return minutes < 1 ? "Just added" : minutes < 60 ? minutes + "m ago" : minutes < 1440 ? Math.floor(minutes / 60) + "h ago" : Math.floor(minutes / 1440) + "d ago";
  }
  function stateClass(state) {
    return activeStates.includes(state) ? "active" : state === "needs_input" ? "needs" : state;
  }
  function badge(state) {
    return `<span class="state ${stateClass(state)}">${escapeHTML(stateNames[state] || state)}</span>`;
  }
  function row(item) {
    const ready = item.state === "ready", active = activeStates.includes(item.state);
    if (ready)
      return `<div data-ready-course="${escapeHTML(item.id)}"><a href="${escapeHTML(item.course_url)}">${escapeHTML(item.title)}</a></div>`;
    const content = `<span class="source-icon" aria-hidden="true">${domain(item.url).startsWith("github") ? "\u2318" : "\u2197"}</span><span class="item-copy"><span class="item-title">${escapeHTML(item.title)}</span><span class="item-domain">${escapeHTML(domain(item.url))}</span>${item.note ? `<span class="item-note">${escapeHTML(item.note)}</span>` : ""}${active ? `<span class="item-progress">${escapeHTML(item.message)}</span>` : ""}</span><span class="item-end">${badge(item.state)}${ready ? '<span class="row-link">Open course \u2197</span>' : ""}<span class="row-time">${age(item.created)}</span></span>`;
    return ready ? `<div class="item-entry"><a class="item-row ready-row" href="${escapeHTML(item.course_url)}">${content}</a><button class="item-more" data-item="${escapeHTML(item.id)}" aria-label="Details and sharing for ${escapeHTML(item.title)}" title="Details and sharing">\xB7\xB7\xB7</button></div>` : `<button class="item-row" data-item="${escapeHTML(item.id)}">${content}</button>`;
  }
  function sampleRow() {
    return `<div data-ready-course="deepinfer"><a href="${escapeHTML(inbox.sample.url)}">${escapeHTML(inbox.sample.title)}</a></div>`;
  }
  function renderList() {
    if (!inbox) return;
    const learning = location.hash === "#learning", query = $("#search").value.trim().toLowerCase();
    const active = inbox.items.filter((item) => activeStates.includes(item.state)), queued = inbox.items.filter((item) => item.state === "queued"), needs = inbox.items.filter((item) => ["needs_input", "failed"].includes(item.state));
    $("#inbox-count").textContent = inbox.items.filter((item) => item.state !== "cancelled").length;
    $("#learning-count").textContent = inbox.items.filter((item) => item.state === "ready").length + 1;
    $("#nav-inbox").toggleAttribute("aria-current", !learning);
    $("#nav-learning").toggleAttribute("aria-current", learning);
    if (!learning) $("#nav-inbox").setAttribute("aria-current", "page");
    else $("#nav-learning").setAttribute("aria-current", "page");
    $("#capture").hidden = learning;
    $("#filters").hidden = learning;
    $("#collection-title").textContent = learning ? "Your courses" : "Your links";
    $("#search").placeholder = learning ? "Find a course" : "Find a link";
    $("#collection-title").setAttribute("aria-level", learning ? "1" : "2");
    document.querySelector(".collection").classList.toggle("learning", learning);
    $("#collection-summary").textContent = learning ? "Your courses, with your place saved as you go." : active.length ? active.length + " preparing" + (queued.length ? " \xB7 " + queued.length + " queued" : "") : queued.length ? queued.length + " queued" + (inbox.settings.enabled ? "" : " \xB7 preparation paused") : needs.length ? needs.length + " " + (needs.length === 1 ? "item needs" : "items need") + " your attention" : inbox.items.length ? "" : "Save something you\u2019d like to understand.";
    $("#collection-summary").hidden = learning || !$("#collection-summary").textContent;
    const configured = inbox.settings.provider !== "none", running = inbox.settings.enabled, signedOut = configured && links && !links[inbox.settings.provider].loggedIn;
    const controls = `<div class="queue-status ${running && !signedOut ? "running" : ""}"><span aria-hidden="true"></span><span>${signedOut ? `${NAMES[inbox.settings.provider]} isn\u2019t signed in` : running ? "Queue running" : configured ? "Queue paused" : "No model connected"}</span>${configured && !signedOut ? `<button data-toggle-queue>${running ? "Pause" : "Resume"}</button>` : ""}${configured && !signedOut ? "" : "<button data-settings>Connect</button>"}</div>`;
    if (controls !== lastControls) {
      $("#queue-control").innerHTML = controls;
      lastControls = controls;
    }
    let items = inbox.items.filter((item) => !learning || item.state === "ready");
    if (!learning && filter !== "all")
      items = items.filter(
        (item) => filter === "preparing" ? ["queued", ...activeStates].includes(item.state) : ["needs_input", "failed"].includes(item.state)
      );
    if (query)
      items = items.filter(
        (item) => [item.title, item.url, item.note].join(" ").toLowerCase().includes(query)
      );
    let content = items.map(row).join("");
    if (learning && (!query || "inside inference deepinfer".includes(query))) content += sampleRow();
    if (!content)
      content = `<div class="empty"><span class="empty-mark" aria-hidden="true">${query ? "\u2315" : "n"}</span><h3>${query ? "No matching links" : filter !== "all" ? "Nothing here yet" : "A good question is a place to start."}</h3><p>${query ? "Try a different word or clear your search." : filter === "needs" ? "Items that need more source text or a retry will appear here." : "Save a link above. You\u2019ll see its progress here, then open the lessons when they\u2019re ready."}</p>${!query && filter === "all" ? '<a class="quiet" href="/learn/deepinfer/">Explore the included course \u2197</a>' : ""}</div>`;
    if (content !== lastList) {
      window.NoemaUI?.unmount();
      $("#items").innerHTML = content;
      lastList = content;
    }
    courseCards();
    document.querySelectorAll("[data-filter]").forEach(
      (button) => button.setAttribute("aria-pressed", String(button.dataset.filter === filter))
    );
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      inbox = await api("");
      $("#connection-error").hidden = true;
      renderList();
      if (detailId && $("#item-dialog").open) await refreshDetail();
    } catch (error) {
      $("#connection-error").textContent = "Couldn\u2019t reach the local server. Your saved links are still on disk. " + (error instanceof Error ? error.message : String(error));
      $("#connection-error").hidden = false;
    } finally {
      refreshing = false;
    }
  }
  function timeline(events) {
    return `<ol class="event-list">${events.slice(-8).map(
      (event) => `<li>${escapeHTML(event.message)}<time datetime="${new Date(event.at * 1e3).toISOString()}">${escapeHTML(new Date(event.at * 1e3).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</time></li>`
    ).join("")}</ol>`;
  }
  function detailActions(item) {
    if (item.state === "ready")
      return `<div class="detail-actions"><a class="primary" href="${escapeHTML(item.course_url)}">Start learning <span>\u2197</span></a><a href="/share/${item.id}.zip" download>Download to share</a></div>`;
    if (["failed", "cancelled"].includes(item.state))
      return `<button class="primary" data-action="retry">Try again</button>`;
    if (["queued", ...activeStates].includes(item.state))
      return '<button class="quiet" data-action="cancel">Stop preparing this item</button>';
    return "";
  }
  function detailHTML(item) {
    return `<div class="dialog-heading"><h2 id="item-title">${escapeHTML(item.title)}</h2><button class="close" data-close="item-dialog" aria-label="Close item">\xD7</button></div><p class="detail-link"><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener">${escapeHTML(item.url)} \u2197</a></p><div class="detail-status"><div id="detail-badge">${badge(item.state)}</div><p id="detail-message">${escapeHTML(item.message)}</p></div>${item.note ? `<details class="detail-section"><summary>Your note</summary><p class="detail-note">${escapeHTML(item.note)}</p></details>` : ""}<div id="provide-text-area">${item.state === "needs_input" ? `<form id="provide-text-form"><label class="source-box-label" for="replacement-text">Paste the post or article text</label><textarea id="replacement-text" class="source-box" minlength="100" maxlength="100000" required placeholder="Copy the text you want to learn from. Noema will use this excerpt and keep the original link for reference.">${escapeHTML(item.source_text || "")}</textarea><p class="detail-explanation">This works for a tweet, a thread you\u2019ve copied, or an excerpt from a page that needs a login.</p><button class="primary" type="submit">Continue with this text <span>\u2197</span></button></form>` : ""}</div><div class="detail-section" id="detail-actions">${detailActions(item)}</div><p id="item-error" class="error" role="alert" hidden></p><section class="detail-section"><h3>Activity</h3><div id="detail-timeline">${timeline(item.events)}</div></section>`;
  }
  async function refreshDetail(force = false) {
    const id = detailId, item = await api("/items/" + id);
    if (id !== detailId) return;
    if (force || !detailRecord || detailRecord.state !== item.state) {
      $("#item-content").innerHTML = detailHTML(item);
    } else {
      $("#item-title").textContent = item.title;
      $("#detail-message").textContent = item.message;
      $("#detail-timeline").innerHTML = timeline(item.events);
    }
    detailRecord = item;
  }
  async function openItem(id) {
    detailId = id;
    detailRecord = null;
    try {
      await refreshDetail(true);
      $("#item-dialog").showModal();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  }
  var links = null;
  var NAMES = { claude: "Claude Code", codex: "Codex" };
  async function loadConnections(refresh2 = false) {
    const response = await fetch("/api/connections" + (refresh2 ? "?refresh=1" : ""));
    links = await response.json();
    renderConnections();
  }
  function renderConnections() {
    if (!links) return;
    $("#connections").innerHTML = ["claude", "codex"].map((name) => {
      const c = links[name], state = !c.installed ? "Not installed" : c.loggedIn ? "Connected" : "Not signed in", detail = [c.version && "v" + c.version, c.method].filter(Boolean).join(" \xB7 ");
      return `<li class="${c.loggedIn ? "ok" : "off"}"><div><b>${NAMES[name]}</b><span>${state}${detail ? " \xB7 " + escapeHTML(detail) : ""}</span></div>${c.fix ? `<div class="fix"><code>${escapeHTML(c.fix)}</code><button type="button" class="quiet" data-copy="${escapeHTML(c.fix)}">${icon("copy", 14)} Copy</button></div><p class="form-help">Run this in a terminal, then press Recheck.</p>` : ""}</li>`;
    }).join("");
    for (const option of document.querySelector("#provider").options)
      option.disabled = !links[option.value].loggedIn;
    const ready = ["claude", "codex"].filter((n) => links[n].loggedIn);
    if (!links[$("#provider").value].loggedIn && ready[0])
      $("#provider").value = ready[0];
    $("#save-settings").disabled = !ready.length;
  }
  function openSettings() {
    if (!inbox) return;
    if (inbox.settings.provider !== "none") $("#provider").value = inbox.settings.provider;
    $("#generation-model").value = inbox.settings.model || "";
    $("#settings-error").hidden = true;
    $("#save-settings").textContent = inbox.settings.enabled ? "Save" : "Start preparing";
    renderConnections();
    $("#settings-dialog").showModal();
  }
  $("#recheck").addEventListener("click", async () => {
    $("#recheck").disabled = true;
    try {
      await loadConnections(true);
    } finally {
      $("#recheck").disabled = false;
    }
  });
  $("#connections").addEventListener("click", (event) => {
    const value = event.target.closest("[data-copy]")?.dataset.copy;
    if (value) void navigator.clipboard.writeText(value).then(() => toast("Copied."));
  });
  $("#capture-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#capture-error").hidden = true;
    const urls = $("#links").value.split(/\s+/).filter(Boolean);
    $("#add-button").disabled = true;
    try {
      const result = await api("/items", {
        urls,
        note: $("#intent").value,
        source_text: $("#source-text").value
      });
      $("#links").value = "";
      $("#intent").value = "";
      $("#source-text").value = "";
      $("#capture-context").open = false;
      toast(
        result.added.length ? result.added.length === 1 ? "Saved to your queue." : result.added.length + " links saved to your queue." : result.existing.length === 1 ? "That link is already in your inbox." : "Those links are already in your inbox."
      );
      filter = "all";
      await refresh();
      $("#links").focus();
    } catch (error) {
      $("#capture-error").textContent = error instanceof Error ? error.message : String(error);
      $("#capture-error").hidden = false;
    } finally {
      $("#add-button").disabled = false;
    }
  });
  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#settings-error").hidden = true;
    $("#save-settings").disabled = true;
    try {
      await api("/settings", {
        provider: $("#provider").value,
        model: $("#generation-model").value,
        enabled: true
      });
      $("#settings-dialog").close();
      toast("Preparation is connected. Your queue will begin shortly.");
      await refresh();
    } catch (error) {
      $("#settings-error").textContent = error instanceof Error ? error.message : String(error);
      $("#settings-error").hidden = false;
    } finally {
      $("#save-settings").disabled = false;
    }
  });
  document.addEventListener("submit", async (event) => {
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== "provide-text-form") return;
    event.preventDefault();
    const button = event.target.querySelector("button");
    button.disabled = true;
    try {
      await api("/items/" + detailId + "/action", {
        action: "provide_text",
        source_text: $("#replacement-text").value
      });
      await refreshDetail(true);
      await refresh();
      toast("Text saved. This item is back in the queue.");
    } catch (error) {
      $("#item-error").textContent = error instanceof Error ? error.message : String(error);
      $("#item-error").hidden = false;
      button.disabled = false;
    }
  });
  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.close) {
      $("#" + button.dataset.close).close();
      return;
    }
    if (button.id === "settings-button" || button.hasAttribute("data-settings")) {
      openSettings();
      return;
    }
    if (button.dataset.filter) {
      filter = button.dataset.filter;
      renderList();
      return;
    }
    if (button.dataset.item) {
      await openItem(button.dataset.item);
      return;
    }
    if (button.hasAttribute("data-toggle-queue")) {
      button.disabled = true;
      try {
        await api("/settings", { ...inbox.settings, enabled: !inbox.settings.enabled });
        await refresh();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
        button.disabled = false;
      }
    }
    if (button.dataset.action && detailId) {
      button.disabled = true;
      try {
        await api("/items/" + detailId + "/action", { action: button.dataset.action });
        await refreshDetail(true);
        await refresh();
      } catch (error) {
        $("#item-error").textContent = error instanceof Error ? error.message : String(error);
        $("#item-error").hidden = false;
        button.disabled = false;
      }
    }
  });
  $("#search").addEventListener("input", renderList);
  window.addEventListener("hashchange", renderList);
  $("#item-dialog").addEventListener("close", () => {
    detailId = null;
    detailRecord = null;
  });
  for (const dialog of document.querySelectorAll("dialog"))
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
          dialog.close();
      }
    });
  $("#capture").addEventListener("dragover", (event) => {
    if ([...event.dataTransfer.types].some((type) => ["text/plain", "text/uri-list"].includes(type))) {
      event.preventDefault();
      document.body.classList.add("drop-active");
    }
  });
  $("#capture").addEventListener("dragleave", (event) => {
    if (!(event.relatedTarget instanceof Node) || !$("#capture").contains(event.relatedTarget))
      document.body.classList.remove("drop-active");
  });
  $("#capture").addEventListener("drop", (event) => {
    const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    document.body.classList.remove("drop-active");
    $("#links").value = text.split("\n").filter((line) => line && !line.startsWith("#")).join("\n");
    $("#links").focus();
  });
  void Promise.all([refresh(), loadConnections()]).then(() => {
    void refresh();
    if (location.hash === "#settings") openSettings();
  });
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 2500);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
})();
