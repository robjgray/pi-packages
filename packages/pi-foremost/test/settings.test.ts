import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ForemostSettings } from "#src/settings";

describe("ForemostSettings", () => {
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "foremost-agent-"));
    cwd = mkdtempSync(join(tmpdir(), "foremost-cwd-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
  });

  afterEach(() => {
    // tmp dirs are left for the OS to reap; no explicit cleanup needed.
  });

  it("is empty when neither global nor project file exists", () => {
    const s = new ForemostSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("");
  });

  it("loads global content only", () => {
    writeFileSync(join(agentDir, "foremost.md"), "global reminder");
    const s = new ForemostSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("global reminder");
  });

  it("loads project content only", () => {
    writeFileSync(join(cwd, ".pi", "foremost.md"), "project reminder");
    const s = new ForemostSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("project reminder");
  });

  it("concatenates global then project, separated by a blank line", () => {
    writeFileSync(join(agentDir, "foremost.md"), "global");
    writeFileSync(join(cwd, ".pi", "foremost.md"), "project");
    const s = new ForemostSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("global\n\nproject");
  });

  it("ignores whitespace-only files", () => {
    writeFileSync(join(agentDir, "foremost.md"), "   \n\n  ");
    writeFileSync(join(cwd, ".pi", "foremost.md"), "real content");
    const s = new ForemostSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("real content");
  });

  it("reloads on subsequent load() calls (picks up edits)", () => {
    writeFileSync(join(agentDir, "foremost.md"), "v1");
    const s = new ForemostSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("v1");
    writeFileSync(join(agentDir, "foremost.md"), "v2");
    s.load(cwd, agentDir);
    expect(s.content).toBe("v2");
  });
});
