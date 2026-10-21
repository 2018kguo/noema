// Import pinned shadcn source; parse syntax before adapting utility class lists.
import { parseSync, type Node } from "oxc-parser";
import { format } from "oxfmt";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const revision = "ba1503c64472b82256d9de95e2e62c5901a38e8b";
const source = `https://raw.githubusercontent.com/shadcn-ui/ui/${revision}/`;
const upstream: Record<string, { path: string; sha256: string }> = {};
await mkdir("ui/components/ui", { recursive: true });
function isNode(value: unknown): value is Node {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string" &&
    "start" in value &&
    typeof value.start === "number"
  );
}
for (const name of ["button", "card", "accordion", "badge", "progress"]) {
  const path = `apps/v4/registry/new-york-v4/ui/${name}.tsx`,
    response = await fetch(source + path);
  if (!response.ok) throw Error(`Could not fetch ${path}: ${response.status}`);
  const original = await response.text();
  upstream[name] = { path, sha256: createHash("sha256").update(original).digest("hex") };
  const parsed = parseSync(name + ".tsx", original);
  if (parsed.errors.length) throw Error("Could not parse upstream " + path);
  const edits: { start: number; end: number; text: string }[] = [];
  function visit(node: Node, ancestors: Node[]) {
    const parent = ancestors.at(-1);
    if (node.type === "Literal" && typeof node.value === "string") {
      if (parent?.type === "ImportDeclaration" && node.value === "cn")
        edits.push({ start: node.start, end: node.end, text: JSON.stringify("../../lib/utils") });
      else {
        const jsx =
          parent?.type === "JSXAttribute" &&
          parent.name.type === "JSXIdentifier" &&
          parent.name.name === "className";
        const call =
          parent?.type === "CallExpression" &&
          parent.callee.type === "Identifier" &&
          ["cn", "cva"].includes(parent.callee.name) &&
          parent.arguments.includes(node);
        let variant = false;
        if (parent?.type === "Property" && parent.value === node)
          for (const ancestor of [...ancestors].reverse()) {
            if (ancestor.type === "CallExpression") break;
            if (
              ancestor.type === "Property" &&
              ancestor.key.type === "Identifier" &&
              ancestor.key.name === "variants"
            ) {
              variant = true;
              break;
            }
          }
        if (jsx || call || variant) {
          const classes = node.value
            .split(/\s+/)
            .map((token) => {
              if (token === "transition-all")
                token =
                  name === "progress"
                    ? "transition-transform"
                    : "transition-[color,background-color,border-color,box-shadow]";
              return "ui:" + token;
            })
            .join(" ");
          edits.push({ start: node.start, end: node.end, text: JSON.stringify(classes) });
        }
      }
    }
    for (const value of Object.values(node)) {
      if (isNode(value)) visit(value, [...ancestors, node]);
      else if (Array.isArray(value))
        for (const child of value) if (isNode(child)) visit(child, [...ancestors, node]);
    }
  }
  visit(parsed.program, []);
  let content = original;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
  const formatted = await format(
    name + ".tsx",
    "// Adapted from shadcn/ui (MIT); see ../LICENSE and ../source.json.\n" + content,
  );
  await writeFile(`ui/components/ui/${name}.tsx`, formatted.code);
}
const license = await fetch(source + "LICENSE.md");
if (!license.ok) throw Error("Could not fetch the shadcn license");
await writeFile("ui/components/LICENSE", await license.text());
await writeFile(
  "ui/components/source.json",
  JSON.stringify(
    {
      project: "shadcn/ui",
      revision,
      source,
      upstream,
      changes: [
        "Prefix Tailwind classes with ui: to prevent collisions with lesson CSS.",
        "Use explicit transition properties instead of transition-all.",
      ],
    },
    null,
    2,
  ) + "\n",
);
