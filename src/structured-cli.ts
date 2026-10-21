import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
export class Cancelled extends Error {}
export async function runStructured(
  provider: string,
  model: string,
  prompt: string,
  schema: Record<string, unknown>,
  timeout = 150,
  cancelled = () => false,
): Promise<unknown> {
  const work = await mkdtemp(join(tmpdir(), "noema-model-"));
  let command: string[];
  try {
    if (provider === "codex") {
      await writeFile(join(work, "schema.json"), JSON.stringify(schema));
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
        'web_search="disabled"',
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
        "",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--no-session-persistence",
        "--disable-slash-commands",
        "--settings",
        '{"disableAllHooks":true}',
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
      child.stderr.resume();
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
          else
            reject(
              Error(
                provider +
                  " exited with status " +
                  code +
                  ". Check CLI login, model access and usage limits.",
              ),
            );
        }
      });
    });
    if (provider === "codex") return JSON.parse(await readFile(join(work, "result.json"), "utf8"));
    const envelope = z
      .object({
        is_error: z.boolean().optional(),
        structured_output: z.unknown().optional(),
        result: z.string().optional(),
      })
      .parse(JSON.parse(stdout));
    if (envelope.is_error)
      throw Error("Claude reported an error. Check CLI login and account limits.");
    if (envelope.structured_output !== undefined) return envelope.structured_output;
    if (envelope.result) return JSON.parse(envelope.result);
    throw Error("Claude did not return a structured result.");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
