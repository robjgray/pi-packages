import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  ConditionState,
  extractMessageText,
  matchReadToSkill,
  scanUserMessageForSkill,
  seedFromHistory,
} from "#src/conditions";

/** Build a real `<skill>` block string matching parseSkillBlock's anchored regex. */
function skillBlock(name = "foo", location = "/skills/foo/SKILL.md", body = "do the thing"): string {
  return `<skill name="${name}" location="${location}">\n${body}\n</skill>`;
}

describe("ConditionState", () => {
  it("starts with skillLaunched false", () => {
    expect(new ConditionState().skillLaunched).toBe(false);
  });

  it("flipOnSkill sets the flag true", () => {
    const s = new ConditionState();
    s.flipOnSkill();
    expect(s.skillLaunched).toBe(true);
  });

  it("is monotonic — flipping twice stays true", () => {
    const s = new ConditionState();
    s.flipOnSkill();
    s.flipOnSkill();
    expect(s.skillLaunched).toBe(true);
  });

  it("reset returns the flag to false", () => {
    const s = new ConditionState();
    s.flipOnSkill();
    s.reset();
    expect(s.skillLaunched).toBe(false);
  });
});

describe("scanUserMessageForSkill", () => {
  it("returns true for an entire skill block message", () => {
    expect(scanUserMessageForSkill(skillBlock())).toBe(true);
  });

  it("returns true for a skill block followed by user args", () => {
    expect(scanUserMessageForSkill(`${skillBlock()}\n\nextra args`)).toBe(true);
  });

  it("returns false for an unknown-skill passthrough (no skill block)", () => {
    expect(scanUserMessageForSkill("/skill:unknown")).toBe(false);
  });

  it("returns false for a plain user message", () => {
    expect(scanUserMessageForSkill("just a normal prompt")).toBe(false);
  });

  it("returns false for a skill block embedded mid-message (regex anchors whole text)", () => {
    expect(scanUserMessageForSkill(`prefix ${skillBlock()} suffix`)).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(scanUserMessageForSkill("")).toBe(false);
  });
});

describe("matchReadToSkill", () => {
  const paths = new Set(["/skills/foo/SKILL.md", "/skills/bar/SKILL.md"]);

  it("returns true when the path is a cached skill filePath", () => {
    expect(matchReadToSkill("/skills/foo/SKILL.md", paths)).toBe(true);
  });

  it("returns false for a skill reference asset (not the SKILL.md)", () => {
    expect(matchReadToSkill("/skills/foo/references/X.md", paths)).toBe(false);
  });

  it("returns false for an unrelated path", () => {
    expect(matchReadToSkill("/etc/passwd", paths)).toBe(false);
  });

  it("returns false for an empty set", () => {
    expect(matchReadToSkill("/skills/foo/SKILL.md", new Set())).toBe(false);
  });
});

describe("extractMessageText", () => {
  it("returns a string content unchanged", () => {
    expect(extractMessageText("hello")).toBe("hello");
  });

  it("joins text blocks of an array content", () => {
    const content = [
      { type: "text", text: "first " },
      { type: "text", text: "second" },
    ];
    expect(extractMessageText(content)).toBe("first second");
  });

  it("skips image blocks", () => {
    const content = [
      { type: "text", text: "keep" },
      { type: "image", data: "base64", mimeType: "image/png" },
    ];
    expect(extractMessageText(content)).toBe("keep");
  });

  it("returns empty string for undefined content", () => {
    expect(extractMessageText(undefined)).toBe("");
  });

  it("returns empty string for an unsupported type", () => {
    expect(extractMessageText(42)).toBe("");
  });
});

describe("seedFromHistory", () => {
  function msgEntry(role: string, content: unknown): SessionEntry {
    return {
      type: "message",
      id: `${role}-${Math.random()}`,
      parentId: null,
      timestamp: "2026-01-01T00:00:00Z",
      message: { role, content },
    } as unknown as SessionEntry;
  }

  it("flips the flag when a user message contains a skill block (string content)", () => {
    const entries = [
      msgEntry("user", skillBlock()),
      msgEntry("assistant", "ok"),
    ];
    const s = new ConditionState();
    seedFromHistory(entries, s);
    expect(s.skillLaunched).toBe(true);
  });

  it("flips the flag when a user message contains a skill block (array content)", () => {
    const entries = [
      msgEntry("user", [{ type: "text", text: skillBlock() }]),
    ];
    const s = new ConditionState();
    seedFromHistory(entries, s);
    expect(s.skillLaunched).toBe(true);
  });

  it("does NOT flip when no user message contains a skill block", () => {
    const entries = [
      msgEntry("user", "/skill:unknown"),
      msgEntry("assistant", "ok"),
      msgEntry("user", "plain follow-up"),
    ];
    const s = new ConditionState();
    seedFromHistory(entries, s);
    expect(s.skillLaunched).toBe(false);
  });

  it("skips non-message entries", () => {
    const entries = [
      { type: "custom", id: "c1", parentId: null, timestamp: "t", data: {} },
      msgEntry("user", skillBlock()),
    ] as unknown as SessionEntry[];
    const s = new ConditionState();
    seedFromHistory(entries, s);
    expect(s.skillLaunched).toBe(true);
  });

  it("ignores assistant messages even if they mention a skill block", () => {
    const entries = [
      msgEntry("assistant", skillBlock()),
    ];
    const s = new ConditionState();
    seedFromHistory(entries, s);
    expect(s.skillLaunched).toBe(false);
  });

  it("flips on the first matching user message and stops scanning", () => {
    const entries = [
      msgEntry("user", skillBlock("first")),
      msgEntry("user", skillBlock("second")),
    ];
    const s = new ConditionState();
    seedFromHistory(entries, s);
    expect(s.skillLaunched).toBe(true);
  });

  it("handles empty history", () => {
    const s = new ConditionState();
    seedFromHistory([], s);
    expect(s.skillLaunched).toBe(false);
  });
});
