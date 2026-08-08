import type { AccessPath } from "#src/access-intent/access-path";
import type {
  BashPathRuleCandidate,
  BashProgram,
} from "#src/access-intent/bash/program";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { SessionApproval } from "#src/session-approval";
import { deriveApprovalPattern } from "#src/session-rules";
import type { PermissionCheckResult } from "#src/types";
import { pickMostRestrictive } from "./candidate-check";
import type { GateResult } from "./descriptor";
import { accessFactsFromPath } from "./helpers";
import { formatPathAskPrompt } from "./path";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the cross-cutting path permission gate (bash).
 *
 * Reads path-rule candidates from the injected `BashProgram` (the broader
 * `path`-rule filter, accepting dot-files and relative paths). Each candidate
 * pairs the raw token with cd-aware policy values and an `origin` tagging it
 * as a `file_redirect` destination (a bash **write**) or a command argument
 * (a bash **read**).
 *
 * B′ — the gate routes each token by origin:
 * - a **write** (redirect) token resolves against **both** the `bash_path` and
 *   `path` surfaces, and the most restrictive wins (`deny` > `ask` > `allow`).
 *   `bash_path` can therefore only **add** restrictions: a `path` deny always
 *   holds for bash writes, and a `bash_path: { "*": "allow" }` catch-all does
 *   **not** bypass a `path` deny. A `bash_path` deny still denies (more
 *   restrictive). A `path`-only config keeps bash write protection — its `path`
 *   deny is the deciding rule — with no `bash_path` key needed.
 * - a **read** (argument) token resolves against the cross-cutting `path`
 *   surface only — the same gate `edit`/`write`/`read` tools use — so a
 *   `bash_path` deny cannot block a bash read, and a `path`-only config keeps
 *   bash read protection.
 *
 * `bash_path` therefore means "bash writes via redirect to these paths";
 * `path`-only configs keep bash read+write protection via the read route and
 * the write most-restrictive composition (no silent regression, true `feat`
 * minor). The descriptor,
 * session approval, and decision event carry the surface that actually
 * decided (so a session rule recorded on `path` for a read matches a future
 * read, and one on `bash_path` for a write matches a future write), while the
 * denial context stays `kind: "bash_path"` (it is a bash access either way).
 * Most restrictive result across all tokens wins; prompts, logs, and session
 * approvals use the raw token.
 *
 * Returns `null` when the gate does not apply (not a shell invocation, no
 * command, no tokens extracted, or all tokens evaluate to `allow`).
 * Returns a `GateBypass` when all tokens are session-covered.
 * Returns a `GateDescriptor` for the most restrictive token needing a check.
 *
 * The shell command (native `bash` or an aliased shell tool) is read from the
 * injected `BashProgram`, which owns the source text it was parsed from, so
 * this gate does not re-derive the input field name (#574).
 */
export function describeBashPathGate(
  tcc: ToolCallContext,
  bashProgram: BashProgram | null,
  resolver: ScopedPermissionResolver,
): GateResult {
  if (!bashProgram) return null;
  const command = bashProgram.commandText();

  const candidates = bashProgram.pathRuleCandidates();
  if (candidates.length === 0) return null;
  const tokens = candidates.map(({ token }) => token);

  // Tokens whose resolved state needs a check (deny/ask), paired with the raw
  // token (prompt/decision display), its `AccessPath`, and the surface that
  // decided (so the descriptor/session-approval/decision scope to the rule
  // that actually matched).
  const uncovered: Array<{
    token: string;
    path: AccessPath;
    surface: string;
    check: PermissionCheckResult;
  }> = [];
  let allSessionCovered = true;

  for (const { token, path, origin } of candidates) {
    const { check, surface } = resolveBashPathToken(
      origin,
      path,
      tcc.agentName ?? undefined,
      resolver,
    );

    // No explicit rule matched on the deciding surface — only the universal
    // default fired on every surface that was resolved. Treat this token as
    // unrestricted to preserve backward compatibility for configs without a
    // relevant key (#58). For a write, both `bash_path` and `path` resolved to
    // the universal default, so neither adds a restriction (B′).
    if (check.matchedPattern === undefined && check.source !== "session") {
      allSessionCovered = false;
      continue;
    }

    if (check.source !== "session") {
      allSessionCovered = false;
    }

    if (check.state === "deny") {
      uncovered.push({ token, path, surface, check });
      break; // Short-circuit on deny.
    }
    if (check.state === "ask") {
      uncovered.push({ token, path, surface, check });
    }
  }

  // All tokens are session-covered — bypass.
  if (allSessionCovered) {
    return {
      action: "allow",
      log: {
        event: "permission_request.session_approved",
        details: {
          source: "tool_call",
          toolCallId: tcc.toolCallId,
          toolName: tcc.toolName,
          agentName: tcc.agentName,
          command,
          tokens,
          resolution: "session_approved",
        },
      },
    };
  }

  // Pick the most restrictive (deny > ask > allow, first-wins) uncovered token.
  const worstCheck = pickMostRestrictive(uncovered.map(({ check }) => check));
  const worstEntry = worstCheck
    ? uncovered.find(({ check }) => check === worstCheck)
    : undefined;
  const worstToken = worstEntry?.token ?? null;

  // All tokens evaluate to allow — no restriction.
  if (!worstCheck || !worstToken || !worstEntry) return null;

  const { surface, path: worstPath, check: deciding } = worstEntry;

  // Derive the pattern from the lexical absolute form (the cd-aware resolved
  // path), so it matches the values a later call produces. For an unknown base
  // (`forLiteral`) `value()` is the raw token.
  const pattern = deriveApprovalPattern(worstPath.value());
  const askMessage = formatPathAskPrompt(
    tcc.toolName,
    worstToken,
    tcc.agentName ?? undefined,
  );

  return {
    surface,
    input: { path: worstToken },
    denialContext: {
      kind: "bash_path",
      command,
      pathValue: worstToken,
      agentName: tcc.agentName ?? undefined,
      reason: deciding.reason,
    },
    sessionApproval: SessionApproval.single(surface, pattern),
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: askMessage,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      command,
      accessIntent: accessFactsFromPath(surface, worstPath),
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      command,
      path: worstToken,
    },
    decision: {
      surface,
      value: worstToken,
    },
    preCheck: deciding,
  };
}

