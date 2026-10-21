import { parseArgs } from "node:util";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ROOT, loadBundle } from "./course";
import { InboxStore, settingsSchema } from "./inbox-store";
import { InboxWorker } from "./inbox-worker";
import { makeServer } from "./server";
import { bundle, bundleBytes } from "./share";
import { Crawler } from "./crawl";
import { inspectCourse } from "./course-inspect";
const [command = "serve", ...args] = process.argv.slice(2);
const { values: v, positionals: p } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    course: { type: "string" },
    data: { type: "string", default: join(ROOT, "local-data") },
    port: { type: "string", default: "8765" },
    provider: { type: "string" },
    model: { type: "string", default: "" },
    repo: { type: "string" },
    "generate-provider": { type: "string" },
    "generate-model": { type: "string", default: "" },
    out: { type: "string" },
    id: { type: "string" },
    title: { type: "string" },
    note: { type: "string", default: "" },
    "text-file": { type: "string" },
    sources: { type: "string" },
    "archive-at": { type: "string" },
    prefix: { type: "string", default: "/blog" },
    "retry-unavailable": { type: "boolean", default: false },
  },
});
async function main() {
  if (command === "serve") {
    if (v.repo && !(await stat(v.repo)).isDirectory())
      throw Error("--repo must be an existing checkout directory");
    const store = v.course ? undefined : new InboxStore(v.data);
    if (v["generate-provider"] !== undefined)
      store?.configure(
        settingsSchema.shape.provider.parse(v["generate-provider"]),
        v["generate-model"],
        v["generate-provider"] !== "none",
      );
    const server = makeServer({
      course: v.course || join(ROOT, "courses/deepinfer"),
      port: Number(v.port),
      provider: v.provider,
      model: v.model,
      repo: v.repo ? resolve(v.repo) : undefined,
      inbox: store,
      share: bundleBytes,
    });
    const worker = store ? new InboxWorker(store) : null;
    worker?.start();
    console.log("Noema: http://127.0.0.1:" + server.port);
    console.log(
      "Answer checks: " +
        (v.provider
          ? v.provider + "; model: " + (v.model || "CLI default")
          : "model from Settings"),
    );
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await worker?.stop();
      await server.stop(true);
      store?.close();
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
    return;
  }
  if (command === "course") {
    const [action, path] = p;
    if (!path) throw Error("Usage: bun run course validate|inspect|bundle|init COURSE");
    if (action === "validate") {
      const b = loadBundle(path);
      console.log(
        `Valid: ${b.course.LESSONS.length} topics, ${Object.keys(b.challenges).length} review scenarios`,
      );
    } else if (action === "inspect") {
      console.log(JSON.stringify(inspectCourse(loadBundle(path).course), null, 2));
    } else if (action === "bundle") {
      if (!v.out) throw Error("Use --out course.zip");
      console.log(await bundle(path, v.out));
    } else if (action === "init") {
      if (!v.id || !v.title) throw Error("Use --id and --title");
      await mkdir(path);
      await writeFile(
        join(path, "course.json"),
        JSON.stringify(
          {
            META: {
              id: v.id,
              title: v.title,
              heading: v.title,
              eyebrow: "YOUR COURSE",
              introduction: "",
              start_label: "START HERE",
              footnote: "",
              about_html: "",
            },
            CONTENT_REVISION: "draft-1",
            LABS: [],
            SOURCES: {},
            LESSONS: [],
            GLOSSARY: {},
          },
          null,
          2,
        ),
      );
      await writeFile(join(path, "challenges.json"), "[]\n");
      console.log("Draft created. Author lessons using docs/AUTHORING.md, then validate.");
    } else throw Error("Choose validate, inspect, bundle or init.");
    return;
  }
  if (command === "inbox") {
    const store = new InboxStore(v.data);
    try {
      const [action, id] = p;
      let result: unknown;
      if (action === "status")
        result = {
          settings: store.settings(),
          items: store.list().map((i) => store.projection(i)),
        };
      else if (action === "add") {
        const { item, fresh } = store.add(
          id,
          v.note,
          v["text-file"] ? await readFile(v["text-file"], "utf8") : "",
          v.sources || null,
        );
        result = { added: fresh, ...store.projection(item) };
      } else if (action === "retry") result = store.projection(store.action(id, "retry"));
      else if (action === "bundle") {
        const i = store.get(id);
        if (i.state !== "ready" || !i.course_path || !v.out)
          throw Error("Choose a ready course and --out destination.zip");
        result = await bundle(i.course_path, v.out);
      } else throw Error("Choose add, status, retry or bundle.");
      console.log(JSON.stringify(result, null, 2));
    } finally {
      store.close();
    }
    return;
  }
  if (command === "crawl") {
    if (!p[0] || !v.out)
      throw Error("Usage: bun run crawl URL --out DIRECTORY [--archive-at TIMESTAMP]");
    console.log(
      JSON.stringify(
        await new Crawler(p[0], v.out, v["archive-at"] || null, v.prefix).run(
          v["retry-unavailable"],
        ),
      ),
    );
    return;
  }
  throw Error("Choose serve, course, inbox or crawl.");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
