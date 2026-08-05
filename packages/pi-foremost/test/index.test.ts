import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Canonical vi.hoisted pattern: the mock factory closes over a hoisted vi.fn,
// which tests configure per-case with a temp agent dir. Keeps the test hermetic
// (no reliance on the real ~/.pi/agent/foremost.md).
const mockGetAgentDir = vi.hoisted(() => vi.fn());
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: mockGetAgentDir,
}));

import factory from "#src/index";

/** Minimal `pi` that records handlers registered via `on`. */
function makePi(): {
  pi: any;
  handlers: Record<string, (...args: any[]) => any>;
} {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers[event] = handler;
    },
  };
  return { pi, handlers };
}

describe("foremost extension wiring", () => {
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "foremost-idx-agent-"));
    cwd = mkdtempSync(join(tmpdir(), "foremost-idx-cwd-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mockGetAgentDir.mockReturnValue(agentDir);
  });

  it("injects the block on `context` after `session_start` loads the content", () => {
    writeFileSync(join(cwd, ".pi", "foremost.md"), "stay sharp");
    const { pi, handlers } = makePi();
    factory(pi);

    handlers.session_start(
      { type: "session_start", reason: "startup" },
      { cwd },
    );

    const messages = [{ role: "user", content: "hi" }];
    const result = handlers.context({ type: "context", messages });

    expect(result).toBeDefined();
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0]).toEqual({
      type: "text",
      text: "<foremost>\nstay sharp\n</foremost>",
    });
    expect(arr[1]).toEqual({ type: "text", text: "hi" });
  });

  it("is a no-op on `context` when no content is configured", () => {
    // No foremost.md in either layer.
    const { pi, handlers } = makePi();
    factory(pi);

    handlers.session_start(
      { type: "session_start", reason: "startup" },
      { cwd },
    );

    const messages = [{ role: "user", content: "hi" }];
    expect(handlers.context({ type: "context", messages })).toBeUndefined();
  });

  it("reloads content when `session_start` fires again (reload/new/resume)", () => {
    const { pi, handlers } = makePi();
    factory(pi);

    handlers.session_start(
      { type: "session_start", reason: "startup" },
      { cwd },
    );
    expect(
      handlers.context({
        type: "context",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toBeUndefined();

    writeFileSync(join(cwd, ".pi", "foremost.md"), "now configured");
    handlers.session_start(
      { type: "session_start", reason: "reload" },
      { cwd },
    );

    const result = handlers.context({
      type: "context",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result).toBeDefined();
    const arr = result.messages[0].content as { type: string; text?: string }[];
    expect(arr[0]).toEqual({
      type: "text",
      text: "<foremost>\nnow configured\n</foremost>",
    });
  });
});
