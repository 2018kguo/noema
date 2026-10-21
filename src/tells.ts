// Sentences and headings that show the LLM tells listed in skills/noema/references/writing.md. The
// editing pass gets them by name, which works better than asking a model to notice its own habits.
// Shared with Sprout (github.com/2018kguo/sprout, src/style.ts); sources: Wikipedia "Signs of AI
// writing" and the tropes.fyi catalog. strong: reliably reads as machine-written, so the editor must
// rewrite it. weak: humans do it too; reported by `course inspect`, not forced.
// pair: the pattern spans two sentences ("X wasn't hard. Y was.").
export type Tell = { kind: string; re: RegExp; strong: boolean; fix: string; pair?: boolean };
const TELLS: Tell[] = [
  {
    kind: "antithesis",
    strong: true,
    re: /\b(?:it|this|that)(?:['’]s| is) not (?:just |only |about )?[^.;:!?]{1,60}[,;:.] (?:it|this|that)(?:['’]s| is)\b|\b(?:is|are|was|were)(?:n['’]t| not) (?:just |only |merely |about )?(?:a |an |the )?[^.;,]{1,40}(?:, but (?:a|an|the)\b|, but it['’]s\b|[,;] (?:it|they)['’](?:s|re)\b)|\bnot (?:just|only|merely) [^.;!?]{1,60},? but\b|^Not [^.!?]{1,40}\. Not\b/i,
    fix: "say what it is; mention what it isn't only when a reader would assume it",
  },
  {
    kind: "contrast reversal",
    strong: true,
    pair: true,
    re: /\b(?:was|is|were|are)(?: not|n['’]t) [^.!?]{1,40}[.!?] [A-Z]\w*(?: \w+){0,6} (?:was|is|were|are|did)[.!]/,
    fix: "drop the 'X wasn't hard. Y was.' reversal; say plainly what happened",
  },
  { kind: "rather than", strong: true, re: /\brather than\b/i, fix: "say what it is" },
  {
    kind: "announced count",
    strong: true,
    re: /^(?:Two|Three|Four|Five) [a-z]+(?: [a-z]+)?[.:]|\bthere are (?:two|three|four|five) [a-z]+[.:]/i,
    fix: "give the things; don't announce how many",
  },
  {
    kind: "colon or semicolon pivot",
    strong: true,
    re: /[;:] (?:in practice|but|so|and the|that is)\b/i,
    fix: "use the conjunction",
  },
  {
    kind: "flashcard opener",
    strong: true,
    re: /^(?:An?|The) (?:[\w'’-]+ ){0,3}(?:is|are) (?:the|an?|built|made|set|what|its|their) [^,;:]{0,40}(?:, [^,;:]{0,30})?\.$/,
    fix: "lead in from the previous idea and fold the definition into the sentence that uses it",
  },
  {
    kind: "teaser",
    strong: true,
    re: /^(?:The (?:harder|real|key|bigger) (?:question|problem|issue)|Several problems remain|Read the [^.]+ for what)/i,
    fix: "write the full sentence that carries the point",
  },
  {
    kind: "false suspense",
    strong: true,
    re: /\bhere['’]s (?:the|a) (?:thing|kicker|catch|twist|truth|deal|problem)\b|\bthe truth is\b|\bplot twist\b/i,
    fix: "make the point without announcing it",
  },
  {
    kind: "signposted ending",
    strong: true,
    re: /\b(?:in conclusion|in summary|to sum up|ultimately|at the end of the day|at its core|all in all|in short|the key takeaway)\b/i,
    fix: "end on the last real point",
  },
  {
    kind: "empty transition",
    strong: true,
    re: /\b(?:it['’]s|it is) (?:worth noting|important to note)|\b(?:importantly|notably|interestingly)\b|^(?:Additionally|Moreover|Furthermore)\b/i,
    fix: "cut the transition and say the next thing",
  },
  {
    kind: "significance tail",
    strong: true,
    re: /, (?:highlighting|underscoring|emphasizing|showcasing|reflecting|symbolizing|cementing|fostering|paving the way|marking)\b/i,
    fix: "drop the trailing clause that claims importance",
  },
  {
    kind: "copula avoidance",
    strong: true,
    re: /\b(?:serves|stands|acts|functions) as (?:a|an|the)\b|\bboasts\b/i,
    fix: "use plain 'is' or 'has'",
  },
  {
    kind: "teacher voice",
    strong: true,
    re: /\blet['’]s (?:break (?:this|it) down|unpack|dive|delve|explore)\b|\bthink of (?:it|them|this) (?:as|like)\b|\bimagine a world\b/i,
    fix: "talk to the reader as a peer; drop the lesson framing",
  },
  {
    kind: "challenges brush-off",
    strong: true,
    re: /\bdespite (?:these|the|its|their|such) challenges\b/i,
    fix: "describe the specific problem or leave it out",
  },
  {
    kind: "signature word",
    strong: true,
    re: /\b(?:honest(?:ly)?|load-bearing|the trap|full stop|quietly|crucial|pivotal|underscores?|leverag(?:e|es|ing)|multifaceted|delv\w*|tapestry|testament|landscape|realm|seamless\w*|game-?changer|unlock\w*|empower\w*)\b/i,
    fix: "use a plainer word",
  },
  {
    kind: "first-person narrator",
    strong: true,
    // Case-sensitive, so a variable named i ("position i read…") is not a narrator.
    re: /\b(?:[Mm]y (?:reading|estimate|guess|view|inference|interpretation|understanding)|I (?:think|estimate|infer|assume|read|believe))\b/,
    fix: "drop the narrator; say what the sources don't state and give the likely reason plainly",
  },
  {
    kind: "everyday analogy",
    strong: true,
    re: /\b(?:does|do) the same job\b|\bmuch like a\b|\bthe same way a \w+\b|\b(?:a|the) speed limit\b|\bthink of (?:a|the) (?:kitchen|highway|road|library)\b/i,
    fix: "explain with the real thing instead of a stand-in that needs explaining itself",
  },
  { kind: "em dash", strong: true, re: /—|\s–\s/, fix: "use a period, comma or parentheses" },
  {
    kind: "invented label",
    strong: false,
    re: /\bthe [a-z]+ (?:paradox|trap|fallacy)\b/i,
    fix: "describe the thing instead of naming it",
  },
  {
    kind: "magic adverb",
    strong: false,
    re: /\b(?:actually|really|deeply|remarkably|truly|genuinely|fundamentally|incredibly|profoundly)\b/i,
    fix: "cut the adverb or give the concrete detail",
  },
  {
    kind: "false range",
    strong: false,
    re: /\bfrom [^,.;]{1,30} to [^,.;]{1,30},? (?:to|and) [^,.;]{1,30}/i,
    fix: "name the actual things",
  },
  {
    kind: "AI vocabulary",
    strong: false,
    re: /\b(?:vibrant|intricate\w*|interplay|meticulous\w*|showcas\w*|garner\w*|bolster\w*|foster\w*|elevat\w*|ever-evolving|holistic|synergy|paradigm|robust|streamlin\w*)\b/i,
    fix: "use a plainer word",
  },
  { kind: "decorative arrow", strong: false, re: /[→⟶⇒]/, fix: "write it out in words" },
];
// Headings and titles have their own habits: flourishes, hedges and tidy lists of three.
const TITLE_TELLS: Tell[] = [
  {
    kind: "cute title",
    strong: true,
    re: /\bwithout (?:the|getting) (?:fog|jargon|hype|magic|mystery|lost|tears|headache)\b|\bdemystified\b|\bunder the hood\b|\bin plain English\b|\bthe hard way\b|, explained$|\bmore than (?:a|an|just)\b|\bactually\b/i,
    fix: "name the topic plainly",
  },
  {
    kind: "list of three",
    strong: true,
    re: /^[^,:]+, (?!with\b|without\b|or\b)[^,:]+,? and [^,]+$|: [^,]+, [^,:]+,? and [^,]+$/,
    fix: "name the one thing the topic is about",
  },
];

export type Hit = { kind: string; sentence: string; strong: boolean; fix: string };
const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
export function tells(html: string): Hit[] {
  const sentences = strip(html).split(/(?<=[.!?])\s+(?=[A-Z“"])/);
  const hits = sentences.flatMap((sentence) =>
    TELLS.filter((t) => !t.pair && t.re.test(sentence)).map(({ kind, strong, fix }) => ({
      kind,
      sentence,
      strong,
      fix,
    })),
  );
  // Three fragments of up to three words in a row read as drama.
  const short = (x?: string) => !!x && x.split(" ").length <= 3;
  sentences.forEach((s, i) => {
    // "The result? Chaos." A short rhetorical question answered at once.
    const next = sentences[i + 1];
    for (const t of TELLS)
      if (t.pair && next && t.re.test(s + " " + next))
        hits.push({ kind: t.kind, sentence: s + " " + next, strong: t.strong, fix: t.fix });
    if (/\?$/.test(s) && s.split(" ").length <= 5 && next && next.split(" ").length <= 5)
      hits.push({
        kind: "question, instant answer",
        sentence: s + " " + next,
        strong: true,
        fix: "say the answer as a plain statement",
      });
    if (short(s) && short(sentences[i + 1]) && short(sentences[i + 2]) && !short(sentences[i - 1]))
      hits.push({
        kind: "staccato fragments",
        sentence: sentences.slice(i, i + 3).join(" "),
        strong: false,
        fix: "join the fragments into real sentences",
      });
  });
  return hits;
}
export const titleTells = (title: string): Hit[] =>
  [...TITLE_TELLS, ...TELLS.filter((t) => t.strong)]
    .filter((t) => t.re.test(strip(title)))
    .map(({ kind, strong, fix }) => ({ kind, sentence: title, strong, fix }));
// Share of a text's four-word phrases already used in earlier text: a level that rephrases the
// one before scores high; one that covers new ground stays low.
const grams = (html: string) => {
  const w =
    strip(html)
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  return new Set(w.slice(3).map((_, i) => w.slice(i, i + 4).join(" ")));
};
export function repetition(html: string, earlier: string) {
  const mine = grams(html),
    before = grams(earlier);
  return mine.size ? +([...mine].filter((g) => before.has(g)).length / mine.size).toFixed(2) : 0;
}
// How much of a text is calculation: operators between numbers, equals signs, multiplication.
export const arithmetic = (text: string) =>
  (text.match(/[0-9][0-9.,]*\s*(?:×|÷|\/|=|\*|−|\+)\s*[0-9(]|[×÷=]/g) || []).length;
