/**
 * pi-preface — top-of-mind injection for pi.
 *
 * Registers extension handlers against the public `ExtensionAPI`:
 *
 *   - `session_start` → (re)load the preface content from disk (global +
 *     project). `session_start` fires on startup and on `/reload`, so edits to
 *     the markdown files are picked up without a full restart.
 *   - `context`       → before every LLM call, compose the `<preface>` block
 *     from the cached content and prepend it to the latest user-side message.
 *     The transform is transient: it shapes what the provider sees, never the
 *     persisted transcript (the agent loop uses `transformContext` only for the
 *     `convertToLlm` step). While injecting, set a footer status line naming
 *     the contributing file(s) so the user can see preface is being sent.
 *   - `agent_settled`  → clear the footer line once the turn is fully idle, so
 *     the notice is present while preface is being sent and gone between turns.
 *
 * No tools, no commands, no persisted entries — preface is a listener only,
 * which is why the package has no `@sinclair/typebox` or `@earendil-works/pi-tui`
 * dependency.
 */

import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { composePrefaceBlock } from "#src/content";
import { injectPreface } from "#src/inject";
import { PrefaceSettings } from "#src/settings";

const STATUS_KEY = "preface";

export default function (pi: ExtensionAPI): void {
  const settings = new PrefaceSettings();

  pi.on("session_start", (_event, ctx) => {
    settings.load(ctx.cwd, getAgentDir());
    if (!settings.content) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });

  pi.on("context", (event, ctx) => {
    const block = composePrefaceBlock(settings.content);
    if (!block) return; // nothing configured — leave the context and footer untouched
    ctx.ui.setStatus(STATUS_KEY, footerText(settings.globalPath, settings.projectPath));
    return { messages: injectPreface(event.messages, block) };
  });

  pi.on("agent_settled", (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}

/** Single footer line naming each contributing file by layer, absolute paths. */
function footerText(globalPath: string | undefined, projectPath: string | undefined): string {
  const parts: string[] = [];
  if (globalPath) parts.push(`Preface (Global): ${globalPath}`);
  if (projectPath) parts.push(`Preface (Project): ${projectPath}`);
  return parts.join("  ");
}