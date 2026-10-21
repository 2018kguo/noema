import { ROOT } from "./course";
import { join } from "node:path";
const cases = ["baseline", "broken", "repaired", "reference-checks"];
export async function workshop(command: "case" | "source", selected = "") {
  if (command === "case" && !cases.includes(selected))
    throw Error("Choose one fixed workshop case.");
  if (!Bun.which("python3"))
    throw Error(
      "The optional inference lab needs Python 3.9+. Reading and quizzes work without it.",
    );
  const process = Bun.spawn(
    ["python3", join(ROOT, "tiny_engine.py"), command, ...(command === "case" ? [selected] : [])],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => process.kill(), 15000);
  try {
    const raw = await new Response(process.stdout).text();
    if ((await process.exited) !== 0)
      throw Error("The reference comparison failed; no passing result was recorded.");
    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}
