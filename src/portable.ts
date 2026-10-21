import { parseArgs } from "node:util";
import { makeServer } from "./server";
import { join } from "node:path";
const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8765" },
    provider: { type: "string", default: "none" },
    model: { type: "string", default: "" },
    repo: { type: "string" },
  },
});
const server = makeServer({
  course: join(import.meta.dir, "course"),
  port: Number(values.port),
  provider: values.provider,
  model: values.model,
  repo: values.repo,
});
console.log("Course: http://127.0.0.1:" + server.port);
