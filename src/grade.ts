import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { runStructured } from "./structured-cli";
import { type Assessment } from "./course";
import { SYSTEM } from "./grader-prompt";
export const verdicts = ["met", "partial", "missing", "unclear"] as const;
const gradeSchema = z
  .object({
    criteria: z.array(
      z
        .object({
          id: z.string(),
          verdict: z.enum(verdicts),
          evidence: z.string(),
          feedback: z.string(),
        })
        .strict(),
    ),
    summary: z.string().max(5000),
    follow_up: z.string().max(5000),
  })
  .strict();
export const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function validateGrade(raw: unknown, challenge: Assessment, answer: string) {
  const grade = gradeSchema.parse(raw),
    expected = new Set(challenge.criteria.map((c) => c.id)),
    seen = new Set<string>();
  if (grade.criteria.length !== expected.size)
    throw Error("Grader omitted criteria; no grade recorded.");
  for (const row of grade.criteria) {
    if (!expected.has(row.id) || seen.has(row.id))
      throw Error("Unknown or duplicate grader criterion.");
    seen.add(row.id);
    if (
      ["met", "partial"].includes(row.verdict) &&
      (!row.evidence || !answer.includes(row.evidence))
    )
      throw Error("Grader evidence was not an exact quote from the answer; no grade recorded.");
  }
  return grade;
}
export function schemaFor(c: Assessment) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      criteria: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", enum: c.criteria.map((r) => r.id) },
            verdict: { type: "string", enum: verdicts },
            evidence: { type: "string" },
            feedback: { type: "string" },
          },
          required: ["id", "verdict", "evidence", "feedback"],
        },
      },
      summary: { type: "string" },
      follow_up: { type: "string" },
    },
    required: ["criteria", "summary", "follow_up"],
  };
}
export async function selectedContext(c: Assessment, repo?: string) {
  if (!repo) return { excerpts: [], note: "Exercise context only; no live repository configured." };
  repo = await realpath(repo);
  const excerpts = [];
  for (const selected of c.repo_paths) {
    const path = await realpath(join(repo, selected)),
      rel = relative(repo, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw Error("Configured repo lacks the selected context file: " + selected);
    const raw = await readFile(path);
    if (raw.length > 400000) throw Error("Selected context file exceeds the bounded read limit.");
    excerpts.push({
      path: selected,
      span: "first 210 lines, capped at 18000 characters",
      sha256: sha(raw),
      text: raw.toString().split(/\r?\n/).slice(0, 210).join("\n").slice(0, 18000),
    });
  }
  return {
    excerpts,
    note: "Selected live file excerpts; illustrative patch assumptions remain part of the exercise.",
  };
}
export async function postProvider(path: string, body: unknown) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw Error("Set OPENROUTER_API_KEY in the server environment, then restart.");
  const response = await fetch("https://openrouter.ai/api/" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(100000),
  });
  if (!response.ok)
    throw Error(
      "OpenRouter returned HTTP " +
        response.status +
        "; check key, model support and account balance.",
    );
  return response.json();
}
export async function assess(
  c: Assessment,
  answer: string,
  provider: string,
  model: string,
  repo?: string,
  contentRevision = "",
) {
  const { excerpts, note } = await selectedContext(c, repo),
    payload = {
      exercise: { title: c.title, prompt: c.prompt, artifact: c.artifact, context: c.context },
      criteria: c.criteria,
      selected_source_excerpts: excerpts,
      context_note: note,
      learner_answer: answer,
    };
  const start = performance.now(),
    schema = schemaFor(c);
  let raw: unknown,
    meta: { provider: string; model: string; [key: string]: unknown } = {
      provider,
      model: model || "CLI default",
    };
  if (["codex", "claude"].includes(provider)) {
    raw = await runStructured(
      provider,
      model,
      SYSTEM +
        "\nRequired schema:\n" +
        JSON.stringify(schema) +
        "\nAssessment data:\n" +
        JSON.stringify(payload),
      schema,
    );
    meta.usage = "CLI account limits/billing apply; not a free API entitlement.";
  } else if (provider === "openrouter") {
    if (!model) throw Error("Choose a structured-output-capable model with --model MODEL_ID.");
    const response = z
      .object({
        model: z.string().optional(),
        usage: z.unknown().optional(),
        choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
      })
      .parse(
        await postProvider("v1/chat/completions", {
          model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: JSON.stringify(payload) },
          ],
          max_tokens: 1800,
          response_format: {
            type: "json_schema",
            json_schema: { name: "learning_grade", strict: true, schema },
          },
          provider: { require_parameters: true },
        }),
      );
    raw = JSON.parse(response.choices[0].message.content);
    meta = { provider, model: response.model || model, usage: response.usage || {} };
  } else if (provider === "jev") {
    const questions = Object.fromEntries(
      c.criteria.map((r) => [
        r.id,
        {
          type: "noul",
          instructions:
            "Does learner_answer satisfy this criterion without contradicting the exercise assumptions? " +
            r.rule,
          criteria: {
            true: "The answer explicitly demonstrates the required reasoning correctly.",
            false:
              "The required reasoning is missing, incorrect, contradicted, or only asserted without explanation.",
          },
        },
      ]),
    );
    const response = z
      .object({
        answers: z.record(
          z.string(),
          z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
        ),
        model: z.string().optional(),
        usage: z.unknown().optional(),
      })
      .parse(
        await postProvider("alpha/decisions", {
          model: model || "typesafe/jev-1.13",
          state: payload,
          questions,
        }),
      );
    if (
      Object.keys(response.answers).length !== c.criteria.length ||
      c.criteria.some((r) => !response.answers[r.id])
    )
      throw Error("Jev returned missing/unknown criteria.");
    const probabilities = Object.fromEntries(
      c.criteria.map((r) => [r.id, response.answers[r.id].noul]),
    );
    raw = {
      criteria: c.criteria.map((r) => ({
        id: r.id,
        verdict: "unclear",
        evidence: "",
        feedback:
          "Model probability criterion is satisfied: " +
          probabilities[r.id].toFixed(3) +
          ". Uncalibrated; " +
          r.feedback,
      })),
      summary:
        "Jev supplies provisional criterion probabilities, not written explanations or mastery decisions. Compare to the rubric and request a generative review for disputed cases.",
      follow_up: c.follow_up,
    };
    meta = { provider, model: response.model || model, probabilities, usage: response.usage || {} };
  } else
    throw Error(
      "No live grader enabled. Restart with --provider codex, claude, openrouter or jev.",
    );
  const grade = validateGrade(raw, c, answer);
  return {
    grade,
    meta: {
      ...meta,
      seconds: Math.round((performance.now() - start) / 10) / 100,
      context: excerpts.map(({ path, span, sha256 }) => ({ path, span, sha256 })),
      context_note: note,
      answer_sha256: sha(answer),
      rubric_sha256: sha(JSON.stringify(c)),
      content_revision: contentRevision,
      exercise_revision: c.revision || contentRevision,
    },
  };
}
