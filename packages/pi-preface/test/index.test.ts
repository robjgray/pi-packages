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

/** Minimal `pi` that records handlers and entry-renderer/append calls. */
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
    expect(renderers).toContain("preface");
  });

  it("appends a preface entry on a fresh session_start when content is configured", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, { cwd });

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("preface");
    // Project path is displayed relative to cwd.
    expect(entries[0].data.sources).toContain(".pi/preface.md");
    expect(entries[0].data.chars).toBe("stay sharp".length);
  });

  it("does not append the entry when no content is configured", () => {
    const { pi, handlers, entries } = makePi();
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, { cwd });
    expect(entries).toHaveLength(0);
  });

  it("does not append the entry on non-fresh session_start reasons (reload/resume/fork)", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers, entries } = makePi();
    factory(pi);

    for (const reason of ["reload", "resume", "fork"]) {
      handlers.session_start({ type: "session_start", reason }, { cwd });
    }
    // Content still reloads silently; no notice entries appended.
    expect(entries).toHaveLength(0);
  });

  it("injects the block on `context` after `session_start` loads the content", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "stay sharp");
    const { pi, handlers } = makePi();
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, { cwd });

    const messages = [{ role: "user", content: "hi" }];
    const result = handlers.context({ type: "context", messages });

    expect(result).toBeDefined();
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0]).toEqual({ type: "text", text: "<preface>\nstay sharp\n</preface>" });
    expect(arr[1]).toEqual({ type: "text", text: "hi" });
  });

  it("is a no-op on `context` when no content is configured", () => {
    const { pi, handlers } = makePi();
    factory(pi);
    handlers.session_start({ type: "session_start", reason: "startup" }, { cwd });
    const messages = [{ role: "user", content: "hi" }];
    expect(handlers.context({ type: "context", messages })).toBeUndefined();
  });

  it("reloads content when `session_start` fires again (reload/new/resume)", () => {
    const { pi, handlers } = makePi();
    factory(pi);

    handlers.session_start({ type: "session_start", reason: "startup" }, { cwd });
    expect(handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] })).toBeUndefined();

    writeFileSync(join(cwd, ".pi", "preface.md"), "now configured");
    handlers.session_start({ type: "session_start", reason: "reload" }, { cwd });

    const result = handlers.context({ type: "context", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBeDefined();
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0]).toEqual({ type: "text", text: "<preface>\nnow configured\n</preface>" });
  });
});