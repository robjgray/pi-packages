/**
 * pi-foremost — top-of-mind injection for pi.
 *
 * Registers two extension handlers against the public `ExtensionAPI`:
 *
 *   - `session_start` → (re)load the foremost content from disk (global +
 *     project). `session_start` fires on startup and on `/reload`, so edits to
 *     the markdown files are picked up without a full restart.
 *   - `context`       → before every LLM call, compose the `<foremost>` block
 *     from the cached content and prepend it to the latest user-side message.
 *     The transform is transient: it shapes what the provider sees, never the
 *     persisted transcript (the agent loop uses `transformContext` only for the
 *     `convertToLlm` step).
 *
 * No tools, no commands, no UI — foremost is a listener only, which is why the
 * package has no `@sinclair/typebox` dependency.
 */

import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { composeForemostBlock } from "#src/content";
import { injectForemost } from "#src/inject";
import { ForemostSettings } from "#src/settings";

export default function (pi: ExtensionAPI): void {
  const settings = new ForemostSettings();

  pi.on("session_start", (_event, ctx) => {
    settings.load(ctx.cwd, getAgentDir());
  });

  pi.on("context", (event) => {
    const block = composeForemostBlock(settings.content);
    if (!block) return; // nothing configured — leave the context untouched
    return { messages: injectForemost(event.messages, block) };
  });
}
