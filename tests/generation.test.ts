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
  let calls = 0;
  const caller = async (
    _provider: string,
    _model: string,
    _prompt: string,
    schema: Record<string, unknown>,
  ) => {
    calls++;
    const keys = Object.keys(schema.properties as object);
    return keys.includes("glossary")
      ? fixtures.plan
      : keys.includes("intuition_html")
        ? fixtures.lesson
        : keys.length === 1 && keys[0] === "lessons"
          ? fixtures.editor
          : fixtures.review;
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
    );
    expect(calls).toBe(10);
    const b = loadBundle(result.output);
    expect(b.course.LESSONS).toHaveLength(5);
    expect(Object.keys(b.challenges)).toHaveLength(3);
    expect(b.course.LESSONS[1].needs).toEqual(["idea-1"]);
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
