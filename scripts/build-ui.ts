// Build the TypeScript browser sources for portable, offline course readers.
import { build, transform } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";

await import("./icons");
await mkdir("vendor", { recursive: true });
await build({
  entryPoints: ["browser/app.ts", "browser/inbox.ts", "browser/progress.ts", "browser/visuals.ts"],
  outdir: ".",
  bundle: true,
  format: "iife",
  target: "es2022",
});
const result = await build({
  entryPoints: ["ui/entry.tsx"],
  bundle: true,
  minify: true,
  format: "esm",
  jsx: "automatic",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "vendor/reader-ui.js",
  legalComments: "linked",
  metafile: true,
});
const compiler = await compile(await readFile("ui/styles.css", "utf8"), {
  base: resolve("ui"),
  onDependency: () => {},
});
const scanner = new Scanner({
  sources: [{ base: resolve("ui"), pattern: "**/*.{ts,tsx}", negated: false }],
});
await writeFile(
  "vendor/reader-ui.css",
  (await transform(compiler.build(scanner.scan()), { loader: "css", minify: true })).code,
);
await copyFile(
  "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  "vendor/geist-latin-wght-normal.woff2",
);

// Carry complete licenses for every package whose code appears in the bundle.
const packages = new Map();
for (const [input, contribution] of Object.entries(
  result.metafile.outputs["vendor/reader-ui.js"].inputs,
)) {
  if (!contribution.bytesInOutput) continue;
  if (!input.startsWith("node_modules/")) continue;
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (metadata.name) {
        packages.set(metadata.name, { directory, version: metadata.version });
        break;
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    directory = dirname(directory);
  }
}
for (const name of ["tailwindcss", "@fontsource-variable/geist"]) {
  const directory = resolve("node_modules", name),
    metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  packages.set(name, { directory, version: metadata.version });
}
const notices = ["shadcn/ui\n\n" + (await readFile("ui/components/LICENSE", "utf8"))];
for (const [name, { directory }] of [...packages].sort(([a], [b]) => a.localeCompare(b, "en"))) {
  let license;
  for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"]) {
    try {
      license = await readFile(join(directory, file), "utf8");
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  if (!license) throw Error("Missing license for bundled package " + name);
  notices.push(name + "\n\n" + license);
}
await writeFile("vendor/THIRD-PARTY-LICENSES.txt", notices.join("\n\n--------------------\n\n"));
const files = [
  "reader-ui.js",
  "reader-ui.js.LEGAL.txt",
  "reader-ui.css",
  "geist-latin-wght-normal.woff2",
  "THIRD-PARTY-LICENSES.txt",
];
const sha256 = {};
for (const name of files)
  sha256[name] = createHash("sha256")
    .update(await readFile("vendor/" + name))
    .digest("hex");
await writeFile(
  "vendor/manifest.json",
  JSON.stringify(
    {
      component_system: "shadcn/ui",
      source: JSON.parse(await readFile("ui/components/source.json", "utf8")),
      packages: Object.fromEntries(
        [...packages]
          .sort(([a], [b]) => a.localeCompare(b, "en"))
          .map(([name, value]) => [name, value.version]),
      ),
      sha256,
    },
    null,
    2,
  ) + "\n",
);
