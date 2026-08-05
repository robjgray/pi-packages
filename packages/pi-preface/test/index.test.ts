import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Canonical vi.hoisted pattern: the mock factory closes over a hoisted vi.fn,
// which tests configure per-case with a temp agent dir. Keeps the test hermetic
// (no reliance on the real ~/.pi/agent/preface.md).
const mockGetAgentDir = vi.hoisted(() => vi.fn());
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: mockGetAgentDir,
}));

import factory from "#src/index";

/** Minimal `pi` that records handlers; each test supplies its own `ctx.ui`. */
function makePi(): { pi: any; handlers: Record<string, (...args: any[]) => any> } {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers[event] = handler;
    },
  };
  return { pi, handlers };
}

/** A `ctx` stub whose `ui.setStatus` records calls. */
function makeCtx(cwd: string) {
  const statusCalls: { key: string; text: string | undefined }[] = [];
  return {
    ctx: { cwd, ui: { setStatus: (key: string, text: string | undefined) => statusCalls.push({ key, text }) } },
    statusCalls,
  };
}

const STATUS_KEY = "preface";

describe("preface extension wiring", () => {
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "preface-idx-agent-"));
    cwd = mkdtempSync(join(tmpdir(), "preface-idx-cwd-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mockGetAgentDir.mockReturnValue(agentDir);
  });

  it("sets the footer on `context` with the absolute project path when only the project file is configured", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers } = makePi();
    const { ctx, statusCalls } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);

    // Injection happened.
    expect(result).toBeDefined();
    // Footer names the absolute project path under the Project label.
    const set = statusCalls.filter((c) => c.key === STATUS_KEY);
    expect(set).toHaveLength(1);
    expect(set[0].text).toBe(`Preface (Project): ${join(cwd, ".pi", "preface.md")}`);
  });

  it("sets the footer with both labeled absolute paths when both files are configured", () => {
    writeFileSync(join(agentDir, "preface.md"), "global");
    writeFileSync(join(cwd, ".pi", "preface.md"), "project");
    const { pi, handlers } = makePi();
    const { ctx, statusCalls } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);

    const set = statusCalls.filter((c) => c.key === STATUS_KEY).at(-1)!;
    expect(set.text).toBe(
      `Preface (Global): ${join(agentDir, "preface.md")}  Preface (Project): ${join(cwd, ".pi", "preface.md")}`,
    );
  });

  it("does not set the footer on `context` when no content is configured", () => {
    const { pi, handlers } = makePi();
    const { ctx, statusCalls } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);

    expect(result).toBeUndefined();
    // No footer *line* (defined text) is ever shown when there's nothing to inject.
    // The session_start clear (undefined) is expected and allowed.
    expect(statusCalls.filter((c) => c.key === STATUS_KEY && c.text !== undefined)).toHaveLength(0);
  });

  it("clears the footer on `agent_settled`", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers } = makePi();
    const { ctx, statusCalls } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);
    handlers.agent_settled({ type: "agent_settled" }, ctx);

    const last = statusCalls.filter((c) => c.key === STATUS_KEY).at(-1)!;
    expect(last.text).toBeUndefined();
  });

  it("clears the footer on `session_start` when no content is configured", () => {
    const { pi, handlers } = makePi();
    const { ctx, statusCalls } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

    const last = statusCalls.filter((c) => c.key === STATUS_KEY).at(-1)!;
    expect(last.text).toBeUndefined();
  });

  it("updates the footer path after a reload adds a project file", () => {
    const { pi, handlers } = makePi();
    const { ctx, statusCalls } = makeCtx(cwd);
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    expect(handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx)).toBeUndefined();

    writeFileSync(join(cwd, ".pi", "preface.md"), "now configured");
    handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
    handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] }, ctx);

    const last = statusCalls.filter((c) => c.key === STATUS_KEY).at(-1)!;
    expect(last.text).toBe(`Preface (Project): ${join(cwd, ".pi", "preface.md")}`);
  });
});