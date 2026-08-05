import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PrefaceSettings } from "#src/settings";

describe("PrefaceSettings", () => {
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "preface-agent-"));
    cwd = mkdtempSync(join(tmpdir(), "preface-cwd-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
  });

  it("is empty when neither global nor project file exists", () => {
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("");
    expect(s.globalPath).toBeUndefined();
    expect(s.projectPath).toBeUndefined();
  });

  it("loads global content only", () => {
    writeFileSync(join(agentDir, "preface.md"), "global reminder");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("global reminder");
    expect(s.globalPath).toBe(join(agentDir, "preface.md"));
    expect(s.projectPath).toBeUndefined();
  });

  it("loads project content only", () => {
    writeFileSync(join(cwd, ".pi", "preface.md"), "project reminder");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("project reminder");
    expect(s.globalPath).toBeUndefined();
    expect(s.projectPath).toBe(join(cwd, ".pi", "preface.md"));
  });

  it("concatenates global then project, separated by a blank line", () => {
    writeFileSync(join(agentDir, "preface.md"), "global");
    writeFileSync(join(cwd, ".pi", "preface.md"), "project");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("global\n\nproject");
    expect(s.globalPath).toBe(join(agentDir, "preface.md"));
    expect(s.projectPath).toBe(join(cwd, ".pi", "preface.md"));
  });

  it("ignores whitespace-only files", () => {
    writeFileSync(join(agentDir, "preface.md"), "   \n\n  ");
    writeFileSync(join(cwd, ".pi", "preface.md"), "real content");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.content).toBe("real content");
    expect(s.globalPath).toBeUndefined();
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
});