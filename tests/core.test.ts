import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InboxStore, normalizeLink } from "../src/inbox-store";
import {
  loadBundle,
  validateCourse,
  showsSourceIds,
  ROOT,
  visualSchema,
  checkVisual,
} from "../src/course";
import { validateGrade, selectedContext } from "../src/grade";
import { extractArticle, cleanHTML, canonical } from "../src/html";
import { collect, publicURL, NeedsInput, research } from "../src/source-reader";
import { InboxWorker } from "../src/inbox-worker";
import { Crawler } from "../src/crawl";
import { makeServer } from "../src/server";
import { bundleBytes } from "../src/share";
import { unzipSync } from "fflate";
import { progress } from "../browser/progress";
import { visuals } from "../browser/visuals";
import { scheduleTimes } from "../src/visual-models";
import { connections } from "../src/connections";
import { runStructured } from "../src/structured-cli";
import { z } from "zod";
import { levelFor, place, switchTrack, trackState } from "../browser/levels";
import { sourceHref } from "../browser/links";
import { tells, titleTells } from "../src/tells";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
});
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "noema-ts-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function store() {
  const s = new InboxStore(temp());
  cleanups.push(() => s.close());
  return s;
}
const sample = loadBundle(join(ROOT, "courses/deepinfer"));
function article() {
  const dir = temp(),
    c = structuredClone(sample.course);
  c.META.id = "article";
  delete c.META.progress_key;
  c.LABS = [];
  c.LESSONS = [c.LESSONS[0]];
  c.META.placement = c.META.placement?.filter((q) => q.phase === c.LESSONS[0].phase);
  delete c.LESSONS[0].activity;
  writeFileSync(join(dir, "course.json"), JSON.stringify(c));
  writeFileSync(join(dir, "challenges.json"), "[]");
  return { dir, c };
}
test("loads canonical assessments and rejects broken references before serving", () => {
  expect(Object.keys(sample.assessments)).toHaveLength(25);
  for (const field of ["needs", "sources"] as const) {
    const c = structuredClone(sample.course);
    c.LESSONS[0][field] = ["missing"];
    expect(() => validateCourse(c, Object.values(sample.challenges))).toThrow();
  }
  const c = structuredClone(sample.course);
  c.LESSONS[1].questions[0].id = c.LESSONS[0].questions[0].id;
  expect(() => validateCourse(c, [])).toThrow();
});
test.each([
  "http://localhost/a",
  "http://127.0.0.1/a",
  "http://10.0.0.1/a",
  "http://169.254.169.254/",
  "file:///etc/passwd",
  "http://[::1]/",
  "https://user:secret@example.org/",
  "https://example.org:444/a",
])("rejects nonpublic link %s", (url) => expect(() => normalizeLink(url)).toThrow());
test("normalizes social links and deduplicates without losing existing notes", () => {
  const s = store();
  const a = s.add("https://twitter.com/person/status/123?s=20&utm_source=a", "keep this");
  const b = s.add("https://x.com/person/status/123", "replacement");
  expect(a.fresh).toBe(true);
  expect(b.fresh).toBe(false);
  expect(b.item.note).toBe("keep this");
});
test("only one live lease can own a queue, including separate connections", () => {
  const s = store(),
    other = new InboxStore(s.root);
  cleanups.push(() => other.close());
  s.add("https://example.org/a");
  s.add("https://example.org/b");
  const a = s.claim("owner-a")!;
  expect(other.claim("owner-b")).toBeNull();
  expect(s.heartbeat(a.id, "owner-a")).toBe(true);
  expect(s.heartbeat(a.id, "owner-b")).toBe(false);
  expect(s.advance(a.id, "owner-b", "ready", "wrong")).toBe(false);
  expect(s.advance(a.id, "owner-a", "ready", "ready")).toBe(true);
  expect(other.claim("owner-b")).not.toBeNull();
});
test("expired workers cannot heartbeat or publish after a new owner claims", () => {
  const s = store(),
    at = Date.now() / 1000;
  const i = s.add("https://example.org/a").item;
  s.claim("old", at - 120);
  expect(s.heartbeat(i.id, "old")).toBe(false);
  expect(s.advance(i.id, "old", "ready", "stale")).toBe(false);
  expect(s.claim("new", at)?.owner).toBe("new");
  expect(s.advance(i.id, "old", "failed", "wrong")).toBe(false);
  expect(s.owned(i.id, "new")).toBe(true);
});
test("cancel fences a worker and pasted source creates a new revision", () => {
  const s = store(),
    i = s.add("https://example.org/a").item;
  s.claim("old");
  s.action(i.id, "cancel");
  expect(s.advance(i.id, "old", "ready", "stale")).toBe(false);
  expect(() => s.action(i.id, "provide_text", "short")).toThrow();
  const revised = s.action(i.id, "provide_text", "source material ".repeat(20));
  expect(revised.revision).toBe(2);
  expect(revised.state).toBe("queued");
  expect(revised.owner).toBeNull();
  expect(s.events(i.id)).toHaveLength(4);
});
test("worker saves a needs-input result and pauses retain drafts", async () => {
  const s = store();
  s.configure("claude", "haiku", true);
  const i = s.add("https://example.org/a").item;
  const w = new InboxWorker(
    s,
    async () => {
      throw Error("must not generate");
    },
    async () => {
      throw new NeedsInput("Paste the source.");
    },
  );
  expect(await w.processNext()).toBe(true);
  expect(s.get(i.id).state).toBe("needs_input");
  s.configure("claude", "haiku", false);
  expect(await w.processNext()).toBe(false);
});
test("cancel during generation cannot publish even when provider returns a result", async () => {
  const s = store();
  s.configure("claude", "haiku", true);
  const i = s.add("https://example.org/a", "", "public source ".repeat(30)).item;
  const w = new InboxWorker(
    s,
    async () => {
      s.action(i.id, "cancel");
      return { output: sample.path, title: "stale" };
    },
    undefined,
    async (_item, reading) => reading,
  );
  await w.processNext();
  expect(s.get(i.id).state).toBe("cancelled");
  expect(s.get(i.id).course_path).toBeNull();
});
test("sanitizer removes executable markup and attributes but preserves code text", () => {
  const safe = cleanHTML(
    '<p onclick="bad()">Hello <strong>reader</strong><script>bad()</script></p><svg><script>alsoBad()</script></svg><pre>&lt;tag&gt;</pre><a href="javascript:bad()">label</a>',
  );
  expect(safe).toContain("<strong>reader</strong>");
  expect(safe).toContain("&lt;tag&gt;");
  expect(safe).not.toMatch(/script|onclick|href|svg/);
});
test("article extraction reads semantic text and records media without script content", () => {
  const p = extractArticle(
    '<title>A title</title><p>First paragraph</p><script>secret()</script><p>Second <b>paragraph</b></p><a href="/blog/b">More</a><iframe src="/movie"></iframe>',
  );
  expect(p.title).toBe("A title");
  expect(p.blocks.join(" ")).not.toContain("secret");
  expect(p.links).toEqual(["/blog/b"]);
  expect(p.embeds[0].src).toBe("/movie");
});
test("pasted source collection is cached and never fetches the original link", async () => {
  const s = store(),
    i = s.add("https://example.org/a", "", "original text ".repeat(20)).item,
    dir = temp();
  let fetched = false;
  const result = await collect(i, dir, async () => {
    fetched = true;
    throw Error("not allowed");
  });
  expect(fetched).toBe(false);
  expect(result.documents[0].text).toBe(i.source_text);
  expect(await collect(i, dir)).toEqual(result);
});
test("an X post is named by its author and never uses its own URL as a preview image", async () => {
  const s = store(),
    i = s.add("https://x.com/someone/status/2112955825367269788", "").item;
  const result = await collect(i, temp(), async (url) => {
    if (!url.startsWith("https://publish.twitter.com/oembed")) throw Error("not fetched: " + url);
    return [
      JSON.stringify({
        html:
          "<blockquote><p>We built one kernel for training and inference. " +
          "More detail. ".repeat(20) +
          "</p></blockquote>",
        author_name: "Some Lab",
      }),
      url,
    ];
  });
  expect(result.documents[0].title).toBe("Post by Some Lab on X");
  expect(result.documents[0].image).toBeUndefined();
});
test("a post's links are followed through the author's reply to the write-up and repository", async () => {
  const s = store(),
    i = s.add("https://x.com/someone/status/2112955825367269788", "").item,
    sha = "a".repeat(40),
    fetched: string[] = [];
  const html = (body: string) =>
    `<html><head><title>Page</title></head><body><article><p>${"word ".repeat(80)}</p>${body}</article></body></html>`;
  const result = await collect(i, temp(), async (url) => {
    fetched.push(url);
    if (url.startsWith("https://publish.twitter.com/oembed"))
      return [
        JSON.stringify({
          html:
            "<blockquote><p>4,000x faster. " +
            "More detail. ".repeat(20) +
            '<a href="https://t.co/abc">link</a></p></blockquote>',
          author_name: "Lab",
        }),
        url,
      ];
    // The shortened link leads back to the post's own page, where the reply carries the links.
    if (url === "https://t.co/abc")
      return [
        html(
          '<a href="https://help.x.com/rules">rules</a><a href="https://lab.example/">home</a>' +
            '<a href="https://github.com/lab/run">code</a><a href="https://lab.example/run#update">post</a>',
        ),
        "https://x.com/someone/status/2112955825367269788",
      ];
    if (url === "https://lab.example/run#update") return [html(""), url];
    const api = "https://api.github.com/repos/lab/run";
    if (url === api + "/commits/HEAD") return [JSON.stringify({ sha }), url];
    if (url.startsWith(api + "/git/trees/"))
      return [JSON.stringify({ tree: [{ path: "README.md", type: "blob", size: 10 }] }), url];
    if (url === `https://raw.githubusercontent.com/lab/run/${sha}/README.md`) return ["# Run", url];
    if (url.startsWith(api + "/pulls"))
      return [
        JSON.stringify([
          {
            number: 2,
            title: "Fused kernels, 1.6 s",
            body: "Why it is faster.",
            merged_at: "2026-10-22T00:00:00Z",
          },
          { number: 1, title: "Closed unmerged", body: null, merged_at: null },
        ]),
        url,
      ];
    throw Error("not fetched: " + url);
  });
  expect(result.documents.map((d) => d.title)).toEqual([
    "Post by Lab on X",
    "Page",
    "run · README.md",
    "run · merged pull requests",
    "Page",
  ]);
  expect(result.documents[3].text).toContain("#2 Fused kernels, 1.6 s");
  expect(result.documents[3].text).not.toContain("Closed unmerged");
  // Site chrome and a bare homepage are skipped, and GitHub's HTML page is never fetched.
  expect(fetched).not.toContain("https://help.x.com/rules");
  expect(fetched).not.toContain("https://lab.example/");
  expect(fetched).not.toContain("https://github.com/lab/run");
});
test("an X post reads the author's reply chain and their answers, not other people's replies", async () => {
  const s = store(),
    i = s.add("https://x.com/lab/status/100", "").item,
    fetched: string[] = [];
  const status = (id: string, by: string, text: string, to?: string) => ({
    id,
    text,
    author: { screen_name: by },
    replying_to: to ? { status: to } : null,
  });
  const result = await collect(i, temp(), async (url) => {
    fetched.push(url);
    if (url.startsWith("https://publish.twitter.com/oembed"))
      return [
        JSON.stringify({
          html: "<blockquote><p>4,000x faster. " + "More detail. ".repeat(20) + "</p></blockquote>",
          author_name: "Lab",
        }),
        url,
      ];
    if (url === "https://api.fxtwitter.com/2/thread/100")
      return [
        JSON.stringify({
          thread: [
            status("100", "lab", "4,000x faster."),
            status("101", "lab", "code: https://lab.example/run/notes", "100"),
          ],
        }),
        url,
      ];
    if (url === "https://api.fxtwitter.com/2/conversation/100")
      return [
        JSON.stringify({
          replies: [
            status("200", "reader", "Does it scale?", "100"),
            status("201", "lab", "Not all of the tricks will.", "200"),
            status("202", "fan", "wow https://spam.example/x", "100"),
          ],
        }),
        url,
      ];
    if (url === "https://lab.example/run/notes")
      return [
        `<html><head><title>Notes</title></head><body><article><p>${"word ".repeat(80)}</p></article></body></html>`,
        url,
      ];
    throw Error("not fetched: " + url);
  });
  const post = result.documents[0].text;
  expect(post).toContain("code: https://lab.example/run/notes");
  expect(post).toContain(
    "@reader asked: Does it scale?\nThe author answered: Not all of the tricks will.",
  );
  expect(post).not.toContain("wow");
  expect(result.documents.map((d) => d.title)).toEqual(["Post by Lab on X", "Notes"]);
  expect(fetched).not.toContain("https://spam.example/x");
});
test("double-escaped model HTML is unwrapped; code keeps its escapes", () => {
  expect(cleanHTML(JSON.stringify("<p>One.</p>\n<p>Two</p>"))).toBe("<p>One.</p>\n<p>Two</p>");
  expect(cleanHTML('<p>A \\n line and a \\"quote\\"</p><pre><code>print("\\n")</code></pre>')).toBe(
    "<p>A   line and a &quot;quote&quot;</p><pre><code>print(&quot;\\n&quot;)</code></pre>",
  );
});
test("DNS rejects a local address before connection", async () => {
  await expect(publicURL("http://127.0.0.1/")).rejects.toThrow();
});
test("grader requires every criterion once and literal learner evidence", () => {
  const c = sample.assessments["lesson-map"],
    answer = "The engine runs the model.";
  const g = {
    summary: "Explain the boundary.",
    follow_up: "What changes?",
    criteria: c.criteria.map((r) => ({
      id: r.id,
      verdict: "met",
      evidence: "engine",
      feedback: "reason",
    })),
  };
  expect(validateGrade(g, c, answer).criteria).toHaveLength(c.criteria.length);
  expect(() => validateGrade({ ...g, criteria: g.criteria.slice(1) }, c, answer)).toThrow();
  expect(() =>
    validateGrade(
      { ...g, criteria: g.criteria.map((r) => ({ ...r, evidence: "invented quote" })) },
      c,
      answer,
    ),
  ).toThrow();
  expect(() =>
    validateGrade(
      { ...g, criteria: g.criteria.map((r) => ({ ...r, id: g.criteria[0].id })) },
      c,
      answer,
    ),
  ).toThrow();
});
test("selected repository context rejects traversal and bounds excerpts", async () => {
  const dir = temp(),
    c = { ...sample.assessments["lesson-map"], repo_paths: ["file.ts"] };
  writeFileSync(join(dir, "file.ts"), "line\n".repeat(250));
  const r = await selectedContext(c, dir);
  expect(r.excerpts[0].text.split("\n")).toHaveLength(210);
  await expect(selectedContext({ ...c, repo_paths: ["../outside"] }, dir)).rejects.toThrow();
});
test("roughly thirty-minute blocks cover topics exactly once and keep a final singleton together", () => {
  const lessons = Array.from({ length: 13 }, (_, i) => ({ id: "t" + i, reading_minutes: 6 }));
  const blocks = progress.blocks(lessons);
  expect(blocks.map((b) => b.lessons.length)).toEqual([5, 5, 3]);
  expect(blocks.flatMap((b) => b.lessons)).toEqual(lessons);
  expect(blocks[0].minutes).toBe(30);
  expect(progress.blocks(lessons.slice(0, 11)).map((b) => b.lessons.length)).toEqual([5, 6]);
});
test("reading progress and practice differ; legacy completion counts as read", () => {
  const first = sample.course.LESSONS[0].id;
  const snapshot = progress.snapshot(sample.course, { completed: { [first]: { at: 1 } } });
  expect(snapshot.read).toBe(1);
  expect(snapshot.practiced).toBe(1);
  const read = progress.snapshot(sample.course, { read: { [first]: { at: 1 } } });
  expect(read.read).toBe(1);
  expect(read.practiced).toBe(0);
  expect(progress.read(sample.course, { getItem: () => "{broken" })).toEqual({
    kind: "unavailable",
  });
});
test("cohort calculation applies each rate to the previous group", () => {
  expect(visuals.funnelCounts(100, [0.8, 0.5, 0.75])).toEqual([100, 80, 40, 30]);
  expect(() => visuals.funnelCounts(100, [1.1])).toThrow();
});
test("archive failures remain partial and retry can settle coverage", async () => {
  let failed = true;
  const fetcher = async (url: string): Promise<[string, string]> => {
    if (url.includes("cdx"))
      return [
        JSON.stringify([
          ["urlkey", "timestamp", "original"],
          ["key", "20260101", "https://example.org/blog/a"],
        ]),
        url,
      ];
    if (url.includes("available"))
      return [
        JSON.stringify({
          archived_snapshots: {
            closest: {
              available: true,
              timestamp: "20260101",
              url: "https://web.archive.org/web/20260101/https://example.org/blog/a",
            },
          },
        }),
        url,
      ];
    if (failed) throw Error("unavailable");
    return ["<title>Article</title><p>" + "Readable article material. ".repeat(30) + "</p>", url];
  };
  const c = new Crawler("https://example.org/blog/a", temp(), "20260101", "/blog", fetcher, 0);
  expect(((await c.run()) as { kind: string }).kind).toBe("partial");
  failed = false;
  expect(((await c.run(true)) as { kind: string }).kind).toBe("complete");
  expect(canonical("https://web.archive.org/web/20260101/https://example.org/blog/a?utm_x=1")).toBe(
    "https://example.org/blog/a",
  );
});
test("HTTP refuses foreign origin, private files and arbitrary workshop code", async () => {
  const server = makeServer({ course: sample.path, port: 0 });
  cleanups.push(() => server.stop(true));
  const base = "http://127.0.0.1:" + server.port;
  expect(
    (await fetch(base + "/course.json", { headers: { Origin: "https://foreign.example" } })).status,
  ).toBe(403);
  expect((await fetch(base + "/.env")).status).toBe(404);
  expect(
    (
      await fetch(base + "/api/workshop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case: "baseline", code: "bad()" }),
      })
    ).status,
  ).toBe(422);
  expect(
    (await fetch(base + "/vendor/geist-latin-wght-normal.woff2")).headers.get("content-type"),
  ).toContain("font/woff2");
});
test("article course has its own rubric and no executable inference endpoint", async () => {
  const { dir } = article(),
    server = makeServer({ course: dir, port: 0 });
  cleanups.push(() => server.stop(true));
  expect(Object.keys(loadBundle(dir).assessments)).toEqual(["lesson-map"]);
  for (const path of ["/api/workshop/source", "/tiny_engine.py"])
    expect((await fetch("http://127.0.0.1:" + server.port + path)).status).toBe(404);
});
test("share archive excludes raw sources, keys and progress and boots after extraction", async () => {
  const { dir } = article();
  writeFileSync(join(dir, ".env"), "SECRET=private");
  writeFileSync(join(dir, "progress.json"), "private");
  const files = unzipSync(await bundleBytes(dir));
  expect(Object.keys(files)).not.toContain(".env");
  expect(Object.keys(files)).not.toContain("progress.json");
  expect(Object.keys(files)).toContain("serve.js");
  const unpack = temp();
  for (const [name, data] of Object.entries(files)) {
    mkdirSync(join(unpack, name, ".."), { recursive: true });
    writeFileSync(join(unpack, name), data);
  }
  expect(loadBundle(join(unpack, "course")).course.META.id).toBe("article");
  const child = Bun.spawn([process.execPath, "serve.js", "--port", "18769"], {
    cwd: unpack,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:18769/course.json");
        expect(response.status).toBe(200);
        expect((await response.json()).META.id).toBe("article");
        return;
      } catch {
        await Bun.sleep(50);
      }
    }
    throw Error("Portable server did not start: " + (await new Response(child.stderr).text()));
  } finally {
    child.kill();
    await child.exited;
  }
}, 15000);

