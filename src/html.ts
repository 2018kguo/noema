import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
type Node = DefaultTreeAdapterMap["node"];
export const paragraphCount = (html: string) =>
  parseFragment(html).childNodes.filter((n) => "tagName" in n && n.tagName === "p").length;
const hidden = new Set(["script", "style", "svg", "noscript", "iframe"]);
export const escapeHTML = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function extractArticle(html: string) {
  const blocks: string[] = [],
    links: string[] = [],
    embeds: Record<string, string>[] = [],
    figures: Record<string, string>[] = [];
  let current = "",
    title = "";
  const flush = () => {
    const t = current.replace(/\s+/g, " ").trim();
    if (t && !blocks.includes(t)) blocks.push(t);
    current = "";
  };
  const boundaries = new Set([
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "li",
    "blockquote",
    "tr",
    "br",
    "div",
    "section",
    "article",
  ]);
  function walk(n: Node, inTitle = false) {
    if ("tagName" in n) {
      const tag = n.tagName,
        attrs = Object.fromEntries(n.attrs.map((a) => [a.name, a.value]));
      if (["iframe", "video", "source"].includes(tag))
        embeds.push({
          tag,
          ...Object.fromEntries(
            Object.entries(attrs).filter(([k]) => ["src", "title"].includes(k)),
          ),
        });
      if (tag === "img")
        figures.push(
          Object.fromEntries(Object.entries(attrs).filter(([k]) => ["src", "alt"].includes(k))),
        );
      if (hidden.has(tag)) return;
      if (boundaries.has(tag)) flush();
      if (tag === "a" && attrs.href) links.push(attrs.href);
      if ("childNodes" in n)
        for (const child of n.childNodes) walk(child, inTitle || tag === "title");
      if (boundaries.has(tag)) flush();
    } else if (n.nodeName === "#text" && "value" in n) {
      if (inTitle) title += n.value;
      else current += " " + n.value;
    } else if ("childNodes" in n) for (const child of n.childNodes) walk(child, inTitle);
  }
  walk(parse(html));
  flush();
  return { blocks, links, embeds, figures, title: title.trim() };
}
// Hover links survive sanitizing: <dfn data-term> and <a data-source> (no href; the reader adds
// it from SOURCES). With `refs`, marks that point nowhere are unwrapped to plain text.
export function cleanHTML(
  value: string,
  refs?: {
    terms: Set<string>;
    sources: Set<string>;
    quoted?: (id: string, quote: string) => boolean;
  },
) {
  const allowed = new Set([
    "p",
    "h2",
    "h3",
    "h4",
    "strong",
    "b",
    "em",
    "i",
    "ul",
    "ol",
    "li",
    "code",
    "pre",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "br",
  ]);
  function walk(n: Node): string {
    if ("tagName" in n) {
      if (hidden.has(n.tagName)) return "";
      const content = "childNodes" in n ? n.childNodes.map(walk).join("") : "";
      const mark = { dfn: "data-term", a: "data-source" }[n.tagName];
      if (mark) {
        const target = n.attrs.find((a) => a.name === mark)?.value || "",
          known = refs ? (mark === "data-term" ? refs.terms : refs.sources).has(target) : true;
        // A quote is kept only when it appears in that source, so its highlight link resolves.
        const quote = n.attrs.find((a) => a.name === "data-quote")?.value.trim() || "",
          keepQuote =
            mark === "data-source" &&
            quote.length <= 300 &&
            !!quote &&
            (refs?.quoted ? refs.quoted(target, quote) : true);
        return target && known && target.length <= 120
          ? `<${n.tagName} ${mark}="${escapeHTML(target)}"${keepQuote ? ` data-quote="${escapeHTML(quote)}"` : ""}>${content}</${n.tagName}>`
          : content;
      }
      return allowed.has(n.tagName)
        ? "<" + n.tagName + ">" + content + (n.tagName === "br" ? "" : "</" + n.tagName + ">")
        : content;
    }
    if (n.nodeName === "#text" && "value" in n) return escapeHTML(n.value);
    return "childNodes" in n ? n.childNodes.map(walk).join("") : "";
  }
  return walk(parseFragment(value));
}
export function unwrap(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.hostname === "web.archive.org" && u.pathname.startsWith("/web/"))
    return u.pathname.split("/").slice(3).join("/") + u.search;
  return url;
}
export function canonical(url: string) {
  try {
    const u = new URL(unwrap(url));
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return "https://" + u.host.toLowerCase() + (u.pathname.replace(/\/+$/, "") || "/");
  } catch {
    return null;
  }
}
