import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrefaceSettings } from "#src/settings";

describe("PrefaceSettings", () => {
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "preface-agent-"));
    cwd = mkdtempSync(join(tmpdir(), "preface-cwd-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
  });

  afterEach(() => {
    // tmp dirs are left for the OS to reap; no explicit cleanup needed.
  });

  it("is empty when neither global nor project file exists", () => {
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("");
  });

  it("loads global content only", () => {
    writeFileSync(join(agentDir, "preface.md"), "global reminder");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("global reminder");
  });

  it("loads project content only", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "project reminder");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("project reminder");
  });

  it("concatenates global then project, separated by a blank line", () => {
    writeFileSync(join(agentDir, "preface.md"), "global");
    writeFileSync(join(cwd, ".pi", "preface.md"), "project");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("global\n\nproject");
  });

  it("ignores whitespace-only files", () => {
    writeFileSync(join(agentDir, "preface.md"), "   \n\n  ");
    writeFileSync(join(cwd, ".pi", "preface.md"), "real content");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("real content");
  });

  it("reloads on subsequent load() calls (picks up edits)", () => {
    writeFileSync(join(agentDir, "preface.md"), "v1");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("v1");
    writeFileSync(join(agentDir, "preface.md"), "v2");
    s.load(cwd, agentDir);
    expect(s.content).toBe("v2");
  });

  it("tracks contributing paths in `sources` (global first, then project)", () => {
    writeFileSync(join(agentDir, "preface.md"), "global");
    writeFileSync(join(cwd, ".pi", "preface.md"), "project");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.sources).toEqual([join(agentDir, "preface.md"), join(cwd, ".pi", "preface.md")]);
  });

  it("omits absent/empty files from `sources`", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "project");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.sources).toEqual([join(cwd, ".pi", "preface.md")]);
  });
});