/**
 * Resolve one bash path token against the B′ surface routing.
 *
 * A `redirect` (write) token resolves against **both** `bash_path` and `path`,
 * and the most restrictive wins — `bash_path` can only add restrictions, so a
 * `path` deny always holds for bash writes (a `bash_path: { "*": "allow" }`
 * catch-all does not bypass it), and a `path`-only config keeps protecting
 * bash writes with no `bash_path` key. An `argument` (read) token resolves
 * against `path` directly — the surface `edit`/`write`/`read` tools use — so a
 * `bash_path` deny cannot block a bash read, and a `path`-only config keeps
 * protecting bash reads.
 *
 * Returns the deciding `check` and the `surface` it came from (so the gate
 * scopes the descriptor, session approval, and decision event to that
 * surface).
 */
function resolveBashPathToken(
  origin: BashPathRuleCandidate["origin"],
  path: AccessPath,
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): { check: PermissionCheckResult; surface: string } {
  if (origin === "argument") {
    // A read resolves against `path` only — `bash_path` never gates reads.
    return {
      check: resolver.resolve({
        kind: "access-path",
        surface: "path",
        path,
        agentName,
      }),
      surface: "path",
    };
  }
  // origin === "redirect" (write): resolve BOTH `bash_path` and `path`, most
  // restrictive wins (deny > ask > allow). `bash_path` can only add
  // restrictions — a `path` deny always holds for bash writes, and a
  // `bash_path: { "*": "allow" }` catch-all does NOT bypass a `path` deny. A
  // `bash_path` deny still denies (more restrictive). On a tie the first-wins
  // rule attributes the decision to `bash_path`.
  const bashPathCheck = resolver.resolve({
    kind: "access-path",
    surface: "bash_path",
    path,
    agentName,
  });
  const pathCheck = resolver.resolve({
    kind: "access-path",
    surface: "path",
    path,
    agentName,
  });
  const worst = pickMostRestrictive([bashPathCheck, pathCheck]) ?? pathCheck;
  return {
    check: worst,
    surface: worst === bashPathCheck ? "bash_path" : "path",
  };
}
