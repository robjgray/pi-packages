import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAgentDir = vi.hoisted(() => vi.fn());
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: mockGetAgentDir,
}));

import factory from "#src/index";

function makePi(): {
  pi: any;
  handlers: Record<string, (...args: any[]) => any>;
  entries: { type: string; data: any }[];
  renderers: string[];
} {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const entries: { type: string; data: any }[] = [];
  const renderers: string[] = [];
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers[event] = handler;
    },
    registerEntryRenderer: (type: string) => {
      renderers.push(type);
    },
    appendEntry: (type: string, data: any) => {
      entries.push({ type, data });
    },
  };
  return { pi, handlers, entries, renderers };
}

function makeCtx(cwd: string, api: string = "openai-completions") {
  return { ctx: { cwd, ui: {}, model: { api, provider: "ollama" } } };
}

const ENTRY_TYPE = "preface";

describe("preface extension wiring", () => {
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "preface-idx-agent-"));
    cwd = mkdtempSync(join(tmpdir(), "preface-idx-cwd-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mockGetAgentDir.mockReturnValue(agentDir);
  });

  it("registers a `preface` entry renderer on load", () => {
    const { pi, renderers } = makePi();
    factory(pi);
    expect(renderers).toContain(ENTRY_TYPE);
  });

  it("prepends into a user message and appends an entry (first-gen case)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context(
      { type: "context", messages: [{ role: "user", content: "hi" }] },
      ctx,
    );

    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
    // Injection prepended the block into the user message.
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0]).toEqual({ type: "text", text: "<preface>\nstay sharp\n</preface>" });
  });

  it("appends a separate user message on toolResult + openai-completions (tool-round case)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd, "openai-completions");
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "toolCall" }] },
      { role: "toolResult", content: [{ type: "text", text: "result" }] },
    ];
    const result = handlers.context({ type: "context", messages }, ctx);

    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
    // A NEW user message is appended (not merged into the toolResult).
    expect(result.messages).toHaveLength(4);
    const appended = result.messages[3];
    expect(appended.role).toBe("user");
    const arr = appended.content as { type: string; text?: string }[];
    expect(arr[0]).toEqual({ type: "text", text: "<preface>\nstay sharp\n</preface>" });
    // The toolResult is untouched.
    expect(result.messages[2]).toBe(messages[2]);
  });

  it("fires on every generation (user + toolResult rounds)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    // First gen (user latest).
    handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    // Tool round (toolResult latest).
    handlers.context(
      {
        type: "context",
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: [{ type: "toolCall" }] },
          { role: "toolResult", content: [{ type: "text", text: "r" }] },
        ],
      },
      ctx,
    );

    expect(entries).toHaveLength(2);
  });

  it("skips toolResult rounds on non-openai-completions (Anthropic safety)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd, "anthropic-messages");
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "toolCall" }] },
      { role: "toolResult", content: [{ type: "text", text: "result" }] },
    ];
    const result = handlers.context({ type: "context", messages }, ctx);

    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("does not inject after the model has finished (stopReason stop before latest toolResult)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd, "openai-completions");
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    // Model delivered a summary (stop), then continued with a read tool for
    // some reason. The preface must NOT fire here — it would re-engage the
    // model into a re-summarizing loop.
    const messages = [
      { role: "user", content: "do the thing" },
      { role: "assistant", content: [{ type: "text", text: "Done." }], stopReason: "stop" },
      { role: "assistant", content: [{ type: "toolCall" }], stopReason: "toolUse" },
      { role: "toolResult", content: [{ type: "text", text: "read result" }] },
    ];
    const result = handlers.context({ type: "context", messages }, ctx);

    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("does inject on a normal tool round (no stop since last user)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd, "openai-completions");
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const messages = [
      { role: "user", content: "do the thing" },
      { role: "assistant", content: [{ type: "toolCall" }], stopReason: "toolUse" },
      { role: "toolResult", content: [{ type: "text", text: "result" }] },
    ];
    const result = handlers.context({ type: "context", messages }, ctx);

    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
  });

  it("does not append when no content is configured", () => {
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context(
      { type: "context", messages: [{ role: "user", content: "hi" }] },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("includes both global and project paths in the entry", () => {
    writeFileSync(join(agentDir, "preface.md"), "global");
    writeFileSync(join(cwd, ".pi", "preface.md"), "project");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);

    expect(entries[0].data.globalPath).toBe(join(agentDir, "preface.md"));
    expect(entries[0].data.projectPath).toBe(join(cwd, ".pi", "preface.md"));
  });

  it("reloads content on subsequent session_start", () => {
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();

    writeFileSync(join(cwd, ".pi", "preface.md"), "now configured");
    handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
    const result = handlers.context(
      { type: "context", messages: [{ role: "user", content: "hi" }] },
      ctx,
    );

    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
  });
});