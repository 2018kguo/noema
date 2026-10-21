// Sentences that show the LLM tells listed in skills/noema/references/writing.md. The
// editing pass gets them by name, which works better than asking a model to notice its own habits.
// Patterns aim at the shapes readers complain about and leave ordinary uses alone.
const TELLS: [string, RegExp][] = [
  // "X is not A, but B" and "not just A, but B"; a plain "does not say why, but" is fine.
  [
    "antithesis",
    /\b(?:is|are|was|were)(?:n['’]t| not) (?:just |only |merely )?(?:a |an |the )?[^.;,]{1,40}(?:, but (?:a|an|the|it)\b|[,;] it['’]s)|\bnot (?:just|only|merely) [^.;,]{1,40}, but\b/i,
  ],
  ["rather than", /\brather than\b/i],
  // A count that announces what follows ("Three changes." / "There are two problems:").
  [
    "announced count",
    /^(?:Two|Three|Four|Five) [a-z]+(?: [a-z]+)?[.:]|\bthere are (?:two|three|four|five) [a-z]+[.:]/i,
  ],
  ["colon or semicolon pivot", /[;:] (?:in practice|but|so|and the|that is)\b/i],
  [
    "signature word",
    /\b(?:honest(?:ly)?|load-bearing|the trap|full stop|quietly|crucial|pivotal|underscores?|leverag(?:e|es|ing)|multifaceted|worth noting|serves as|stands as)\b/i,
  ],
  [
    "teaser",
    /^(?:The (?:harder|real|key|bigger) (?:question|problem|issue)|Several problems remain|Read the [^.]+ for what)/i,
  ],
];
export function tells(html: string) {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z“"])/)
    .flatMap((sentence) =>
      TELLS.filter(([, re]) => re.test(sentence)).map(([kind]) => ({ kind, sentence })),
    );
}
// How much of a text is calculation: operators between numbers, equals signs, multiplication.
export const arithmetic = (text: string) =>
  (text.match(/[0-9][0-9.,]*\s*(?:×|÷|\/|=|\*|−|\+)\s*[0-9(]|[×÷=]/g) || []).length;
