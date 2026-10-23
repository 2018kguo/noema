import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
export class Cancelled extends Error {}

// OpenAI's strict mode (Codex --output-schema) rejects oneOf and needs every key in `required`.
// The unions are split by a const `kind`, so anyOf means the same; optional keys become nullable,
// and `unstrict` drops the nulls they come back as so the original schema still parses the result.
type Schema = Record<string, any>;
export function strict(schema: Schema): Schema {
  if (Array.isArray(schema)) return schema.map(strict);
  if (!schema || typeof schema !== "object") return schema;
  const { oneOf, ...out } = Object.fromEntries(
    Object.entries(schema).map(([k, v]) => [k, strict(v)]),
  );
  if (oneOf) out.anyOf = oneOf;
  if (out.properties) {
    const required = new Set(schema.required || []);
    for (const k of Object.keys(out.properties))
      if (!required.has(k)) out.properties[k] = { anyOf: [out.properties[k], { type: "null" }] };
    out.required = Object.keys(out.properties);
  }
  return out;
}
export function unstrict(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value)) return value.map((v) => unstrict(v, schema.items || {}));
  if (!value || typeof value !== "object") return value;
  const flat = (s: Schema): Schema[] =>
    s.anyOf || s.oneOf ? (s.anyOf || s.oneOf).flatMap(flat) : [s];
  const branches = schema.anyOf || schema.oneOf ? flat(schema) : [];
  const obj = value as Record<string, unknown>;
  // The branch whose const `kind` matches, else the first object branch.
  const branch =
    branches.find((b) => b.properties?.kind?.const === obj.kind) ||
    branches.find((b) => b.properties) ||
    schema;
  if (branch !== schema) return unstrict(value, branch);
  const required = new Set(schema.required || []);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k, v]) => v !== null || required.has(k))
      .map(([k, v]) => [k, unstrict(v, schema.properties?.[k] || {})]),
  );
}
export async function runStructured(
  provider: string,
  model: string,
  prompt: string,
  schema: Record<string, unknown>,
  timeout = 150,
  cancelled = () => false,
  // Stable instructions. Claude gets them as its system prompt (replacing the coding-agent
  // default, which this task never uses) so every call shares one cached prefix.
  system = "",
  // Allow web search and nothing else (research only).
  search = false,
): Promise<unknown> {
  if (system && provider !== "claude") prompt = system + "\n\n" + prompt;
  // The Claude CLI rejects a `$schema` draft URI it can't resolve; the schema itself is unchanged.
  const { $schema: _draft, ...plain } = schema;
  schema = plain;
  const work = await mkdtemp(join(tmpdir(), "noema-model-"));
  let command: string[];
  try {
    if (system) await writeFile(join(work, "system.md"), system);
    if (provider === "codex") {
      await writeFile(join(work, "schema.json"), JSON.stringify(strict(schema)));
      command = [
        "codex",
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-schema",
        join(work, "schema.json"),
        "--output-last-message",
        join(work, "result.json"),
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.apply_patch_freeform=false",
        "-c",
        search ? 'web_search="live"' : 'web_search="disabled"',
        ...(model ? ["--model", model] : []),
        "-",
      ];
    } else if (provider === "claude")
      command = [
        "claude",
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(schema),
        "--tools",
        search ? "WebSearch" : "",
        ...(search ? ["--allowedTools", "WebSearch"] : []),
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--no-session-persistence",
        "--disable-slash-commands",
        "--settings",
        '{"disableAllHooks":true}',
        // A file, because a large argument exceeds Linux's per-argument limit.
        ...(system ? ["--system-prompt-file", join(work, "system.md")] : []),
        ...(model ? ["--model", model] : []),
      ];
    else throw Error("Choose the Codex or Claude CLI.");
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        cwd: work,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "",
        errors = "",
        bytes = 0,
        settled = false,
        stopping = false,
        stopReason: Error | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          /* The process has already exited. */
        }
      };
      const stop = (error: Error) => {
        if (stopping) return;
        stopping = true;
        stopReason = error;
        kill("SIGTERM");
        escalation = setTimeout(() => kill("SIGKILL"), 5000);
      };
      const pulse = setInterval(() => {
        if (cancelled()) stop(new Cancelled("Preparation stopped."));
      }, 250);
      const deadline = setTimeout(
        () => stop(Error("The model timed out. Check your CLI and retry.")),
        timeout * 1000,
      );
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8_000_000) stop(Error("Model output exceeded the limit."));
        else output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errors = (errors + chunk.toString()).slice(-2000);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
      child.on("error", (error) => {
        clearInterval(pulse);
        clearTimeout(deadline);
        if (escalation) clearTimeout(escalation);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("close", (code) => {
        clearInterval(pulse);
        clearTimeout(deadline);
        if (escalation) clearTimeout(escalation);
        if (!settled) {
          settled = true;
          if (stopReason) reject(stopReason);
          else if (code === 0) resolve(output);
          else {
            // Claude prints a JSON envelope with the real reason even when it exits non-zero.
            let reason = errors.trim();
            try {
              const parsed = JSON.parse(output);
              reason =
                [parsed.subtype, parsed.result, parsed.error].filter(Boolean).join(": ") ||
                reason ||
                output.trim().slice(-500);
            } catch {
              reason ||= output.trim().slice(-500);
            }
            reject(
              Error(
                // The CLIs echo the prompt first and print the error last.
                `${provider} exited with status ${code}${reason ? ": " + reason.slice(-400) : ""}`,
              ),
            );
          }
        }
      });
    });
    if (provider === "codex")
      return unstrict(JSON.parse(await readFile(join(work, "result.json"), "utf8")), schema);
    const envelope = z
      .object({
        is_error: z.boolean().optional(),
        structured_output: z.unknown().optional(),
        result: z.string().optional(),
        total_cost_usd: z.number().optional(),
        duration_ms: z.number().optional(),
        num_turns: z.number().optional(),
        usage: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(JSON.parse(stdout));
    // One line per call so token use and caching can be compared across changes.
    const u = envelope.usage || {};
    console.error(
      `[model] claude ${model || "default"} in=${u.input_tokens} cache_write=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} out=${u.output_tokens} thinking=${(u.output_tokens_details as { thinking_tokens?: number } | undefined)?.thinking_tokens ?? "?"} turns=${envelope.num_turns ?? "?"} $${envelope.total_cost_usd?.toFixed(3)} ${Math.round((envelope.duration_ms || 0) / 1000)}s prompt_chars=${prompt.length}`,
    );
    if (envelope.is_error)
      throw Error("Claude reported an error. Check CLI login and account limits.");
    if (envelope.structured_output !== undefined) return envelope.structured_output;
    if (envelope.result) return JSON.parse(envelope.result);
    throw Error("Claude did not return a structured result.");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
