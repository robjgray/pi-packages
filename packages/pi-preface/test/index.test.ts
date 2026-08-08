import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAgentDir = vi.hoisted(() => vi.fn());
const mockGetEntries = vi.hoisted(() => vi.fn());
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, getAgentDir: mockGetAgentDir };
});

import factory from "#src/index";

/** Build a real `<skill>` block string matching parseSkillBlock's anchored regex. */
function skillBlock(name = "foo", location = "/skills/foo/SKILL.md", body = "do the thing"): string {
  return `<skill name="${name}" location="${location}">\n${body}\n</skill>`;
}

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

function makeCtx(cwd: string, api: string = "openai-completions", getEntries = mockGetEntries) {
  return {
    ctx: {
      cwd,
      ui: {},
      model: { api, provider: "ollama" },
      sessionManager: { getEntries },
    },
  };
}

const ENTRY_TYPE = "preface";

/** A config with one skill_launched entry — the spec's acceptance-criteria config. */
const SKILL_LAUNCHED_CONFIG = JSON.stringify([
  { when: "skill_launched", body: "follow skill instructions" },
]);

function writeProjectConfig(cwd: string, json: string): void {
  writeFileSync(join(cwd, ".pi", "preface.json"), json);
}

describe("preface extension wiring", () => {
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "preface-idx-agent-"));
    cwd = mkdtempSync(join(tmpdir(), "preface-idx-cwd-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mockGetAgentDir.mockReturnValue(agentDir);
    mockGetEntries.mockReturnValue([]);
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

  it("caches skill filePaths from systemPromptOptions.skills on before_agent_start", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.before_agent_start(
      {
        type: "before_agent_start",
        systemPrompt: "base",
        prompt: "hi",
        systemPromptOptions: {
          skills: [{ name: "foo", filePath: "/skills/foo/SKILL.md", baseDir: "/skills/foo" }],
        },
      },
      ctx,
    );
    // A tool_call read of that exact filePath should flip the flag and inject next context.
    handlers.tool_call(
      { type: "tool_call", toolCallId: "1", toolName: "read", input: { path: "/skills/foo/SKILL.md" } },
      ctx,
    );
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
  });

  // --- Acceptance: no skill -> no inject ---

  it("does NOT inject when no skill is invoked (skill_launched entry)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  // --- Acceptance: /skill:<known> -> inject this + subsequent ---

  it("injects on the turn a /skill:<known> block is the latest user message", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context(
      { type: "context", messages: [{ role: "user", content: skillBlock() }] },
      ctx,
    );
    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0].text).toContain("follow skill instructions");
  });

  it("injects on every subsequent generation after the flip", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    // First turn: skill block flips the flag.
    handlers.context({ type: "context", messages: [{ role: "user", content: skillBlock() }] }, ctx);
    // Later turn: a plain user message still injects (flag is sticky).
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "plain" }] }, ctx);
    expect(result).toBeDefined();
    expect(entries).toHaveLength(2);
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0].text).toContain("follow skill instructions");
  });

  it("injects on a skill block delivered as array content", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context(
      { type: "context", messages: [{ role: "user", content: [{ type: "text", text: skillBlock() }] }] },
      ctx,
    );
    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
  });

  // --- Acceptance: /skill:<unknown> -> no inject ---

  it("does NOT inject on /skill:<unknown> (passthrough, no skill block)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context(
      { type: "context", messages: [{ role: "user", content: "/skill:unknown" }] },
      ctx,
    );
    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  // --- Acceptance: read SKILL.md -> active next gen ---

  it("activates on a tool_call read of an actual SKILL.md (injected on the next generation)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.before_agent_start(
      {
        type: "before_agent_start",
        systemPrompt: "base",
        prompt: "hi",
        systemPromptOptions: {
          skills: [{ name: "foo", filePath: "/skills/foo/SKILL.md", baseDir: "/skills/foo" }],
        },
      },
      ctx,
    );
    // No skill block in the user message; flag not yet set.
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
    // Model reads the actual SKILL.md.
    handlers.tool_call(
      { type: "tool_call", toolCallId: "1", toolName: "read", input: { path: "/skills/foo/SKILL.md" } },
      ctx,
    );
    // Next generation: active.
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
  });

  it("does NOT activate on a read of a skill reference asset (references/X.md)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.before_agent_start(
      {
        type: "before_agent_start",
        systemPrompt: "base",
        prompt: "hi",
        systemPromptOptions: {
          skills: [{ name: "foo", filePath: "/skills/foo/SKILL.md", baseDir: "/skills/foo" }],
        },
      },
      ctx,
    );
    handlers.tool_call(
      { type: "tool_call", toolCallId: "1", toolName: "read", input: { path: "/skills/foo/references/X.md" } },
      ctx,
    );
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("does NOT flip on a non-read tool_call (e.g. bash)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.before_agent_start(
      {
        type: "before_agent_start",
        systemPrompt: "base",
        prompt: "hi",
        systemPromptOptions: {
          skills: [{ name: "foo", filePath: "/skills/foo/SKILL.md", baseDir: "/skills/foo" }],
        },
      },
      ctx,
    );
    handlers.tool_call(
      { type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "ls" } },
      ctx,
    );
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
  });

  it("does NOT crash when a read tool_call has no path", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.before_agent_start(
      {
        type: "before_agent_start",
        systemPrompt: "base",
        prompt: "hi",
        systemPromptOptions: {
          skills: [{ name: "foo", filePath: "/skills/foo/SKILL.md", baseDir: "/skills/foo" }],
        },
      },
      ctx,
    );
    expect(() =>
      handlers.tool_call(
        { type: "tool_call", toolCallId: "1", toolName: "read", input: {} },
        ctx,
      ),
    ).not.toThrow();
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
  });

  it("resolves a relative read path against ctx.cwd before matching", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const skillAbs = join(cwd, "skills", "foo", "SKILL.md");
    handlers.before_agent_start(
      {
        type: "before_agent_start",
        systemPrompt: "base",
        prompt: "hi",
        systemPromptOptions: {
          skills: [{ name: "foo", filePath: skillAbs, baseDir: join(cwd, "skills", "foo") }],
        },
      },
      ctx,
    );
    handlers.tool_call(
      { type: "tool_call", toolCallId: "1", toolName: "read", input: { path: "skills/foo/SKILL.md" } },
      ctx,
    );
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeDefined();
  });

  // --- Acceptance: resume with history -> active turn one ---

  it("seeds the flag from history on resume (active from first generation)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    mockGetEntries.mockReturnValue([
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "t",
        message: { role: "user", content: skillBlock() },
      },
    ]);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "resume" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
  });

  it("does NOT seed on resume when history has no skill block", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    mockGetEntries.mockReturnValue([
      { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: "plain" } },
    ]);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "resume" }, ctx);
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("does NOT seed on startup/reload/new (only resume/fork)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    mockGetEntries.mockReturnValue([
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "t",
        message: { role: "user", content: skillBlock() },
      },
    ]);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("seeds the flag from history on fork", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    mockGetEntries.mockReturnValue([
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "t",
        message: { role: "user", content: skillBlock() },
      },
    ]);
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "fork" }, ctx);
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeDefined();
  });

  // --- reload resets the flag (conscious per frozen intent) ---

  it("a mid-session reload resets the flag until re-invocation", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: skillBlock() }] }, ctx);
    expect(entries).toHaveLength(1);
    // Reload resets the flag (no history seeding on reload).
    handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
  });

  // --- always entries ---

  it("always entries inject regardless of skill state", () => {
    writeProjectConfig(cwd, JSON.stringify([{ when: "always", body: "always on" }]));
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeDefined();
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0].text).toContain("always on");
  });

  it("mixes always and skill_launched entries once the flag flips", () => {
    writeProjectConfig(
      cwd,
      JSON.stringify([
        { when: "always", body: "A" },
        { when: "skill_launched", body: "B" },
      ]),
    );
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    // No skill yet: only A injects.
    let result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    let arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0].text).toBe("<turn-context>\nA\n</turn-context>");
    // After flip: both A and B inject, declaration order.
    result = handlers.context({ type: "context", messages: [{ role: "user", content: skillBlock() }] }, ctx);
    arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0].text).toBe("<turn-context>\nA\n\nB\n</turn-context>");
  });

  // --- tool-round injection (before_provider_request) ---

  it("inserts a system message via before_provider_request on tool rounds once active", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd, "openai-completions");
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: skillBlock() }] }, ctx);
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
    expect(result.messages[4]).toEqual({ role: "system", content: "<turn-context>\nfollow skill instructions\n</turn-context>" });
    expect(result.messages[3]).toEqual({ role: "tool", content: "result" });
    expect(entries).toHaveLength(2); // one from context, one from before_provider_request
  });

  it("does NOT inject via before_provider_request when not active", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd, "openai-completions");
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const payload = { messages: [{ role: "tool", content: "result" }] };
    const result = handlers.before_provider_request({ type: "before_provider_request", payload }, ctx);
    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("does not inject via before_provider_request when latest is user (first-gen, handled by context)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: skillBlock() }] }, ctx);
    const payload = { messages: [{ role: "user", content: "hi" }] };
    const result = handlers.before_provider_request({ type: "before_provider_request", payload }, ctx);
    expect(result).toBeUndefined();
  });

  it("does not inject via before_provider_request on non-openai-completions providers", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd, "anthropic-messages");
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: skillBlock() }] }, ctx);
    const payload = { messages: [{ role: "tool", content: "result" }] };
    const result = handlers.before_provider_request({ type: "before_provider_request", payload }, ctx);
    expect(result).toBeUndefined();
  });

  it("does not inject via context on toolResult (handled by before_provider_request instead)", () => {
    writeProjectConfig(cwd, SKILL_LAUNCHED_CONFIG);
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: skillBlock() }] }, ctx);
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "toolCall" }] },
      { role: "toolResult", content: [{ type: "text", text: "result" }] },
    ];
    const result = handlers.context({ type: "context", messages }, ctx);
    expect(result).toBeUndefined();
  });

  // --- config edge cases ---

  it("does not inject when no config is present", () => {
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeUndefined();
    expect(entries).toHaveLength(0);
  });

  it("includes both global and project paths in the entry", () => {
    writeFileSync(join(agentDir, "preface.json"), '[{"when":"always","body":"global"}]');
    writeFileSync(join(cwd, ".pi", "preface.json"), '[{"when":"always","body":"project"}]');
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(entries[0].data.globalPath).toBe(join(agentDir, "preface.json"));
    expect(entries[0].data.projectPath).toBe(join(cwd, ".pi", "preface.json"));
  });

  it("reloads config on subsequent session_start", () => {
    const { pi, handlers, entries } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
    writeProjectConfig(cwd, '[{"when":"always","body":"now configured"}]');
    handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    expect(result).toBeDefined();
    expect(entries).toHaveLength(1);
  });

  it("degrades gracefully on malformed JSON (no crash, no inject)", () => {
    writeFileSync(join(cwd, ".pi", "preface.json"), "{not valid json");
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    expect(
      handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx),
    ).toBeUndefined();
  });

  it("surfaces parse warnings via console.warn on session_start", () => {
    writeFileSync(join(cwd, ".pi", "preface.json"), '[{"when":"bogus","body":"x"}]');
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pi, handlers } = makePi();
    const { ctx } = makeCtx(cwd);
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => /pi-preface:/.test(String(c[0])))).toBe(true);
    warnSpy.mockRestore();
  });
});
