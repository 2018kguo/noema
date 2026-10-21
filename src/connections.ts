// Reports whether each CLI is installed and signed in. Logins stay in the CLIs; Noema never stores tokens.
export type Connection = {
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  method: string | null;
  fix: string | null;
};
type Runner = (cmd: string[]) => Promise<{ code: number; out: string }>;

const run: Runner = async (cmd) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => p.kill(), 10000);
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  clearTimeout(timer);
  return { code: await p.exited, out: (out + err).trim() };
};

async function check(name: "claude" | "codex", exec: Runner): Promise<Connection> {
  const install =
    name === "claude" ? "npm install -g @anthropic-ai/claude-code" : "npm install -g @openai/codex";
  if (!Bun.which(name))
    return { installed: false, version: null, loggedIn: false, method: null, fix: install };
  const [version, status] = await Promise.all([
    exec([name, "--version"]),
    exec(name === "claude" ? ["claude", "auth", "status"] : ["codex", "login", "status"]),
  ]);
  let loggedIn = false,
    method: string | null = null;
  if (name === "claude") {
    try {
      // Only the sign-in state and method leave this function; email and org ids are dropped.
      const s = JSON.parse(status.out) as {
        loggedIn?: boolean;
        authMethod?: string;
        subscriptionType?: string;
      };
      loggedIn = s.loggedIn === true;
      method = s.subscriptionType
        ? `Claude ${s.subscriptionType} subscription`
        : s.authMethod === "claude.ai"
          ? "Claude subscription"
          : s.authMethod || null;
    } catch {}
  } else {
    loggedIn = status.code === 0 && /logged in/i.test(status.out);
    method = /chatgpt/i.test(status.out)
      ? "ChatGPT subscription"
      : /api key/i.test(status.out)
        ? "API key"
        : null;
  }
  return {
    installed: true,
    version:
      version.code === 0 ? version.out.split(/\s/).find((w) => /\d+\.\d+/.test(w)) || null : null,
    loggedIn,
    method: loggedIn ? method : null,
    fix: loggedIn ? null : name === "claude" ? "claude auth login" : "codex login",
  };
}

let cached: Promise<Record<"claude" | "codex", Connection>> | null = null;
export function connections(refresh = false, exec: Runner = run) {
  if (refresh || !cached)
    cached = Promise.all([check("claude", exec), check("codex", exec)]).then(([claude, codex]) => ({
      claude,
      codex,
    }));
  return cached;
}
