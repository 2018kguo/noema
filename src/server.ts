import { z } from "zod";
import { join } from "node:path";
import { ROOT, READER_ASSETS, loadBundle, type CourseBundle } from "./course";
import { InboxStore, normalizeLink, settingsSchema } from "./inbox-store";
import { assess } from "./grade";
import { workshop } from "./workshop";
import { connections } from "./connections";
// Inject sharing to keep exported reader servers independent of the authoring/build tools.
export type ServerOptions = {
  course: string;
  port?: number;
  provider?: string;
  model?: string;
  repo?: string;
  inbox?: InboxStore;
  share?: (path: string) => Promise<Uint8Array>;
  assessor?: typeof assess;
  workshopRunner?: typeof workshop;
};
const json = (status: number, value: unknown) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw Error("Expected a JSON body.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > limit) {
      await reader.cancel();
      throw Error("Request exceeds the size limit.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function makeServer(options: ServerOptions) {
  const initial = loadBundle(options.course),
    store = options.inbox,
    // A --provider flag wins; otherwise written answers use the model chosen in Settings.
    grader = () =>
      options.provider
        ? { provider: options.provider, model: options.model || "" }
        : (store?.settings() ?? { provider: "none", model: "" });
  void connections();
  let grading = false;
  const file = async (path: string, download?: string) => {
    const f = Bun.file(path);
    if (!(await f.exists())) return json(404, { error: "Not found" });
    return new Response(f, {
      headers: {
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        ...(download ? { "Content-Disposition": 'attachment; filename="' + download + '"' } : {}),
      },
    });
  };
  function snapshot() {
    return {
      items: store!.list().map((i) => store!.projection(i)),
      settings: store!.settings(),
      sample: {
        title: initial.course.META.title,
        url: "/learn/deepinfer/",
        lessons: initial.course.LESSONS.length,
      },
    };
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 8765,
    idleTimeout: 255,
    maxRequestBodySize: 150000,
    async fetch(request, server) {
      const host = request.headers.get("host"),
        allowed = ["127.0.0.1:" + server.port, "localhost:" + server.port],
        origin = request.headers.get("origin");
      if (
        !host ||
        !allowed.includes(host) ||
        (origin !== null && !allowed.some((h) => origin === "http://" + h))
      )
        return json(403, { error: "Use the local workbook origin." });
      if (
        request.method === "POST" &&
        request.headers.get("content-type")?.split(";")[0] !== "application/json"
      )
        return json(403, { error: "Use the local workbook JSON client." });
      let path = new URL(request.url).pathname,
        bundle: CourseBundle = initial;
      try {
        if (store) {
          if (path === "/api/inbox" && request.method === "GET") return json(200, snapshot());
          if (path === "/api/inbox/items" && request.method === "POST") {
            const b = z
                .object({
                  urls: z.array(z.string()).min(1).max(20),
                  note: z.string().max(4000),
                  source_text: z.string().max(100000),
                })
                .strict()
                .parse(await body(request, 150000)),
              urls = b.urls.map(normalizeLink);
            if (b.source_text && urls.length !== 1)
              throw Error("Attach pasted text to one link at a time.");
            const added: ReturnType<InboxStore["projection"]>[] = [],
              existing: ReturnType<InboxStore["projection"]>[] = [];
            for (const url of urls) {
              const { item, fresh } = store.add(url, b.note, b.source_text);
              (fresh ? added : existing).push(store.projection(item));
            }
            return json(200, { added, existing });
          }
          if (path === "/api/inbox/settings" && request.method === "POST") {
            const b = settingsSchema.strict().parse(await body(request, 150000));
            if (b.enabled && b.provider !== "none" && !(await connections())[b.provider].loggedIn)
              throw Error("Connect that CLI first: install it and sign in, then press Recheck.");
            return json(200, store.configure(b.provider, b.model, b.enabled));
          }
          const itemRoute = /^\/api\/inbox\/items\/([a-f0-9]{16})(\/action)?$/.exec(path);
          if (itemRoute) {
            if (request.method === "GET" && !itemRoute[2]) {
              const item = store.get(itemRoute[1]);
              return json(200, {
                ...store.projection(item),
                source_text: item.source_text,
                events: store.events(item.id),
              });
            }
            if (request.method === "POST" && itemRoute[2]) {
              const b = z
                .object({
                  action: z.enum(["cancel", "retry", "provide_text"]),
                  source_text: z.string().optional(),
                })
                .strict()
                .parse(await body(request, 150000));
              return json(
                200,
                store.projection(store.action(itemRoute[1], b.action, b.source_text)),
              );
            }
          }
          const share = /^\/share\/(deepinfer|[a-f0-9]{16})\.zip$/.exec(path);
          if (share && request.method === "GET") {
            const item = share[1] === "deepinfer" ? null : store.get(share[1]),
              selected = item ? (item.state === "ready" ? item.course_path : null) : initial.path;
            if (!selected || !options.share)
              return json(404, { error: "This course is not ready to share." });
            return new Response(new Uint8Array(await options.share(selected)), {
              headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": 'attachment; filename="noema-' + share[1] + '.zip"',
                "Cache-Control": "no-store",
              },
            });
          }
          if (
            request.method === "GET" &&
            ["/", "/inbox.html", "/inbox.js", "/inbox.css"].includes(path)
          )
            return file(join(ROOT, path === "/" ? "inbox.html" : path.slice(1)));
          if (path.startsWith("/learn/")) {
            const match = /^\/learn\/(deepinfer|[a-f0-9]{16})(\/.*)?$/.exec(path);
            if (!match) return json(404, { error: "Choose a course from the inbox." });
            if (!match[2]) return Response.redirect(new URL(path + "/", request.url), 302);
            if (match[1] !== "deepinfer") {
              const item = store.get(match[1]);
              if (item.state !== "ready" || !item.course_path)
                return json(404, { error: "This course is still being prepared." });
              bundle = loadBundle(item.course_path);
            }
            path = match[2];
          }
        }
        if (request.method === "GET") {
          if (path === "/api/connections")
            return json(200, await connections(new URL(request.url).searchParams.has("refresh")));
          if (path === "/api/status") {
            const g = grader();
            return json(200, {
              provider: g.provider,
              model: g.model || "CLI default",
              repo: options.repo || null,
            });
          }
          if (path === "/api/challenges") return json(200, Object.values(bundle.challenges));
          if (path === "/api/workshop/source")
            return bundle.course.LABS.includes("tiny-engine")
              ? json(200, await (options.workshopRunner || workshop)("source"))
              : json(404, { error: "This course has no engine lab." });
          if (path === "/tiny_engine.py" && !bundle.course.LABS.includes("tiny-engine"))
            return json(404, { error: "This course has no engine lab." });
          const name = path === "/" ? "index.html" : path.slice(1);
          if (["course.json", "challenges.json"].includes(name))
            return file(join(bundle.path, name));
          if ([...READER_ASSETS, "tiny_engine.py"].includes(name)) return file(join(ROOT, name));
          return json(404, { error: "Not found" });
        }
        if (request.method === "POST") {
          if (path === "/api/workshop") {
            if (!bundle.course.LABS.includes("tiny-engine"))
              return json(404, { error: "This course has no engine lab." });
            const b = z
              .object({ case: z.string() })
              .strict()
              .parse(await body(request, 200));
            return json(200, await (options.workshopRunner || workshop)("case", b.case));
          }
          if (path === "/api/grade") {
            const b = z
                .object({ challenge_id: z.string(), answer: z.string().trim().min(10).max(12000) })
                .strict()
                .parse(await body(request, 20000)),
              challenge = bundle.assessments[b.challenge_id];
            if (!challenge) throw Error("Choose a known exercise.");
            if (grading)
              return json(409, { error: "A grade is already running; wait before retrying." });
            grading = true;
            const { provider, model } = grader();
            try {
              return json(
                200,
                await (options.assessor || assess)(
                  challenge,
                  b.answer,
                  provider,
                  model,
                  options.repo,
                  bundle.course.CONTENT_REVISION,
                ),
              );
            } finally {
              grading = false;
            }
          }
        }
        return json(404, { error: "Not found" });
      } catch (error) {
        return json(request.method === "GET" ? 404 : 422, {
          error: error instanceof Error ? error.message : "This request could not finish.",
        });
      }
    },
  });
  return server;
}
