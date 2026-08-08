import type {
  BashCommand,
  WrapperKind,
} from "#src/access-intent/bash/command-enumeration";
import { pickMostRestrictive } from "#src/handlers/gates/candidate-check";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { PermissionCheckResult } from "#src/types";

/**
 * Resolve the bash command-pattern decision for a (possibly chained) command.
 *
 * A bash invocation may be a shell program with several commands joined by
 * `&&`, `||`, `;`, `|`, `&`, or newlines. Matching the whole string against the
 * bash patterns lets a denied command ride through on an allowed leading one
 * (issue #301). Instead, the caller supplies the program's command units (from
 * the shared `BashProgram.commands()` parse) — including those nested inside
 * substitutions and subshells (#306); each is evaluated on the `bash` surface
 * and the most restrictive result wins (`deny > ask > allow`).
 *
 * The selected result carries the offending sub-command in `command`, its rule
 * in `matchedPattern`, and the offending command's execution context in
 * `commandContext` (set only for a nested command), so the prompt,
 * session-approval suggestion, and decision event scope to that command.
 *
 * A wrapper unit (flagged with a `wrapperKind` by the enumerator) hides or
 * indirects the command that should be gated, so an `allow` is floored up to a
 * synthetic `ask` — the `<opaque-bash-wrapper>` pattern for an inline-shell
 * payload (`bash -c`/`eval`, #481) or `<indirection-bash-wrapper>` for a
 * prefix/exec wrapper (`sudo`/`env`/`xargs`/`find -exec`/…, #490) — to keep it
 * from riding a permissive rule; an explicit `deny`/`ask` on the wrapper is left
 * untouched (`deny > ask > allow`).
 *
 * When `commands` is empty there are two cases. A trivially-empty command (an
 * empty, whitespace-only, or comment-only line) has genuinely nothing to gate,
 * so the whole `command` is resolved as before. A non-empty command that parsed
 * to zero command units (a parse anomaly or an opaque program) is raw-matched
 * on the `bash` surface: a real `deny` or `ask` rule (one whose
 * `matchedPattern` is not the universal default) is surfaced so the agent sees
 * the offending pattern, and only the universal default (or an allow) fails
 * closed to a synthetic `ask` so a permissive top-level `*` cannot silently
 * allow an unparseable command (e.g. `cd /repo && git push` riding a top-level
 * allow on the empty-parse path) — #452.
 *
 * Pure and synchronous: the (async, tree-sitter) parse happens once in the
 * handler, which passes the decomposed `commands` here.
 */
/**
 * The synthetic `matchedPattern` recorded when a wrapper unit's `allow` is
 * floored to `ask`, keyed by the wrapper kind that caused the floor.
 */
const WRAPPER_SENTINEL: Record<WrapperKind, string> = {
  "opaque-payload": "<opaque-bash-wrapper>",
  indirection: "<indirection-bash-wrapper>",
};

export function resolveBashCommandCheck(
  command: string,
  commands: BashCommand[],
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  if (commands.length === 0) {
    if (isTriviallyEmptyCommand(command)) {
      return resolver.resolve({
        kind: "tool",
        surface: "bash",
        input: { command },
        agentName,
      });
    }
    // A non-empty command that parsed to zero units (a parse anomaly or an
    // opaque program) still gets a raw-command resolve on the `bash` surface
    // so a `deny`/`ask` pattern catches the unparseable command's raw string
    // (B′: heredoc bodies and other string-based workarounds the unit
    // decomposition strips). A raw `deny` is the hard wall and is returned; a
    // raw `ask` whose `matchedPattern` is a real rule (not the universal
    // default) is returned too so the agent sees the offending pattern. Only
    // when no real rule matched (universal default, or an allow) does the
    // fail-closed `ask` floor apply so a permissive top-level `*` cannot
    // silently allow an unparseable command (#452).
    const rawCheck = resolver.resolve({
      kind: "tool",
      surface: "bash",
      input: { command },
      agentName,
    });
    if (
      (rawCheck.state === "deny" || rawCheck.state === "ask") &&
      rawCheck.matchedPattern !== undefined
    ) {
      return rawCheck;
    }
    return {
      state: "ask",
      toolName: "bash",
      source: "bash",
      origin: "builtin",
      command,
      matchedPattern: "<unparseable-bash-command>",
    };
  }

  const results = commands.map((cmd) => {
    const base = resolver.resolve({
      kind: "tool",
      surface: "bash",
      input: { command: cmd.text },
      agentName,
    });
    const result =
      cmd.wrapperKind && base.state === "allow"
        ? {
            ...base,
            state: "ask" as const,
            matchedPattern: WRAPPER_SENTINEL[cmd.wrapperKind],
          }
        : base;
    return cmd.context ? { ...result, commandContext: cmd.context } : result;
  });
  // Resolve the full raw command (heredoc body included) on the `bash` surface
  // and fold it into the pool so a `bash` pattern can match the entire command
  // string, not just the decomposed units — catching heredoc bodies and other
  // string-based workarounds the tree-sitter enumeration strips.
  const rawCheck = resolver.resolve({
    kind: "tool",
    surface: "bash",
    input: { command },
    agentName,
  });
  return pickMostRestrictive([...results, rawCheck]) ?? rawCheck;
}

/**
 * True when a command has genuinely nothing to gate: it is empty,
 * whitespace-only, or contains only comment lines (every non-blank line starts
 * with `#`). Such a command yields zero command units legitimately, so the
 * whole-string resolve is safe rather than a parse anomaly.
 */
function isTriviallyEmptyCommand(command: string): boolean {
  const lines = command
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.every((line) => line.startsWith("#"));
}
