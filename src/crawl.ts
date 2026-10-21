import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { canonical, unwrap, extractArticle } from "./html";
import { sha } from "./grade";
import { fetchText } from "./source-reader";
const entrySchema = z
  .object({
    status: z.enum(["pending", "fetched", "unavailable", "outside_article_scope"]),
    discovered_by: z.array(z.string()),
    error: z.string().optional(),
  })
  .passthrough();
const manifestSchema = z.object({
  seed: z.string(),
  archive_at: z.string().nullable(),
  prefix: z.string(),
  scope: z.string(),
  index: z.object({ status: z.string().optional() }).passthrough(),
  pages: z.record(z.string(), entrySchema),
  references: z.record(z.string(), entrySchema),
  coverage: z.unknown().optional(),
});
type Manifest = z.infer<typeof manifestSchema>;
export class Crawler {
  data: Manifest;
  readonly seed: string;
  readonly host: string;
  constructor(
    seed: string,
    readonly out: string,
    readonly timestamp: string | null = null,
    readonly prefix = "/blog",
    readonly fetcher = fetchText,
    readonly delay = 700,
    readonly attempts = 3,
  ) {
    const normalized = canonical(seed);
    if (!normalized) throw Error("Choose a public article URL.");
    this.seed = normalized;
    this.host = new URL(normalized).hostname.replace(/^www\./, "");
    this.data = {
      seed: normalized,
      archive_at: timestamp,
      prefix,
      scope:
        "Nearest available captures; archive index plus all reachable same-site article links under prefix; external references inventoried only.",
      index: {},
      pages: {},
      references: {},
    };
  }
  async request(url: string): Promise<[string, string]> {
    let failure: unknown;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      if (this.delay) await Bun.sleep(this.delay * (attempt + 1));
      try {
        return await this.fetcher(url);
      } catch (error) {
        failure = error;
      }
    }
    throw failure instanceof Error ? failure : Error(String(failure));
  }
  async load() {
    await mkdir(this.out, { recursive: true });
    try {
      const data = manifestSchema.parse(
        JSON.parse(await readFile(join(this.out, "manifest.json"), "utf8")),
      );
      if (
        data.seed !== this.seed ||
        data.archive_at !== this.timestamp ||
        data.prefix !== this.prefix
      )
        throw Error("Output directory belongs to a different crawl");
      this.data = data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return this;
  }
  add(input: string, by: string) {
    const url = canonical(input);
    if (!url) return;
    const u = new URL(url),
      inside =
        u.hostname.replace(/^www\./, "") === this.host &&
        (u.pathname === this.prefix || u.pathname.startsWith(this.prefix + "/"));
    const bucket = inside ? this.data.pages : this.data.references;
    const entry = bucket[url] || {
      status: inside ? "pending" : "outside_article_scope",
      discovered_by: [],
    };
    if (!entry.discovered_by.includes(by)) entry.discovered_by.push(by);
    bucket[url] = entry;
  }
  async discoverIndex() {
    if (!this.timestamp) return;
    const url =
      "https://web.archive.org/cdx/search/cdx?" +
      new URLSearchParams({
        url: this.host + this.prefix + "*",
        output: "json",
        filter: "statuscode:200",
        collapse: "urlkey",
      });
    try {
      const [raw] = await this.request(url),
        rows = z.array(z.array(z.string())).parse(JSON.parse(raw));
      this.data.index = { status: "fetched", url, entries: rows.length - 1 };
      for (const row of rows.slice(1)) this.add(row[2], "archive-index");
    } catch (e) {
      this.data.index = { status: "unavailable", url, error: String(e) };
    }
  }
  async capture(url: string) {
    const [raw] = await this.request(
      "https://archive.org/wayback/available?" +
        new URLSearchParams({ url, timestamp: this.timestamp! }),
    );
    const value = z
      .object({
        archived_snapshots: z.object({
          closest: z
            .object({ available: z.boolean(), timestamp: z.string(), url: z.string() })
            .optional(),
        }),
      })
      .parse(JSON.parse(raw));
    const c = value.archived_snapshots.closest;
    if (!c?.available) throw Error("No available archive capture");
    return {
      target: "https://web.archive.org/web/" + c.timestamp + "id_/" + unwrap(c.url),
      stamp: c.timestamp,
    };
  }
  async fetchPage(url: string, entry: z.infer<typeof entrySchema>) {
    try {
      const { target, stamp } = this.timestamp
        ? await this.capture(url)
        : { target: url, stamp: null };
      const [raw, final] = await this.request(target),
        p = extractArticle(raw),
        text = p.blocks.join("\n\n");
      if (text.length < 200) throw Error("Too little readable text; inspect manually");
      const key = sha(url).slice(0, 16);
      await writeFile(join(this.out, key + ".html"), raw);
      await writeFile(join(this.out, key + ".txt"), text);
      const links = [
        ...new Set(
          p.links.flatMap((h) => {
            try {
              const u = canonical(new URL(unwrap(h), url).href);
              return u ? [u] : [];
            } catch {
              return [];
            }
          }),
        ),
      ].sort();
      Object.assign(entry, {
        status: "fetched",
        title: p.title,
        capture: stamp,
        fetched_url: final,
        raw_sha256: sha(raw),
        text_sha256: sha(text),
        text_file: key + ".txt",
        html_file: key + ".html",
        words: text.split(/\s+/).length,
        links,
        embeds: p.embeds,
        figures: p.figures,
      });
      delete entry.error;
      for (const link of links) this.add(link, url);
    } catch (e) {
      entry.status = "unavailable";
      entry.error = String(e);
    }
    await this.save();
  }
  async save() {
    const entries = Object.values(this.data.pages),
      count = (state: string) => entries.filter((e) => e.status === state).length,
      indexOk = !this.timestamp || this.data.index.status === "fetched";
    this.data.coverage = {
      kind: entries.every((e) => e.status === "fetched") && indexOk ? "complete" : "partial",
      settled: count("pending") === 0,
      pages: entries.length,
      fetched: count("fetched"),
      unavailable: count("unavailable"),
      pending: count("pending"),
      index_checked: indexOk,
      external_references: Object.keys(this.data.references).length,
    };
    await writeFile(join(this.out, "manifest.json"), JSON.stringify(this.data, null, 2) + "\n");
  }
  async run(retry = false) {
    await this.load();
    this.add(this.seed, "user");
    this.add(new URL(this.prefix, this.seed).href, "blog-index");
    await this.discoverIndex();
    if (retry)
      for (const e of Object.values(this.data.pages))
        if (e.status === "unavailable") e.status = "pending";
    while (true) {
      const pair = Object.entries(this.data.pages).find(([, e]) => e.status === "pending");
      if (!pair) break;
      await this.fetchPage(...pair);
      console.log(pair[1].status, pair[0]);
    }
    await this.save();
    return this.data.coverage;
  }
}
