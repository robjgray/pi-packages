import { describe, expect, it } from "vitest";
import { type InjectableMessage, injectPreface } from "#src/inject";

const BLOCK = "<preface>\nbe careful\n</preface>";

describe("injectPreface", () => {
  describe("gating", () => {
    it("is a no-op when the block is empty", () => {
      const messages: InjectableMessage[] = [{ role: "user", content: "hi" }];
      expect(injectPreface(messages, "")).toBe(messages);
    });

    it("is a no-op when messages is empty", () => {
      expect(injectPreface([], BLOCK)).toEqual([]);
    });

    it("is a no-op when the latest message is not user-side (e.g. an assistant turn)", () => {
      const messages: InjectableMessage[] = [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
      ];
      // Latest is assistant — don't reach back and rewrite the earlier user turn.
      expect(injectPreface(messages, BLOCK)).toBe(messages);
    });
  });

  describe("position", () => {
    it("prepends to the latest user message with string content (normalizes to array)", () => {
      const messages: InjectableMessage[] = [
        { role: "user", content: "do the thing" },
      ];
      const out = injectPreface(messages, BLOCK);
      expect(Array.isArray(out[0].content)).toBe(true);
      const arr = out[0].content as { type: string; text?: string }[];
      expect(arr[0]).toEqual({ type: "text", text: BLOCK });
      expect(arr[1]).toEqual({ type: "text", text: "do the thing" });
    });

    it("prepends to the latest user message with array content", () => {
      const messages: InjectableMessage[] = [
        { role: "user", content: [{ type: "text", text: "original" }] },
      ];
      const out = injectPreface(messages, BLOCK);
      const arr = out[0].content as { type: string; text?: string }[];
      expect(arr[0]).toEqual({ type: "text", text: BLOCK });
      expect(arr[1]).toEqual({ type: "text", text: "original" });
    });

    it("prepends to the latest toolResult message when it is last", () => {
      const messages: InjectableMessage[] = [
        { role: "user", content: "search" },
        { role: "assistant", content: [{ type: "toolCall" }] },
        { role: "toolResult", content: [{ type: "text", text: "result" }] },
      ];
      const out = injectPreface(messages, BLOCK);
      // Only the last (toolResult) message is touched.
      expect(out[0]).toBe(messages[0]);
      expect(out[1]).toBe(messages[1]);
      const arr = out[2].content as { type: string; text?: string }[];
      expect(arr[0]).toEqual({ type: "text", text: BLOCK });
      expect(arr[1]).toEqual({ type: "text", text: "result" });
    });
  });

  describe("non-mutation and edge cases", () => {
    it("does not mutate the input array or its messages", () => {
      const messages: InjectableMessage[] = [
        { role: "user", content: "original" },
      ];
      const originalSnapshot = JSON.stringify(messages);
      injectPreface(messages, BLOCK);
      expect(JSON.stringify(messages)).toBe(originalSnapshot);
    });

    it("treats a user message with no content as empty (prepends only the block)", () => {
      const out = injectPreface([{ role: "user" }] as InjectableMessage[], BLOCK);
      expect(out[0].content).toEqual([{ type: "text", text: BLOCK }]);
    });
  });
});
