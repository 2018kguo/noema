import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InboxStore, normalizeLink } from "../src/inbox-store";
import { loadBundle, validateCourse, ROOT } from "../src/course";
import { validateGrade, selectedContext } from "../src/grade";
import { extractArticle, cleanHTML, canonical } from "../src/html";
import { collect, publicURL, NeedsInput } from "../src/source-reader";
import { InboxWorker } from "../src/inbox-worker";
import { Crawler } from "../src/crawl";
import { makeServer } from "../src/server";
import { bundleBytes } from "../src/share";
import { unzipSync } from "fflate";
import { progress } from "../browser/progress";
import { visuals } from "../browser/visuals";
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
  delete c.LESSONS[0].activity;
  c.CARDS = c.CARDS.filter((c) => c[3] === "map");
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
  const w = new InboxWorker(s, async () => {
    s.action(i.id, "cancel");
    return { output: sample.path, title: "stale" };
  });
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
