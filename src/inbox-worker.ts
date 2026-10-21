import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { InboxStore } from "./inbox-store";
import { generate, type Stage } from "./generation";
import { collect, research, NeedsInput } from "./source-reader";
import { Cancelled, runStructured } from "./structured-cli";
export class InboxWorker {
  private stopped = false;
  private running: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  constructor(
    readonly store: InboxStore,
    readonly prepare = generate,
    readonly reader = collect,
    readonly researcher = research,
  ) {}
  start() {
    this.running = this.loop();
  }
  async stop() {
    this.stopped = true;
    this.wake?.();
    await this.running;
  }
  async processNext() {
    const settings = this.store.settings();
    if (!settings.enabled) return false;
    const owner = randomUUID(),
      item = this.store.claim(owner);
    if (!item) return false;
    const pulse = setInterval(() => this.store.heartbeat(item.id, owner), 10000);
    const cancelled = () =>
      this.stopped || !this.store.settings().enabled || !this.store.owned(item.id, owner);
    const stage: Stage = (state, message, title) => {
      if (cancelled() || !this.store.advance(item.id, owner, state, message, title))
        throw new Cancelled("Preparation stopped.");
    };
    const directory = join(this.store.root, "items", item.id, "revision-" + item.revision);
    try {
      let reading = await this.reader(item, join(directory, "sources"));
      stage("researching", "Finding background reading the source assumes.");
      reading = await this.researcher(
        item,
        reading,
        join(directory, "sources"),
        (prompt, schema, search) =>
          runStructured(
            settings.provider,
            settings.model,
            prompt,
            schema,
            300,
            cancelled,
            "",
            search,
          ),
      );
      if (cancelled()) throw new Cancelled("Preparation stopped.");
      const { output, title } = await this.prepare(
        item,
        reading,
        join(directory, "draft"),
        settings,
        stage,
        cancelled,
      );
      this.store.advance(
        item.id,
        owner,
        "ready",
        "Your lessons and practice are ready.",
        title,
        output,
      );
    } catch (e) {
      if (e instanceof NeedsInput) this.store.advance(item.id, owner, "needs_input", e.message);
      else if (e instanceof Cancelled)
        this.store.advance(
          item.id,
          owner,
          "queued",
          "Saved your drafts. Preparation will resume when the queue runs.",
        );
      else this.store.advance(item.id, owner, "failed", String(e).slice(0, 500));
    } finally {
      clearInterval(pulse);
    }
    return true;
  }
  private async loop() {
    while (!this.stopped) {
      let worked = false;
      try {
        worked = await this.processNext();
      } catch {
        /* The leased attempt remains recoverable after its lease expires. */
      }
      if (!worked && !this.stopped)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
    }
  }
}
