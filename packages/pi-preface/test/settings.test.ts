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
    expect(s.entries).toEqual([]);
    expect(s.globalPath).toBeUndefined();
    expect(s.projectPath).toBeUndefined();
    expect(s.warnings).toEqual([]);
  });

  it("loads global entries only", () => {
    writeFileSync(join(agentDir, "preface.json"), '[{"when":"always","body":"global"}]');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries).toEqual([{ when: "always", body: "global" }]);
    expect(s.globalPath).toBe(join(agentDir, "preface.json"));
    expect(s.projectPath).toBeUndefined();
  });

  it("loads project entries only", () => {
    writeFileSync(join(cwd, ".pi", "preface.json"), '[{"when":"skill_launched","body":"project"}]');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries).toEqual([{ when: "skill_launched", body: "project" }]);
    expect(s.globalPath).toBeUndefined();
    expect(s.projectPath).toBe(join(cwd, ".pi", "preface.json"));
  });

  it("concatenates global then project by declaration order", () => {
    writeFileSync(join(agentDir, "preface.json"), '[{"when":"always","body":"g1"},{"when":"always","body":"g2"}]');
    writeFileSync(join(cwd, ".pi", "preface.json"), '[{"when":"skill_launched","body":"p1"}]');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries.map((e) => e.body)).toEqual(["g1", "g2", "p1"]);
    expect(s.globalPath).toBe(join(agentDir, "preface.json"));
    expect(s.projectPath).toBe(join(cwd, ".pi", "preface.json"));
  });

  it("surfaces warnings for unknown when values", () => {
    writeFileSync(join(cwd, ".pi", "preface.json"), '[{"when":"bogus","body":"x"}]');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries).toEqual([]);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain("unknown");
  });

  it("surfaces warnings for missing body, keeps valid siblings", () => {
    writeFileSync(join(cwd, ".pi", "preface.json"), '[{"when":"always"},{"when":"always","body":"ok"}]');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries.map((e) => e.body)).toEqual(["ok"]);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain("body");
  });

  it("surfaces a warning for malformed JSON and degrades to empty", () => {
    writeFileSync(join(cwd, ".pi", "preface.json"), "{not valid json");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries).toEqual([]);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain("malformed JSON");
    expect(s.projectPath).toBeUndefined();
  });

  it("surfaces a warning when the file is not an array", () => {
    writeFileSync(join(cwd, ".pi", "preface.json"), '{"when":"always","body":"x"}');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries).toEqual([]);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toMatch(/array/);
  });

  it("does not set a layer path when the file contributes no valid entries", () => {
    writeFileSync(join(agentDir, "preface.json"), '[{"when":"bogus","body":"x"}]');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries).toEqual([]);
    expect(s.globalPath).toBeUndefined();
  });

  it("ignores a whitespace-only/empty valid array (no entries, no path)", () => {
    writeFileSync(join(agentDir, "preface.json"), "[]");
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries).toEqual([]);
    expect(s.globalPath).toBeUndefined();
    expect(s.warnings).toEqual([]);
  });

  it("prefixes warnings with the contributing file path", () => {
    const projectFile = join(cwd, ".pi", "preface.json");
    writeFileSync(projectFile, '[{"when":"bogus","body":"x"}]');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.warnings[0]).toContain(projectFile);
  });

  it("reloads on subsequent load() calls (picks up edits)", () => {
    writeFileSync(join(agentDir, "preface.json"), '[{"when":"always","body":"v1"}]');
    const s = new PrefaceSettings();
    s.load(cwd, agentDir);
    expect(s.entries.map((e) => e.body)).toEqual(["v1"]);
    writeFileSync(join(agentDir, "preface.json"), '[{"when":"always","body":"v2"}]');
    s.load(cwd, agentDir);
    expect(s.entries.map((e) => e.body)).toEqual(["v2"]);
  });
});