test("crawler follows relative article links and inventories external references", async () => {
  const dir = temp();
  const crawler = new Crawler(
    "https://example.org/blog/a",
    dir,
    null,
    "/blog",
    async (url) => [
      "<title>Article</title><p>" +
        "Example content. ".repeat(40) +
        '</p><a href="/blog/b">Related</a><a href="https://elsewhere.org/paper">Paper</a>',
      url,
    ],
    0,
  );
  await crawler.run();
  expect(Object.keys(crawler.data.pages)).toContain("https://example.org/blog/b");
  expect(crawler.data.pages["https://example.org/blog/b"].status).toBe("fetched");
  expect(Object.keys(crawler.data.references)).toContain("https://elsewhere.org/paper");
});
test("course text rejects raw HTML introductions and bare source ids", () => {
  const challenges = Object.values(sample.challenges);
  expect(() => validateCourse(structuredClone(sample.course), challenges)).not.toThrow();
  const html = structuredClone(sample.course);
  html.META.introduction = "<p>Raw tags</p>";
  expect(() => validateCourse(html, challenges)).toThrow("plain text");
  const ids = structuredClone(sample.course);
  ids.LESSONS[0].levels[1] += "<p>As source1 says.</p>";
  expect(() => validateCourse(ids, challenges)).toThrow("Name sources");
  // Model HTML quotes the attribute either way before cleanHTML runs; both are citations.
  expect(showsSourceIds({ html: "<a data-source='source1' data-quote='x'>x</a>" })).toBe(false);
  expect(showsSourceIds({ html: "As source1 says." })).toBe(true);
});
test("schedule slack absorbs a delay until the task becomes critical", () => {
  const plan = (d: number) =>
    scheduleTimes([
      { id: "a", duration: 4, after: [] },
      { id: "b", duration: 10, after: ["a"] },
      { id: "c", duration: d, after: ["a"] },
      { id: "d", duration: 2, after: ["b", "c"] },
    ]);
  expect(plan(6).finish).toBe(16);
  expect(plan(6).critical.has("c")).toBe(false);
  expect(plan(10).finish).toBe(16);
  expect(plan(13).finish).toBe(19);
  expect([...plan(13).critical].sort()).toEqual(["a", "c", "d"]);
});
test("connections report sign-in state without account details", async () => {
  const exec = async (cmd: string[]) =>
    cmd.includes("--version")
      ? { code: 0, out: cmd[0] === "claude" ? "2.1.305 (Claude Code)" : "codex-cli 0.163.0" }
      : cmd[0] === "claude"
        ? {
            code: 0,
            out: '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max","email":"a@b.c"}',
          }
        : { code: 1, out: "Not logged in" };
  const c = await connections(true, exec);
  if (Bun.which("claude"))
    expect(c.claude).toEqual({
      installed: true,
      version: "2.1.305",
      loggedIn: true,
      method: "Claude max subscription",
      fix: null,
    });
  if (Bun.which("codex"))
    expect(c.codex).toMatchObject({
      installed: true,
      version: "0.163.0",
      loggedIn: false,
      fix: "codex login",
    });
  expect(JSON.stringify(c)).not.toContain("a@b.c");
  await connections(true);
});
test("a pass reads the topics written at its level and keeps its own progress", () => {
  const topic = (id: string, ...have: number[]) => ({
    id,
    phase: "A",
    levels: Object.fromEntries(have.map((n) => [n, "<p>text</p>"])),
  });
  const basics = topic("basics", 1),
    core = topic("core", 1, 2, 3),
    deep = topic("deep", 3);
  expect(progress.path([basics, core, deep], {}).map((l) => l.id)).toEqual(["basics", "core"]);
  expect(progress.path([basics, core, deep], { level: 3 }).map((l) => l.id)).toEqual([
    "core",
    "deep",
  ]);
  // A topic opened outside its pass shows its nearest written level.
  expect(levelFor(deep, { level: 2 })).toBe(3);
  expect(levelFor(basics, { level: 3 })).toBe(1);
  // Switching parks the current pass's progress and restores it on the way back.
  const intro = {
    level: 1,
    read: { basics: 1 },
    completed: {},
    blocks: {},
    flow: {},
    lastLesson: "basics",
    answers: { q: 1 },
  };
  const high = switchTrack(intro, 2);
  expect(high).toMatchObject({ level: 2, read: {}, lastLesson: null, answers: { q: 1 } });
  expect(trackState(high, 1).read).toEqual({ basics: 1 });
  const back = switchTrack({ ...high, read: { core: 1 } }, 1);
  expect(back).toMatchObject({ level: 1, read: { basics: 1 }, lastLesson: "basics" });
  expect(trackState(back, 2).read).toEqual({ core: 1 });
  const probes = [
    { id: "a2", phase: "A", level: 2, correct: 0 },
    { id: "b2", phase: "B", level: 2, correct: 2 },
    { id: "a3", phase: "A", level: 3, correct: 1 },
  ];
  expect(place(probes, { a2: 0, b2: 2, a3: 1 })).toBe(3);
  expect(place(probes, { a2: 0, b2: 2, a3: -1 })).toBe(2);
  expect(place(probes, { a2: 0, b2: -1, a3: 1 })).toBe(1);
});
test("course validation requires one question per written level", () => {
  const challenges = Object.values(sample.challenges);
  const full = sample.course.LESSONS.findIndex((l) => l.levels[1] && l.levels[2] && l.levels[3]);
  const c = structuredClone(sample.course);
  c.LESSONS[full].questions = c.LESSONS[full].questions.filter((q) => q.level !== 2);
  expect(() => validateCourse(c, challenges)).toThrow("has no question");
  const d = structuredClone(sample.course);
  delete d.LESSONS[full].levels[3];
  expect(() => validateCourse(d, challenges)).toThrow("level the topic lacks");
});
test("structured calls never send a $schema URI and surface the CLI's own error", async () => {
  const bin = temp(),
    path = process.env.PATH;
  // A stand-in for the Claude CLI: rejects $schema like v2.1 does, otherwise returns an envelope.
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\ncase "$*" in *'$schema'*) echo '{"is_error":true,"result":"not a valid JSON Schema"}'; exit 1;; esac\ncase "$*" in *fail-please*) echo '{"is_error":true,"result":"Not logged in · Please run /login"}'; exit 1;; esac\necho '{"structured_output":{"title":"ok"},"usage":{}}'\n`,
    { mode: 0o755 },
  );
  process.env.PATH = bin + ":" + path;
  try {
    const schema = z.toJSONSchema(z.object({ title: z.string() }));
    expect(schema.$schema).toBeDefined();
    expect(await runStructured("claude", "", "hi", schema)).toEqual({ title: "ok" });
    await expect(
      runStructured("claude", "", "hi", { type: "object", description: "fail-please" }),
    ).rejects.toThrow("Not logged in");
  } finally {
    process.env.PATH = path;
  }
});
test("research fetches links the sources contain, named reference pages and searched https pages", async () => {
  const dir = temp(),
    fetched: string[] = [];
  const page = (title: string) =>
    `<html><head><title>${title}</title></head><body><article><p>${"word ".repeat(80)}</p></article></body></html>`;
  const reading = {
    documents: [
      {
        url: "https://example.org/post",
        title: "Post",
        text: "text",
        sha256: "x",
        links: ["https://example.org/paper", "https://example.org/about"],
        embeds: [],
      },
    ],
    scope: "Post only.",
    gaps: [],
    media_note: "",
  };
  const result = await research(
    { id: "a", url: "https://example.org/post", note: "" } as never,
    reading,
    dir,
    async (_prompt, _schema, search) =>
      search
        ? // Only https search results are fetched; plain http and already-read pages are skipped.
          {
            subject: [
              { url: "https://lab.example/write-up", why: "the subject's own write-up" },
              { url: "http://lab.example/insecure", why: "x" },
            ],
            context: [{ url: "https://example.org/post", why: "already read" }],
          }
        : {
            links: [
              { url: "https://example.org/paper", why: "the paper" },
              { url: "https://evil.example/made-up", why: "invented" },
            ],
            background: [{ title: "Attention (machine learning)", why: "prerequisite" }],
          },
    async (url) => {
      fetched.push(url);
      return [page(url), url];
    },
  );
  expect(fetched.sort()).toEqual([
    "https://en.wikipedia.org/api/rest_v1/page/html/Attention_(machine_learning)",
    "https://example.org/paper",
    "https://lab.example/write-up",
  ]);
  expect(result.documents.map((d) => d.id)).toEqual(["source1", "source2", "source3", "source4"]);
  // The source's own links and the subject's write-up are read in full; only Wikipedia is
  // background.
  expect(result.documents.filter((d) => d.background).map((d) => d.url)).toEqual([
    "https://en.wikipedia.org/api/rest_v1/page/html/Attention_(machine_learning)",
  ]);
  // Saved: a second run neither asks the model nor fetches.
  const again = await research({ id: "a", url: "", note: "" } as never, reading, dir, async () => {
    throw Error("asked again");
  });
  expect(again.documents).toHaveLength(4);
});
test("a plot is drawn as SVG from its numbers and rejects points off its axes", () => {
  const roof = visualSchema.parse({
    kind: "plot",
    title: "A roofline",
    caption: "Invented chip.",
    source_ids: ["source1"],
    x: { label: "FLOPs per byte", log: true, min: 0.1, max: 100 },
    y: { label: "GFLOP/s", log: true, min: 1, max: 1000 },
    series: [
      {
        label: "Roof",
        style: "line",
        points: [
          { x: 0.1, y: 10 },
          { x: 10, y: 1000 },
          { x: 100, y: 1000 },
        ],
      },
    ],
    marks: [{ x: 1, y: 40, label: "Kernel A" }],
  });
  const lesson = { sources: ["source1"] } as never;
  expect(() => checkVisual(roof, lesson, false)).not.toThrow();
  const svg = visuals.render(roof, 0, "roof");
  expect(svg).toContain("<svg");
  expect(svg).toContain("<polyline");
  expect(svg).toContain("Kernel A");
  expect(() =>
    checkVisual({ ...roof, marks: [{ x: 1000, y: 40, label: "off" }] } as never, lesson, false),
  ).toThrow("inside the axis");
});
test("quoted citations link to a highlighted passage", () => {
  expect(sourceHref("https://x.org/a", "rate-limited, by design")).toBe(
    "https://x.org/a#:~:text=rate%2Dlimited%2C%20by%20design",
  );
  expect(sourceHref("https://x.org/a#top", "short")).toBe("https://x.org/a#top:~:text=short");
  expect(
    sourceHref(
      "https://x.org/a",
      "one two three four five six seven eight nine ten eleven twelve thirteen",
    ),
  ).toBe(
    "https://x.org/a#:~:text=one%20two%20three%20four%20five,nine%20ten%20eleven%20twelve%20thirteen",
  );
  expect(sourceHref("https://x.org/a")).toBe("https://x.org/a");
});
test("the bundled course carries no strong LLM tells in its titles or teaching text", () => {
  const c = sample.course;
  expect(c.LESSONS.flatMap((l) => titleTells(l.title).filter((t) => t.strong))).toEqual([]);
  const text = c.LESSONS.flatMap((l) => Object.values(l.levels).filter(Boolean)).join(" ");
  // The workshop's "The code above…" line is a deliberate pointer at the lab, not a definition.
  expect(
    tells(text)
      .filter((t) => t.strong)
      .map((t) => t.sentence),
  ).toEqual([]);
});
test("tell detector names the sentences an editor must rewrite", () => {
  const found = tells(
    "<p>Three changes. A cache is not a log, but a ledger. The curve is the honest unit. Prefill reads the prompt once.</p>",
  );
  expect([...new Set(found.map((f) => f.kind))].sort()).toEqual([
    "announced count",
    "antithesis",
    "flashcard opener",
    "signature word",
  ]);
  expect(found.every((f) => !f.sentence.includes("Prefill"))).toBe(true);
  for (const [text, kind] of [
    ["The comparison group is built by randomization.", "flashcard opener"],
    ["It's not a bug, it's a feature.", "antithesis"],
    ["This is not only faster but also cheaper.", "antithesis"],
    ["We shipped it. The result? Chaos.", "question, instant answer"],
    ["Here's the thing about batching.", "false suspense"],
    ["Ultimately, the team moved on.", "signposted ending"],
    ["It's worth noting that nobody asked.", "empty transition"],
    ["The team moved to paging, highlighting its focus on memory.", "significance tail"],
    ["The cache serves as a record of each step.", "copula avoidance"],
    ["Think of it as a ledger.", "teacher voice"],
    ["Despite these challenges, the engine shipped.", "challenges brush-off"],
    ["We were fast — too fast.", "em dash"],
    ["A speed limit sign does the same job on a road.", "everyday analogy"],
    ["That pattern is my inference, not a claim either source makes.", "first-person narrator"],
    ["The schema change itself was not hard. The week it cost us was.", "contrast reversal"],
  ])
    expect(tells(text).map((f) => f.kind)).toContain(kind);
  // Plain human prose, including ordinary contrasts and questions, stays clean.
  for (const text of [
    "There were four of us, and we sat close enough to hear each other's keyboards.",
    "I didn't want a meeting, so I wrote a doc and asked people to read it by ten.",
    "Is it slower? Sometimes, when someone forgets to update the doc for a few days in a row.",
    "We went from three repos to one, and builds got faster.",
    "The bill was not small, but it was predictable.",
    "Each of those studies follows a protocol, a plan written before anyone enrolls that fixes who qualifies.",
  ])
    expect(tells(text).filter((f) => f.strong)).toEqual([]);
  expect(titleTells("The math you need, without the fog").map((f) => f.kind)).toContain(
    "cute title",
  );
  expect(titleTells("Tokens, logits and choosing what comes next")[0]?.kind).toBe("list of three");
  expect(titleTells("How the scheduler picks the next batch")).toEqual([]);
});
