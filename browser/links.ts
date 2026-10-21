// A quoted citation links with a text fragment (#:~:text=), so the source opens scrolled to
// and highlighting the passage. Long quotes use start,end so small source edits still match.
export function textFragment(quote: string) {
  const enc = (t: string) => encodeURIComponent(t).replace(/-/g, "%2D").replace(/,/g, "%2C"),
    words = quote.trim().split(/\s+/);
  return (
    ":~:text=" +
    (words.length > 12
      ? enc(words.slice(0, 5).join(" ")) + "," + enc(words.slice(-5).join(" "))
      : enc(words.join(" ")))
  );
}
export const sourceHref = (url: string, quote?: string) =>
  quote ? url + (url.includes("#") ? "" : "#") + textFragment(quote) : url;
