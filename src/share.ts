import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { ROOT, READER_ASSETS, loadBundle } from "./course";
export async function bundleBytes(path: string) {
  const selected = loadBundle(path),
    files: Record<string, Uint8Array> = {};
  for (const name of [...READER_ASSETS, "tiny_engine.py", "LICENSE"])
    files[name] = await readFile(join(ROOT, name));
  // A standalone server bundle includes its dependencies; no install or source crawl is shared.
  const built = await Bun.build({
    entrypoints: [join(ROOT, "src/portable.ts")],
    target: "bun",
    minify: true,
  });
  if (!built.success) throw Error("Could not build the portable course server.");
  files["serve.js"] = new Uint8Array(await built.outputs[0].arrayBuffer());
  for (const name of ["course.json", "challenges.json"])
    files["course/" + name] = await readFile(join(selected.path, name));
  files["README.txt"] = strToU8(
    "Requires Bun 1.4.3+. Unzip, then run: bun serve.js\nOpen http://127.0.0.1:8765\n\nReading, quizzes and self-comparison need no AI account.\nOptional: bun serve.js --provider claude --model haiku\nRecipients use their own installed and signed-in CLI account.\nThe optional inference lab also needs Python 3.9+.\nRaw sources, browser progress, queue settings and keys are excluded.\n",
  );
  return zipSync(files);
}
export async function bundle(path: string, out: string) {
  const bytes = await bundleBytes(path);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);
  return out;
}
