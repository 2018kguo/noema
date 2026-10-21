import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import ipaddr from "ipaddr.js";
export const active = ["researching", "writing", "checking"] as const;
export const stateSchema = z.enum([
  "queued",
  ...active,
  "ready",
  "needs_input",
  "failed",
  "cancelled",
]);
export type ItemState = z.infer<typeof stateSchema>;
export const itemSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  note: z.string(),
  source_text: z.string(),
  source_dir: z.string().nullable(),
  state: stateSchema,
  message: z.string(),
  created: z.number(),
  updated: z.number(),
  owner: z.string().nullable(),
  lease_until: z.number().nullable(),
  course_path: z.string().nullable(),
  revision: z.number(),
});
export type Item = z.infer<typeof itemSchema>;
export const settingsSchema = z.object({
  provider: z.enum(["none", "claude", "codex"]),
  model: z.string().max(120),
  enabled: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export function publicAddress(address: string) {
  try {
    const ip = ipaddr.process(address.replace(/^\[|\]$/g, ""));
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export function normalizeLink(value: string) {
  if (typeof value !== "string" || value.length > 4000) throw Error("Paste a valid link.");
  const u = new URL(value.trim());
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port)) ||
    !u.hostname.includes(".")
  )
    throw Error("Use a public http or https link.");
  if (ipaddr.isValid(u.hostname.replace(/^\[|\]$/g, "")) && !publicAddress(u.hostname))
    throw Error("Use a public web page link.");
  if (["localhost", "localhost.localdomain"].includes(u.hostname))
    throw Error("Use a public web page link.");
  if (["www.twitter.com", "twitter.com", "www.x.com"].includes(u.hostname)) u.hostname = "x.com";
  for (const key of [...u.searchParams.keys()])
    if (key.startsWith("utm_") || (u.hostname === "x.com" && ["s", "t", "ref_src"].includes(key)))
      u.searchParams.delete(key);
  u.hash = "";
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString().replace(/\/$/, "") + (u.pathname === "/" && !u.search ? "/" : "");
}
const now = () => Date.now() / 1000;
export class InboxStore {
  readonly root: string;
  readonly db: Database;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
    this.db = new Database(join(this.root, "inbox.sqlite3"), { strict: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
 CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,title TEXT NOT NULL,note TEXT NOT NULL,source_text TEXT NOT NULL,source_dir TEXT,state TEXT NOT NULL,message TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,owner TEXT,lease_until REAL,course_path TEXT,revision INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS events(item_id TEXT NOT NULL,at REAL NOT NULL,state TEXT NOT NULL,message TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),provider TEXT NOT NULL,model TEXT NOT NULL,enabled INTEGER NOT NULL);
 INSERT OR IGNORE INTO settings VALUES(1,'none','',0);`);
  }
  close() {
    this.db.close();
  }
  settings(): Settings {
    const s = z
      .object({ provider: settingsSchema.shape.provider, model: z.string(), enabled: z.number() })
      .parse(this.db.query("SELECT provider,model,enabled FROM settings WHERE id=1").get());
    return { ...s, enabled: !!s.enabled };
  }
  configure(provider: Settings["provider"], model: string, enabled: boolean) {
    const s = settingsSchema.parse({ provider, model, enabled });
    if (s.enabled && s.provider === "none")
      throw Error("Choose Claude or Codex before starting the queue.");
    this.db
      .query("UPDATE settings SET provider=?,model=?,enabled=? WHERE id=1")
      .run(s.provider, s.model.trim(), Number(s.enabled));
    return this.settings();
  }
  add(
    url: string,
    note = "",
    source_text = "",
    source_dir: string | null = null,
  ): { item: Item; fresh: boolean } {
    url = normalizeLink(url);
    z.string().max(4000).parse(note);
    z.string().max(100000).parse(source_text);
    return this.db
      .transaction(() => {
        const old = this.db.query("SELECT * FROM items WHERE url=?").get(url);
        if (old) return { item: itemSchema.parse(old), fresh: false };
        const id = randomUUID().replaceAll("-", "").slice(0, 16),
          at = now(),
          u = new URL(url);
        this.db
          .query(
            "INSERT INTO items(id,url,title,note,source_text,source_dir,state,message,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            url,
            u.hostname + u.pathname,
            note.trim(),
            source_text.trim(),
            source_dir,
            "queued",
            "Waiting to be prepared.",
            at,
            at,
          );
        this.event(id, "queued", "Added to your inbox.", at);
        return { item: this.get(id), fresh: true };
      })
      .immediate();
  }
  get(id: string): Item {
    const row = this.db.query("SELECT * FROM items WHERE id=?").get(id);
    if (!row) throw Error("This inbox item no longer exists.");
    return itemSchema.parse(row);
  }
  list() {
    return z
      .array(itemSchema)
      .parse(this.db.query("SELECT * FROM items ORDER BY created DESC").all());
  }
  events(id: string) {
    return this.db.query("SELECT at,state,message FROM events WHERE item_id=? ORDER BY at").all(id);
  }
  private event(id: string, state: string, message: string, at = now()) {
    this.db.query("INSERT INTO events VALUES(?,?,?,?)").run(id, at, state, message);
  }
  claim(owner: string, at = now()): Item | null {
    return this.db
      .transaction(() => {
        if (
          this.db
            .query(
              "SELECT 1 FROM items WHERE state IN ('researching','writing','checking') AND lease_until>?",
            )
            .get(at)
        )
          return null;
        const raw = this.db
          .query(
            "SELECT * FROM items WHERE state='queued' OR(state IN ('researching','writing','checking') AND lease_until<=?) ORDER BY created LIMIT 1",
          )
          .get(at);
        if (!raw) return null;
        const row = itemSchema.parse(raw);
        this.db
          .query(
            "UPDATE items SET state='researching',message='Reading the source and its context.',owner=?,lease_until=?,updated=? WHERE id=?",
          )
          .run(owner, at + 60, at, row.id);
        this.event(row.id, "researching", "Reading the source and its context.", at);
        return this.get(row.id);
      })
      .immediate();
  }
  heartbeat(id: string, owner: string) {
    const at = now();
    return (
      this.db
        .query(
          "UPDATE items SET lease_until=? WHERE id=? AND owner=? AND state IN ('researching','writing','checking') AND lease_until>?",
        )
        .run(at + 60, id, owner, at).changes === 1
    );
  }
  owned(id: string, owner: string) {
    const i = this.get(id);
    return i.owner === owner && active.some((s) => s === i.state) && (i.lease_until || 0) > now();
  }
  advance(
    id: string,
    owner: string,
    state: Exclude<ItemState, "cancelled">,
    message: string,
    title?: string,
    coursePath?: string,
  ) {
    return this.db
      .transaction(() => {
        if (!this.owned(id, owner)) return false;
        const i = this.get(id),
          done = !active.some((s) => s === state);
        this.db
          .query(
            "UPDATE items SET state=?,message=?,updated=?,title=?,course_path=?,owner=?,lease_until=? WHERE id=?",
          )
          .run(
            state,
            message,
            now(),
            title || i.title,
            coursePath || i.course_path,
            done ? null : owner,
            done ? null : now() + 60,
            id,
          );
        this.event(id, state, message);
        return true;
      })
      .immediate();
  }
  action(id: string, action: string, sourceText?: string) {
    return this.db
      .transaction(() => {
        const i = this.get(id);
        let state: ItemState, message: string;
        if (action === "cancel" && ["queued", ...active].includes(i.state)) {
          state = "cancelled";
          message = "Preparation stopped. You can retry it later.";
        } else if (
          ["retry", "provide_text"].includes(action) &&
          ["failed", "needs_input", "cancelled"].includes(i.state)
        ) {
          if (action === "provide_text") z.string().trim().min(100).max(100000).parse(sourceText);
          state = "queued";
          message = "Waiting to be prepared.";
        } else throw Error("This action is not available for the item’s current state.");
        this.db
          .query(
            "UPDATE items SET state=?,message=?,source_text=?,revision=?,updated=?,owner=NULL,lease_until=NULL WHERE id=?",
          )
          .run(
            state,
            message,
            action === "provide_text" ? sourceText!.trim() : i.source_text,
            i.revision + Number(action === "provide_text"),
            now(),
            id,
          );
        this.event(id, state, message);
        return this.get(id);
      })
      .immediate();
  }
  projection(i: Item) {
    return {
      id: i.id,
      url: i.url,
      title: i.title,
      note: i.note,
      state: i.state,
      message: i.message,
      created: i.created,
      updated: i.updated,
      course_url: i.state === "ready" ? "/learn/" + i.id + "/" : null,
    };
  }
}
