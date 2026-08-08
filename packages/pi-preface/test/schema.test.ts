import { describe, expect, it } from "vitest";
import { type PrefaceEntry, parsePrefaceConfig } from "#src/schema";

describe("parsePrefaceConfig", () => {
  describe("valid input", () => {
    it("parses a single always entry", () => {
      const { entries, warnings } = parsePrefaceConfig([
        { when: "always", body: "stay sharp" },
      ]);
      expect(entries).toEqual<PrefaceEntry[]>([{ when: "always", body: "stay sharp" }]);
      expect(warnings).toEqual([]);
    });

    it("parses a single skill_launched entry", () => {
      const { entries, warnings } = parsePrefaceConfig([
        { when: "skill_launched", body: "follow the skill" },
      ]);
      expect(entries).toEqual<PrefaceEntry[]>([
        { when: "skill_launched", body: "follow the skill" },
      ]);
      expect(warnings).toEqual([]);
    });

    it("parses multiple entries in declaration order", () => {
      const { entries } = parsePrefaceConfig([
        { when: "always", body: "a" },
        { when: "skill_launched", body: "b" },
        { when: "always", body: "c" },
      ]);
      expect(entries.map((e) => e.body)).toEqual(["a", "b", "c"]);
    });

    it("keeps body whitespace inside (only trims emptiness check)", () => {
      const { entries } = parsePrefaceConfig([
        { when: "always", body: "  line one\nline two  " },
      ]);
      expect(entries[0].body).toBe("  line one\nline two  ");
    });
  });

  describe("non-array input", () => {
    it("returns empty + warning for an object", () => {
      const { entries, warnings } = parsePrefaceConfig({ when: "always", body: "x" });
      expect(entries).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/array/);
    });

    it("returns empty + warning for null", () => {
      const { entries, warnings } = parsePrefaceConfig(null);
      expect(entries).toEqual([]);
      expect(warnings).toHaveLength(1);
    });

    it("returns empty + warning for a string", () => {
      const { entries, warnings } = parsePrefaceConfig("not an array");
      expect(entries).toEqual([]);
      expect(warnings).toHaveLength(1);
    });
  });

  describe("unknown when", () => {
    it("skips the entry and warns", () => {
      const { entries, warnings } = parsePrefaceConfig([
        { when: "skill_active", body: "x" },
      ]);
      expect(entries).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/unknown.*when/);
    });

    it("keeps valid siblings around an unknown-when entry", () => {
      const { entries, warnings } = parsePrefaceConfig([
        { when: "always", body: "keep" },
        { when: "bogus", body: "drop" },
        { when: "skill_launched", body: "keep2" },
      ]);
      expect(entries.map((e) => e.body)).toEqual(["keep", "keep2"]);
      expect(warnings).toHaveLength(1);
    });
  });

  describe("missing or empty body", () => {
    it("skips a missing body and warns", () => {
      const { entries, warnings } = parsePrefaceConfig([{ when: "always" }]);
      expect(entries).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/body/);
    });

    it("skips a non-string body and warns", () => {
      const { entries, warnings } = parsePrefaceConfig([
        { when: "always", body: 42 },
      ]);
      expect(entries).toEqual([]);
      expect(warnings).toHaveLength(1);
    });

    it("skips a whitespace-only body and warns", () => {
      const { entries, warnings } = parsePrefaceConfig([
        { when: "always", body: "   \n\t " },
      ]);
      expect(entries).toEqual([]);
      expect(warnings).toHaveLength(1);
    });
  });

  describe("malformed items", () => {
    it("skips a null item and warns", () => {
      const { entries, warnings } = parsePrefaceConfig([null, { when: "always", body: "ok" }]);
      expect(entries.map((e) => e.body)).toEqual(["ok"]);
      expect(warnings).toHaveLength(1);
    });

    it("skips a primitive item and warns", () => {
      const { entries, warnings } = parsePrefaceConfig(["str", { when: "always", body: "ok" }]);
      expect(entries.map((e) => e.body)).toEqual(["ok"]);
      expect(warnings).toHaveLength(1);
    });

    it("skips an array item and warns", () => {
      const { entries, warnings } = parsePrefaceConfig([[], { when: "always", body: "ok" }]);
      expect(entries.map((e) => e.body)).toEqual(["ok"]);
      expect(warnings).toHaveLength(1);
    });
  });

  it("never throws", () => {
      expect(() => parsePrefaceConfig(undefined)).not.toThrow();
      expect(() => parsePrefaceConfig([])).not.toThrow();
  });
});
