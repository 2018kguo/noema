import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { z } from "zod";
import { normalizeLink, publicAddress, type Item } from "./inbox-store";
import { extractArticle, unwrap } from "./html";
import { sha } from "./grade";
export class NeedsInput extends Error {}
export const documentSchema = z.object({
  id: z.string().optional(),
  url: z.string(),
  title: z.string(),
  text: z.string(),
  sha256: z.string(),
  links: z.array(z.string()),
  embeds: z.array(z.record(z.string(), z.string())),
});
export const readingSchema = z.object({
  documents: z.array(documentSchema).min(1),
  scope: z.string(),
  gaps: z.array(z.string()),
  media_note: z.string(),
});
export type Reading = z.infer<typeof readingSchema>;
export async function publicURL(url: string) {
  normalizeLink(url);
  const u = new URL(url),
    addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("This link resolves to a private network address.");
  return { url, addresses };
}
export async function fetchText(url: string): Promise<[string, string]> {
  for (let redirects = 0; redirects <= 8; redirects++) {
    const checked = await publicURL(url);
    const u = new URL(url);
    // Pin the validated DNS answer for this connection, including every redirect.
    const { request } = await import(u.protocol === "https:" ? "node:https" : "node:http");
    const response = await new Promise<{
      status: number;
      location?: string;
      mime: string;
      raw: Buffer;
    }>((resolve, reject) => {
      const req = request(
        u,
        {
          headers: { "User-Agent": "Noema/0.2 personal learning" },
          lookup: ((_host, _options, callback) => {
            if (_options.all) callback(null, checked.addresses);
            else {
              const first = checked.addresses[0];
              callback(null, first.address, isIP(first.address));
            }
          }) satisfies LookupFunction,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 4_000_000) {
              res.destroy(Error("This page is too large. Paste the section you want to study."));
            } else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode || 0,
              location: res.headers.location,
              mime: res.headers["content-type"] || "",
              raw: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.setTimeout(30000, () => req.destroy(Error("Source request timed out.")));
      req.on("error", reject);
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      url = new URL(response.location, url).href;
      continue;
    }
    if (response.status < 200 || response.status >= 300)
      throw Error("Source returned HTTP " + response.status);
    if (!["html", "text/plain", "json"].some((t) => response.mime.includes(t)))
      throw new NeedsInput("This link needs a text version. Paste an excerpt or link to HTML.");
    return [response.raw.toString("utf8"), url];
  }
  throw Error("Too many source redirects.");
}
export function document(url: string, raw: string, minWords = 60) {
  const p = extractArticle(raw),
    text = p.blocks.join("\n\n");
  if (text.split(/\s+/).length < minWords)
    throw new NeedsInput("There is too little readable text. Paste the post or article text.");
  return {
    url,
    title: p.title || new URL(unwrap(url)).pathname.split("/").pop()!.replaceAll("-", " "),
    text,
    sha256: sha(text),
    links: [
      ...new Set(
        p.links.flatMap((h) => {
          try {
            const u = new URL(h, unwrap(url));
            return ["http:", "https:"].includes(u.protocol) ? [u.href] : [];
          } catch {
            return [];
          }
        }),
      ),
    ].sort(),
    embeds: p.embeds,
  };
}
const socials = ["x.com", "twitter.com", "www.x.com", "www.twitter.com"];
const pageEntry = z
  .object({
    status: z.string(),
    text_file: z.string().optional(),
    text_sha256: z.string().optional(),
    capture: z.string().nullable().optional(),
    title: z.string().optional(),
    links: z.array(z.string()).optional(),
    embeds: z.array(z.record(z.string(), z.string())).optional(),
  })
  .passthrough();
export async function collect(item: Item, output: string, fetcher = fetchText): Promise<Reading> {
  await mkdir(output, { recursive: true });
  const saved = join(output, "reading.json");
  try {
    return readingSchema.parse(JSON.parse(await readFile(saved, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const documents: z.infer<typeof documentSchema>[] = [],
    gaps: string[] = [];
  let scope = "";
  const linked = async (url: string) => {
    try {
      const [raw, final] = await fetcher(url);
      documents.push(document(final, raw));
    } catch (e) {
      gaps.push(url + ": " + String(e));
    }
  };
  if (item.source_text) {
    const text = item.source_text;
    documents.push({
      url: item.url,
      title: "Text supplied with your link",
      text,
      sha256: sha(text),
      links: [],
      embeds: [],
    });
    scope = "The pasted excerpt only; the whole post, thread and linked pages were not read.";
  } else if (item.source_dir) {
    const corpus = resolve(item.source_dir),
      manifest = z
        .object({
          pages: z.record(z.string(), pageEntry),
          scope: z.string(),
          coverage: z.unknown(),
        })
        .parse(JSON.parse(await readFile(join(corpus, "manifest.json"), "utf8")));
    const seen = new Set<string>();
    for (const [url, e] of Object.entries(manifest.pages)) {
      const path = new URL(url).pathname.replace(/\/$/, "");
      if (seen.has(path) || ["/blog", ""].includes(path)) continue;
      seen.add(path);
      if (e.status !== "fetched") {
        gaps.push(url + ": " + e.status);
        continue;
      }
      if (!e.text_file) throw Error("Missing source text file");
      const file = resolve(corpus, e.text_file);
      if (relative(corpus, file).startsWith(".."))
        throw Error("Source file leaves the corpus directory");
      const text = await readFile(file, "utf8");
      documents.push({
        url: e.capture ? "https://web.archive.org/web/" + e.capture + "/" + url : url,
        title: e.title || path,
        text,
        sha256: e.text_sha256 || sha(text),
        links: e.links || [],
        embeds: e.embeds || [],
      });
    }
    try {
      documents.push(
        ...z
          .array(documentSchema)
          .parse(JSON.parse(await readFile(join(corpus, "background.json"), "utf8"))),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    scope = manifest.scope + " Archive discovery coverage: " + JSON.stringify(manifest.coverage);
  } else
    try {
      const u = new URL(item.url);
      if (socials.includes(u.hostname)) {
        const [raw] = await fetcher(
          "https://publish.twitter.com/oembed?" +
            new URLSearchParams({ url: item.url, omit_script: "true" }),
        );
        documents.push(
          document(item.url, z.object({ html: z.string() }).parse(JSON.parse(raw)).html, 12),
        );
        scope =
          "The single embedded post and up to two linked pages; thread and replies were not read.";
        for (const link of documents[0].links
          .filter((l) => !socials.includes(new URL(l).hostname))
          .slice(0, 2))
          await linked(link);
      } else if (u.hostname === "github.com" && u.pathname.split("/").filter(Boolean).length >= 2) {
        const [owner, repo, kind, revision, ...rest] = u.pathname.split("/").filter(Boolean),
          base = "https://api.github.com/repos/" + owner + "/" + repo;
        const [commitRaw] = await fetcher(
          base +
            "/commits/" +
            encodeURIComponent(["blob", "tree"].includes(kind) ? revision : "HEAD"),
        );
        const commit = z
          .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
          .parse(JSON.parse(commitRaw)).sha;
        const [treeRaw] = await fetcher(base + "/git/trees/" + commit + "?recursive=1");
        const tree = z
          .object({
            tree: z.array(
              z.object({ path: z.string(), type: z.string(), size: z.number().optional() }),
            ),
            truncated: z.boolean().optional(),
          })
          .parse(JSON.parse(treeRaw));
        const paths = tree.tree
            .filter((e) => e.type === "blob" && (e.size || 0) <= 50000)
            .map((e) => e.path),
          readmes = paths.filter((p) =>
            ["readme.md", "readme.rst", "readme"].includes(p.toLowerCase()),
          );
        let code = paths
          .filter(
            (p) =>
              /\.(py|ts|rs|go)$/.test(p) &&
              ["main", "entrypoint", "engine", "scheduler"].some((n) =>
                p.toLowerCase().includes(n),
              ),
          )
          .sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)
          .slice(0, 4);
        const requested = rest.join("/");
        if (kind === "blob" && paths.includes(requested))
          code = [requested, ...code.filter((p) => p !== requested).slice(0, 3)];
        for (const path of [...readmes.slice(0, 1), ...code]) {
          const link =
            "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + commit + "/" + path;
          try {
            const [text] = await fetcher(link);
            documents.push({
              url: "https://github.com/" + owner + "/" + repo + "/blob/" + commit + "/" + path,
              title: repo + " · " + path,
              text,
              sha256: sha(text),
              links: [],
              embeds: [],
            });
          } catch (e) {
            gaps.push(link + ": " + String(e));
          }
        }
        scope =
          "Repository " +
          owner +
          "/" +
          repo +
          " at commit " +
          commit +
          ": README and up to four selected entry/engine files. No code was executed. Other files and tests were not inspected.";
        if (tree.truncated) gaps.push("GitHub returned a truncated tree; discovery was partial.");
      } else {
        const [raw, final] = await fetcher(item.url);
        documents.push(document(final, raw));
        scope =
          "Submitted page plus up to four same-site article links; external references inventoried only.";
        const primary = documents[0],
          original = new URL(unwrap(final));
        const links = primary.links.filter((l) => {
          const u = new URL(l);
          return (
            u.hostname === original.hostname &&
            u.pathname !== original.pathname &&
            ["/blog/", "/posts/", "/articles/"].some((p) => u.pathname.includes(p))
          );
        });
        for (const link of links.slice(0, 4)) await linked(link);
        if (links.length > 4)
          gaps.push(links.length - 4 + " related links were outside this bounded read.");
      }
    } catch (e) {
      throw new NeedsInput(
        "Couldn’t read enough of this link. Paste the text to continue. " + String(e),
      );
    }
  const value = readingSchema.parse({
    documents: documents.map((d, i) => ({ ...d, id: "source" + (i + 1) })),
    scope,
    gaps,
    media_note:
      "Embedded videos were not transcribed; figure contents were not automatically interpreted.",
  });
  await writeFile(saved, JSON.stringify(value, null, 2) + "\n");
  return value;
}
const researchSchema = z
  .object({
    links: z.array(z.string()).max(6),
    background: z.array(z.string()).max(6),
  })
  .strict();
export type Ask = (prompt: string, schema: Record<string, unknown>) => Promise<unknown>;
// Widen a bounded read: the model picks from links the sources actually contain and names
// background topics; Noema fetches them. The model never browses or invents URLs.
export async function research(
  item: Item,
  reading: Reading,
  output: string,
  ask: Ask,
  fetcher = fetchText,
): Promise<Reading> {
  const saved = join(output, "research.json");
  try {
    return readingSchema.parse(JSON.parse(await readFile(saved, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (item.source_dir) return reading;
  const read = new Set(reading.documents.map((d) => unwrap(d.url))),
    candidates = [...new Set(reading.documents.flatMap((d) => d.links))]
      .filter((l) => !read.has(unwrap(l)) && !socials.includes(new URL(l).hostname))
      .slice(0, 150);
  const pick = researchSchema.parse(
    await ask(
      "You are choosing extra reading for a course built from the sources below. The learner's goal: " +
        (item.note || "understand this deeply, judge its claims and apply it") +
        "\nPick up to 6 URLs from CANDIDATE_LINKS (copy them exactly) that a learner needs: primary papers, documentation or posts the sources rely on. Skip navigation, sign-up, social and product pages. Then name up to 6 English Wikipedia article titles for prerequisite concepts the sources assume but do not explain. Prefer fewer, better choices.\n" +
        JSON.stringify({
          sources: reading.documents.map((d) => ({
            title: d.title,
            url: d.url,
            text: d.text.slice(0, 6000),
          })),
          candidate_links: candidates,
        }),
      z.toJSONSchema(researchSchema),
    ),
  );
  const documents = [...reading.documents],
    gaps = [...reading.gaps],
    add = async (url: string, label = url) => {
      try {
        const [raw, final] = await fetcher(url);
        documents.push(document(final, raw));
      } catch (e) {
        gaps.push(label + ": " + String(e));
      }
    };
  await Promise.all([
    ...pick.links.filter((l) => candidates.includes(l)).map((l) => add(l)),
    ...pick.background.map((title) =>
      add(
        "https://en.wikipedia.org/api/rest_v1/page/html/" +
          encodeURIComponent(title.trim().replaceAll(" ", "_")),
        "Wikipedia: " + title,
      ),
    ),
  ]);
  const added = documents.length - reading.documents.length;
  const value = readingSchema.parse({
    ...reading,
    documents: documents.map((d, i) => ({ ...d, id: "source" + (i + 1) })),
    gaps,
    scope:
      reading.scope +
      (added
        ? ` Background research added ${added} linked or reference page${added === 1 ? "" : "s"} chosen for this goal.`
        : ""),
  });
  await writeFile(saved, JSON.stringify(value, null, 2) + "\n");
  return value;
}
