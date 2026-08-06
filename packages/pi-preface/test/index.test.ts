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

  it("appends the turn-context explanation to the system prompt via before_agent_start", () => {
    const { pi, handlers } = makePi();
    factory(pi);
    const result = handlers.before_agent_start(
      { type: "before_agent_start", systemPrompt: "base", prompt: "hi", systemPromptOptions: {} },
      makeCtx(cwd).ctx,
    );
    expect(result.systemPrompt).toContain("base");
    expect(result.systemPrompt).toContain("<turn-context>");
  });

  it("wraps the latest user message on context (first-gen case)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0]).toEqual({ type: "text", text: "<turn-context>\nstay sharp\n</turn-context>" });
  });

  it("does not inject on toolResult via context (handled by before_provider_request instead)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
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

  it("inserts a system message via before_provider_request on tool rounds (ollama)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd, "openai-completions");
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const payload = {
      messages: [
        { role: "system", content: "base system" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "" },
        { role: "tool", content: "result" },
      ],
      stream: true,
    };
    const result = handlers.before_provider_request({ type: "before_provider_request", payload }, ctx);
    expect(result).toBeDefined();
    expect(result.messages).toHaveLength(5);
    expect(result.messages[4]).toEqual({ role: "system", content: "<turn-context>\nstay sharp\n</turn-context>" });
    // Tool message is untouched.
    expect(result.messages[3]).toEqual({ role: "tool", content: "result" });
    expect(entries).toHaveLength(1);
  });

  it("does not inject via before_provider_request when latest is user (first-gen, handled by context)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const payload = { messages: [{ role: "user", content: "hi" }] };
    const result = handlers.before_provider_request({ type: "before_provider_request", payload }, ctx);
    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("does not inject via before_provider_request on non-openai-completions providers", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd, "anthropic-messages");
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const payload = { messages: [{ role: "tool", content: "result" }] };
    const result = handlers.before_provider_request({ type: "before_provider_request", payload }, ctx);
    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("does not inject when no content is configured", () => {
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
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
    expect(handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx)).toBeUndefined();
    writeFileSync(join(cwd, ".pi", "preface.md"), "now configured");
    handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
  });
});