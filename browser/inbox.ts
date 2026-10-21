import { icon, type IconName } from "./icons";

const $ = (
  selector: string,
): HTMLInputElement & HTMLTextAreaElement & HTMLDialogElement & HTMLDetailsElement =>
  document.querySelector(selector);
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
const activeStates = ["researching", "writing", "checking"];
const stateNames = {
  queued: "Queued",
  researching: "Reading sources",
  writing: "Writing lessons",
  checking: "Editing & checking",
  ready: "Ready to learn",
  needs_input: "Needs your input",
  failed: "Couldn’t finish",
  cancelled: "Stopped",
};
let inbox = null,
  filter = "all",
  detailId = null,
  detailRecord = null,
  lastList = "",
  toastTimer;
let refreshing = false,
  lastControls = "";
const courseSummaries = new Map();
function courseCards() {
  if (!inbox || !window.NoemaUI || !window.NoemaProgress) return;
  const courses = [
    ...inbox.items
      .filter((i) => i.state === "ready")
      .map((i) => ({ ...i, courseUrl: i.course_url, sample: false })),
    {
      id: "deepinfer",
      title: inbox.sample.title,
      url: inbox.sample.origin?.url || "https://github.com/deepseek-ai/DeepInfer",
      image: inbox.sample.origin?.image || null,
      courseUrl: inbox.sample.url,
      sample: true,
    },
  ];
  for (const item of courses) {
    const element = document.querySelector('[data-ready-course="' + item.id + '"]');
    if (!element) continue;
    if (!courseSummaries.has(item.courseUrl)) {
      courseSummaries.set(item.courseUrl, { kind: "loading" });
      fetch(item.courseUrl + "course.json")
        .then((r) => {
          if (!r.ok) throw Error("Course unavailable");
          return r.json();
        })
        .then((c) =>
          courseSummaries.set(item.courseUrl, { kind: "ready", info: NoemaProgress.summary(c) }),
        )
        .catch(() => courseSummaries.set(item.courseUrl, { kind: "unavailable" }))
        .finally(courseCards);
    }
    const cached = courseSummaries.get(item.courseUrl);
    const progress =
      cached.kind === "ready"
        ? NoemaProgress.read(cached.info, localStorage)
        : cached.kind === "loading"
          ? null
          : { kind: "unavailable" };
    NoemaUI.readyCourse(element, {
      id: item.id,
      title: item.title,
      domain: item.sample ? "Included course · DeepInfer" : domain(item.url),
      url: item.courseUrl,
      sample: item.sample,
      origin: item.url,
      image: item.image || null,
      progress,
    });
  }
}
window.addEventListener("noema-ui-ready", courseCards);
window.addEventListener("storage", courseCards);
window.addEventListener("focus", courseCards);

async function api(path, body = undefined) {
  const response = await fetch(
    "/api/inbox" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
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
      return new URL(original).hostname.replace(/^www\./, "") + " · archived";
    }
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "Saved source";
  }
}
function age(seconds) {
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - seconds) / 60));
  return minutes < 1
    ? "Just added"
    : minutes < 60
      ? minutes + "m ago"
      : minutes < 1440
        ? Math.floor(minutes / 60) + "h ago"
        : Math.floor(minutes / 1440) + "d ago";
}
function stateClass(state) {
  return activeStates.includes(state) ? "active" : state === "needs_input" ? "needs" : state;
}
function badge(state) {
  return `<span class="state ${stateClass(state)}">${escapeHTML(stateNames[state] || state)}</span>`;
}
function row(item) {
  const ready = item.state === "ready",
    active = activeStates.includes(item.state);
  if (ready)
    return `<div data-ready-course="${escapeHTML(item.id)}"><a href="${escapeHTML(item.course_url)}">${escapeHTML(item.title)}</a></div>`;
  const content = `<span class="source-icon" aria-hidden="true"><img src="https://icons.duckduckgo.com/ip3/${escapeHTML(domain(item.url).split(" ")[0])}.ico" alt="" width="18" height="18" onerror="this.replaceWith(document.createTextNode('↗'))"></span><span class="item-copy"><span class="item-title">${escapeHTML(item.title)}</span><span class="item-domain">${escapeHTML(domain(item.url))}</span>${item.note ? `<span class="item-note">${escapeHTML(item.note)}</span>` : ""}${active ? `<span class="item-progress">${escapeHTML(item.message)}</span>` : ""}</span><span class="item-end">${badge(item.state)}${ready ? '<span class="row-link">Open course ↗</span>' : ""}<span class="row-time">${age(item.created)}</span></span>`;
  return ready
    ? `<div class="item-entry"><a class="item-row ready-row" href="${escapeHTML(item.course_url)}">${content}</a><button class="item-more" data-item="${escapeHTML(item.id)}" aria-label="Details and sharing for ${escapeHTML(item.title)}" title="Details and sharing">···</button></div>`
    : `<button class="item-row" data-item="${escapeHTML(item.id)}">${content}</button>`;
}

