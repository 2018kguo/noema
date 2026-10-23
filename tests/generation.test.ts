import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generate } from "../src/generation";
import { InboxStore } from "../src/inbox-store";
import { loadBundle } from "../src/course";
import fixtures from "./fixtures/generation.json";
const reading = {
  documents: [
    {
      id: "source1",
      title: "Fixture source",
      url: "https://example.org/source",
      text: "A source paragraph. ".repeat(80),
      sha256: "fixture",
      links: [],
      embeds: [],
    },
  ],
  scope: "Fixture only",
  gaps: [],
  media_note: "No media.",
};
test("generation validates model output and reuses checkpointed steps without new calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "noema-generation-")),
    s = new InboxStore(join(dir, "inbox")),
    item = s.add("https://example.org/source").item;
  let calls = 0,
    failedOnce = false,
    leaked = false,
    critiques = 0;
  const shared = new Set<string>(),
    prompts: string[] = [];
  const caller = async (
    _provider: string,
    _model: string,
    prompt: string,
    schema: Record<string, unknown>,
    _timeout?: number,
    _cancelled?: () => boolean,
    system = "",
  ) => {
    calls++;
    prompts.push(prompt);
    const keys = Object.keys(schema.properties as object);
    if (!keys.includes("example_setup") || keys.includes("questions")) shared.add(system);
    // The first plan answer cites a source by title, as a real model did; validation must
    // send it back once with the problem named.
    if (keys.includes("glossary") && calls === 1)
      return {
        ...fixtures.plan,
        lessons: fixtures.plan.lessons.map((l) => ({ ...l, sources: ["Fixture source"] })),
      };
    // A review call fails once like a dropped CLI connection; the retry must absorb it.
    if (
      !keys.includes("glossary") &&
      !keys.includes("questions") &&
      !keys.includes("example_setup") &&
      !keys.includes("problems") &&
      !failedOnce
    ) {
      failedOnce = true;
      throw Error("claude exited with status 1");
    }
    // Self-review: the first topic gets one problem, so its draft is revised once.
    if (keys.includes("problems")) {
      critiques++;
      return {
        problems:
          critiques === 1
            ? [{ where: "level 1", problem: "says nothing", fix: "add the case" }]
            : [],
      };
    }
    return keys.includes("glossary")
      ? fixtures.plan
      : keys.includes("questions")
        ? fixtures.lesson
        : keys.includes("example_setup")
          ? fixtures.editor
          : // One review names a source by id in prose, as review-3 of a real run did; the
            // checkpoint must send it back instead of failing the finished course.
            leaked
            ? fixtures.review
            : ((leaked = true), { ...fixtures.review, solution: "As source1 shows, it holds." });
  };
  try {
    const result = await generate(
      item,
      reading,
      join(dir, "draft"),
      { provider: "claude", model: "fixture", enabled: true },
      () => {},
      () => false,
      caller,
      0,
    );
    // 16 drafting calls, one self-review per topic, and a revision per topic: the fixture draft
    // trips the mechanical checks, so every topic is rewritten before anyone sees it.
    expect(critiques).toBe(5);
    expect(calls).toBe(27);
    // One cached prefix: every call that needs the sources gets the same system prompt, and
    // no user prompt re-sends the source text.
    expect(shared.size).toBe(1);
    expect([...shared][0]).toContain("A source paragraph.");
    expect(prompts.some((p) => p.includes("A source paragraph."))).toBe(false);
    const b = loadBundle(result.output);
    expect(b.course.LESSONS).toHaveLength(5);
    expect(Object.keys(b.challenges)).toHaveLength(3);
    expect(b.course.LESSONS[1].needs).toEqual(["idea-1"]);
    // The fixture's illustration lists its steps out of order; it is dropped, not fatal.
    expect(b.course.LESSONS.every((l) => !l.illustrations?.length)).toBe(true);
    const second = await generate(
      item,
      reading,
      join(dir, "draft"),
      { provider: "claude", model: "fixture", enabled: true },
      () => {},
      () => false,
      async () => {
        throw Error("Checkpoint called the model again");
      },
    );
    expect(second.output).not.toBe(result.output);
    expect(loadBundle(second.output).course).toEqual(b.course);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("cancellation after a model returns never saves or publishes that output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "noema-cancel-")),
    s = new InboxStore(join(dir, "inbox")),
    item = s.add("https://example.org/source").item;
  let stopped = false;
  try {
    await expect(
      generate(
        item,
        reading,
        join(dir, "draft"),
        { provider: "claude", model: "fixture", enabled: true },
        () => {},
        () => stopped,
        async () => {
          stopped = true;
          return fixtures.plan;
        },
      ),
    ).rejects.toThrow();
    expect(readdirSync(join(dir, "draft"))).toHaveLength(0);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