function sampleRow() {
  return `<div data-ready-course="deepinfer"><a href="${escapeHTML(inbox.sample.url)}">${escapeHTML(inbox.sample.title)}</a></div>`;
}
function renderList() {
  if (!inbox) return;
  const learning = location.hash === "#learning",
    query = $("#search").value.trim().toLowerCase();
  const active = inbox.items.filter((item) => activeStates.includes(item.state)),
    queued = inbox.items.filter((item) => item.state === "queued"),
    needs = inbox.items.filter((item) => ["needs_input", "failed"].includes(item.state));
  $("#inbox-count").textContent = inbox.items.filter((item) => item.state !== "cancelled").length;
  $("#learning-count").textContent =
    inbox.items.filter((item) => item.state === "ready").length + 1;
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
  $("#collection-summary").textContent = learning
    ? "Your courses, with your place saved as you go."
    : active.length
      ? active.length + " preparing" + (queued.length ? " · " + queued.length + " queued" : "")
      : queued.length
        ? queued.length + " queued" + (inbox.settings.enabled ? "" : " · preparation paused")
        : needs.length
          ? needs.length +
            " " +
            (needs.length === 1 ? "item needs" : "items need") +
            " your attention"
          : inbox.items.length
            ? ""
            : "Save something you’d like to understand.";
  $("#collection-summary").hidden = learning || !$("#collection-summary").textContent;
  const configured = inbox.settings.provider !== "none",
    running = inbox.settings.enabled,
    signedOut = configured && links && !links[inbox.settings.provider].loggedIn;
  // Settings lives in the sidebar; this bar only shows the queue and a fix when it can't run.
  const controls = `<div class="queue-status ${running && !signedOut ? "running" : ""}"><span aria-hidden="true"></span><span>${signedOut ? `${NAMES[inbox.settings.provider]} isn’t signed in` : running ? "Queue running" : configured ? "Queue paused" : "No model connected"}</span>${configured && !signedOut ? `<button data-toggle-queue>${running ? "Pause" : "Resume"}</button>` : ""}${configured && !signedOut ? "" : "<button data-settings>Connect</button>"}</div>`;
  if (controls !== lastControls) {
    $("#queue-control").innerHTML = controls;
    lastControls = controls;
  }
  let items = inbox.items.filter((item) => !learning || item.state === "ready");
  if (!learning && filter !== "all")
    items = items.filter((item) =>
      filter === "preparing"
        ? ["queued", ...activeStates].includes(item.state)
        : ["needs_input", "failed"].includes(item.state),
    );
  if (query)
    items = items.filter((item) =>
      [item.title, item.url, item.note].join(" ").toLowerCase().includes(query),
    );
  let content = items.map(row).join("");
  if (learning && (!query || "inside inference deepinfer".includes(query))) content += sampleRow();
  if (!content)
    content = `<div class="empty"><span class="empty-mark" aria-hidden="true">${query ? "⌕" : "n"}</span><h3>${query ? "No matching links" : filter !== "all" ? "Nothing here yet" : "A good question is a place to start."}</h3><p>${query ? "Try a different word or clear your search." : filter === "needs" ? "Items that need more source text or a retry will appear here." : "Save a link above. You’ll see its progress here, then open the lessons when they’re ready."}</p>${!query && filter === "all" ? '<a class="quiet" href="/learn/deepinfer/">Explore the included course ↗</a>' : ""}</div>`;
  if (content !== lastList) {
    window.NoemaUI?.unmount();
    $("#items").innerHTML = content;
    lastList = content;
  }
  courseCards();
  document
    .querySelectorAll<HTMLElement>("[data-filter]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.filter === filter)),
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
    $("#connection-error").textContent =
      "Couldn’t reach the local server. Your saved links are still on disk. " +
      (error instanceof Error ? error.message : String(error));
    $("#connection-error").hidden = false;
  } finally {
    refreshing = false;
  }
}
function timeline(events) {
  return `<ol class="event-list">${events
    .slice(-8)
    .map(
      (event) =>
        `<li>${escapeHTML(event.message)}<time datetime="${new Date(event.at * 1000).toISOString()}">${escapeHTML(new Date(event.at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</time></li>`,
    )
    .join("")}</ol>`;
}
function detailActions(item) {
  if (item.state === "ready")
    return `<div class="detail-actions"><a class="primary" href="${escapeHTML(item.course_url)}">Start learning <span>→</span></a><a href="/share/${item.id}.zip" download>Download to share</a></div>`;
  if (["failed", "cancelled"].includes(item.state))
    return `<button class="primary" data-action="retry">Try again</button>`;
  if (["queued", ...activeStates].includes(item.state))
    return '<button class="quiet" data-action="cancel">Stop preparing this item</button>';
  return "";
}
function detailHTML(item) {
  return `<div class="dialog-heading"><h2 id="item-title" tabindex="-1" autofocus>${escapeHTML(item.title)}</h2><button class="close" data-close="item-dialog" aria-label="Close item">×</button></div><p class="detail-link"><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener" title="${escapeHTML(item.url)}"><img src="https://icons.duckduckgo.com/ip3/${escapeHTML(domain(item.url).split(" ")[0])}.ico" alt="" width="16" height="16" onerror="this.remove()"> ${escapeHTML(domain(item.url))} ${icon("external-link", 14)}</a></p><div class="detail-status"><div id="detail-badge">${badge(item.state)}</div><p id="detail-message">${escapeHTML(item.message)}</p></div>${item.note ? `<details class="detail-section"><summary>Your note</summary><p class="detail-note">${escapeHTML(item.note)}</p></details>` : ""}<div id="provide-text-area">${item.state === "needs_input" ? `<form id="provide-text-form"><label class="source-box-label" for="replacement-text">Paste the post or article text</label><textarea id="replacement-text" class="source-box" minlength="100" maxlength="100000" required placeholder="Copy the text you want to learn from. Noema will use this excerpt and keep the original link for reference.">${escapeHTML(item.source_text || "")}</textarea><p class="detail-explanation">This works for a tweet, a thread you’ve copied, or an excerpt from a page that needs a login.</p><button class="primary" type="submit">Continue with this text <span>↗</span></button></form>` : ""}</div><div class="detail-section" id="detail-actions">${detailActions(item)}</div><p id="item-error" class="error" role="alert" hidden></p><details class="detail-section"><summary>Activity (${item.events.length})</summary><div id="detail-timeline">${timeline(item.events)}</div></details>`;
}
async function refreshDetail(force = false) {
  const id = detailId,
    item = await api("/items/" + id);
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
type Connection = {
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  method: string | null;
  fix: string | null;
};
let links: Record<"claude" | "codex", Connection> | null = null;
const NAMES = { claude: "Claude Code", codex: "Codex" } as const;
async function loadConnections(refresh = false) {
  const response = await fetch("/api/connections" + (refresh ? "?refresh=1" : ""));
  links = await response.json();
  renderConnections();
}
function renderConnections() {
  if (!links) return;
  $("#connections").innerHTML = (["claude", "codex"] as const)
    .map((name) => {
      const c = links![name],
        state = !c.installed ? "Not installed" : c.loggedIn ? "Connected" : "Not signed in",
        detail = [c.version && "v" + c.version, c.method].filter(Boolean).join(" · ");
      return `<li class="${c.loggedIn ? "ok" : "off"}"><div><b>${NAMES[name]}</b><span>${state}${detail ? " · " + escapeHTML(detail) : ""}</span></div>${c.fix ? `<div class="fix"><code>${escapeHTML(c.fix)}</code><button type="button" class="quiet" data-copy="${escapeHTML(c.fix)}">${icon("copy", 14)} Copy</button></div><p class="form-help">Run this in a terminal, then press Recheck.</p>` : ""}</li>`;
    })
    .join("");
  for (const option of document.querySelector<HTMLSelectElement>("#provider")!.options)
    option.disabled = !links[option.value as "claude" | "codex"].loggedIn;
  const ready = (["claude", "codex"] as const).filter((n) => links![n].loggedIn);
  if (!links[$("#provider").value as "claude" | "codex"].loggedIn && ready[0])
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
  const value = (event.target as HTMLElement).closest<HTMLElement>("[data-copy]")?.dataset.copy;
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
      source_text: $("#source-text").value,
    });
    $("#links").value = "";
    $("#intent").value = "";
    $("#source-text").value = "";
    $("#capture-context").open = false;
    toast(
      result.added.length
        ? result.added.length === 1
          ? "Saved to your queue."
          : result.added.length + " links saved to your queue."
        : result.existing.length === 1
          ? "That link is already in your inbox."
          : "Those links are already in your inbox.",
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
      enabled: true,
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
  const button = event.target.querySelector<HTMLTextAreaElement>("button");
  button.disabled = true;
  try {
    await api("/items/" + detailId + "/action", {
      action: "provide_text",
      source_text: $("#replacement-text").value,
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
for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog"))
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        dialog.close();
    }
  });
$("#capture").addEventListener("dragover", (event) => {
  if (
    [...event.dataTransfer.types].some((type) => ["text/plain", "text/uri-list"].includes(type))
  ) {
    event.preventDefault();
    document.body.classList.add("drop-active");
  }
});
$("#capture").addEventListener("dragleave", (event) => {
  if (!(event.relatedTarget instanceof Node) || !$("#capture").contains(event.relatedTarget))
    document.body.classList.remove("drop-active");
});
$("#capture").addEventListener("drop", (event) => {
  const text =
    event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  document.body.classList.remove("drop-active");
  $("#links").value = text
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .join("\n");
  $("#links").focus();
});
// Check the CLIs once at startup so a broken sign-in shows before anything is queued.
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

// Static icons: any element with data-icon gets the matching Lucide shape.
document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
  el.innerHTML = icon(el.dataset.icon as IconName);
});
