import { basename } from "node:path";
import {
  ARG_NODE_TYPES,
  resolveNodeText,
  SKIP_SUBTREE_TYPES,
} from "#src/access-intent/bash/node-text";
import type { TSNode } from "#src/access-intent/bash/parser";

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Where a collected token came from in the bash AST.
 *
 * - `argument` — a command argument (a bare filename the command reads, e.g.
 *   `cat .env`). These are bash *reads* and resolve against the cross-cutting
 *   `path` surface in the `bash_path` gate (B′): a `bash_path` deny must not
 *   block them.
 * - `redirect` — a `file_redirect` destination for a **write** operator
 *   (`>`/`>>`/`&>`/`&>>`, e.g. `echo x > main.go`). These resolve against
 *   the `bash_path` surface (most-restrictive with `path`) in the `bash_path`
 *   gate (B′): a `bash_path` deny blocks the redirect without blocking
 *   `edit`/`write`.
 * - a `file_redirect` destination for a **read** operator (`<`/`<&`/`<<<`,
 *   e.g. `cat < .env`) is tagged `argument` too — it is a bash *read* and
 *   resolves against the cross-cutting `path` surface, so a `bash_path` deny
 *   must not block it.
 */
export type TokenOrigin = "redirect" | "argument";

/** A path-candidate token paired with its AST origin (read argument vs write redirect). */
export interface CollectedToken {
  readonly token: string;
  readonly origin: TokenOrigin;
}

/** Tag a command-argument token (a bash read). */
function arg(token: string): CollectedToken {
  return { token, origin: "argument" };
}

/** Tag a redirect-destination token (a bash write). */
function redirect(token: string): CollectedToken {
  return { token, origin: "redirect" };
}

/**
 * Recursively visit the AST and collect resolved text of nodes that
 * represent command arguments or redirect destinations, tagged with their
 * origin so the `bash_path` gate can route reads to `path` and writes to
 * `bash_path` (B′).
 *
 * Skips `heredoc_body`, `heredoc_end`, and `comment` subtrees entirely.
 *
 * For commands in `PATTERN_FIRST_COMMANDS`, uses position-based
 * argument skipping to avoid collecting inline patterns/scripts
 * as path candidates. For all other commands, collects all
 * arguments generically.
 */
export function collectPathCandidateTokens(node: TSNode): CollectedToken[] {
  if (SKIP_SUBTREE_TYPES.has(node.type)) return [];
  if (node.type === "command") return collectCommandTokens(node);
  if (node.type === "file_redirect") return collectRedirectTokens(node);

  const tokens: CollectedToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) tokens.push(...collectPathCandidateTokens(child));
  }
  return tokens;
}

/**
 * Select the collection strategy for a `command` node: pattern-first
 * commands use `collectPatternCommandTokens`; all others use
 * `collectGenericCommandTokens`.
 */
export function collectCommandTokens(node: TSNode): CollectedToken[] {
  const commandName = extractCommandName(node);
  const config = commandName
    ? PATTERN_FIRST_COMMANDS.get(commandName)
    : undefined;
  const tokens = config
    ? collectPatternCommandTokens(node, config)
    : collectGenericCommandTokens(node);
  return [...tokens, ...collectEmbeddedOptionValues(node)];
}

/**
 * Collect redirect-destination tokens from a `file_redirect` node, tagged by
 * operator: a **read** operator (`<`, `<&`, `<<<`) tags the destination
 * as `argument` (a bash read, routed to `path`); a **write** operator (`>`,
 * `>>`, `&>`, `&>>`, `<>`) tags it as `redirect` (a bash write, routed to
 * `bash_path`). An unrecognized operator defaults to `redirect` (write) to
 * stay conservative (P2).
 */
export function collectRedirectTokens(node: TSNode): CollectedToken[] {
  const operator = redirectOperator(node);
  const tag =
    operator !== undefined && isReadRedirectOperator(operator) ? arg : redirect;
  const tokens: CollectedToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (ARG_NODE_TYPES.has(child.type)) {
      tokens.push(tag(resolveNodeText(child)));
    }
  }
  return tokens;
}

/**
 * Find the operator token of a `file_redirect` node — the child that is
 * neither a `file_descriptor` prefix (e.g. `0<`, `1>`) nor the destination
 * argument. Its `.text` is the redirect operator (`<`, `>`, `>>`, `&>`,
 * `&>>`, `<&`, `<<<`, `<>`, …).
 */
function redirectOperator(node: TSNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "file_descriptor") continue;
    if (ARG_NODE_TYPES.has(child.type)) continue;
    if (SKIP_SUBTREE_TYPES.has(child.type)) continue;
    return child.text;
  }
  return undefined;
}

/**
 * A read redirect opens the destination for input: the operator starts with
 * `<` and does not also write (`<`, `<&`, `<<<`). An operator that
 * contains `>` (`>`, `>>`, `&>`, `&>>`, `<>`) writes, so it is not a read.
 */
function isReadRedirectOperator(operator: string): boolean {
  return operator.startsWith("<") && !operator.includes(">");
}

/**
 * Extract the command name from a `command` node.
 * Returns the basename (e.g. `/usr/bin/sed` → `sed`), or undefined
 * if the command name cannot be determined (e.g. variable expansion).
 */
export function extractCommandName(node: TSNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name") {
      const text = resolveNodeText(child);
      return text ? basename(text) : undefined;
    }
  }
  return undefined;
}

// ── Private helpers and config ─────────────────────────────────────────────

/**
 * A long or short option carrying its value inline: one or two leading dashes,
 * a name containing no `=` or whitespace, then `=` and a non-empty value.
 * Only the first `=` separates, so `--opt=/tmp/a=b` yields `/tmp/a=b`.
 */
const OPTION_VALUE_PATTERN = /^-{1,2}[^=\s]+=(.+)$/;

/**
 * The values embedded in this command's `--opt=value` argument tokens.
 *
 * Read straight from the argument nodes rather than from the collected token
 * list, because a pattern-first command's collector classifies a flag and never
 * emits it — so `grep --file=/tmp/patterns` would otherwise lose the path.
 *
 * This is token *preprocessing*, not classification: the extracted value is
 * handed to the ordinary shape classifiers and existence probe, so
 * `--file=/tmp/patterns` reaches the path surfaces while `--format=json`
 * yields a bare `json` that names nothing and is dropped. Keeping the split
 * here is what lets the projection see option-embedded paths without per-command
 * option tables (ADR 0009, #645).
 */
function collectEmbeddedOptionValues(node: TSNode): CollectedToken[] {
  const values: CollectedToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name" || child.type === "variable_assignment")
      continue;
    if (!ARG_NODE_TYPES.has(child.type)) continue;

    const value = OPTION_VALUE_PATTERN.exec(resolveNodeText(child))?.[1];
    if (value !== undefined) values.push(arg(value));
  }
  return values;
}

interface PatternCommandConfig {
  /** Flags that consume the next argument as a non-path value (pattern, separator, etc.) */
  readonly argConsumingFlags: ReadonlySet<string>;
  /** Flags that consume the next argument as a file path */
  readonly fileConsumingFlags: ReadonlySet<string>;
  /**
   * Number of leading positional arguments that are patterns/scripts, not paths.
   * Default: 1 (covers sed, awk, grep, rg).
   * sd uses 2 (FIND and REPLACE_WITH are both non-path positionals).
   */
  readonly patternPositionals?: number;
}

/**
 * Commands whose first N positional arguments are inline patterns/scripts,
 * not filesystem paths. The map stores per-command flag configuration so
 * the walker can correctly identify which arguments are consumed by flags
 * vs. which are positional.
 */
const PATTERN_FIRST_COMMANDS: ReadonlyMap<string, PatternCommandConfig> =
  new Map([
    [
      "sed",
      {
        argConsumingFlags: new Set(["-e", "-i"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "awk",
      {
        argConsumingFlags: new Set(["-e", "-F", "-v"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "gawk",
      {
        argConsumingFlags: new Set(["-e", "-F", "-v"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "nawk",
      {
        argConsumingFlags: new Set(["-e", "-F", "-v"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "grep",
      {
        argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "egrep",
      {
        argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "fgrep",
      {
        argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "rg",
      {
        argConsumingFlags: new Set([
          "-e",
          "-A",
          "-B",
          "-C",
          "-m",
          "-g",
          "-t",
          "-T",
          "-j",
          "-M",
          "-r",
          "-E",
        ]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "sd",
      {
        argConsumingFlags: new Set(["-n", "-f"]),
        fileConsumingFlags: new Set([]),
        patternPositionals: 2,
      },
    ],
  ]);

/**
 * Describes what the walker should do when it encounters a flag word inside
 * a pattern-first command.  Using a discriminated union lets the `switch` in
 * `collectPatternCommandTokens` narrow `nextArgAction` without a non-null
 * assertion (which would trigger the Biome/ESLint assertion conflict).
 */
type PatternCommandFlagDirective =
  | { kind: "end-of-flags" }
  | { kind: "regular-flag" }
  | {
      kind: "consume-arg";
      nextArgAction: "skip" | "extract";
      setsExplicitScript: boolean;
    };

/**
 * Classify a flag word from a pattern-first command into a directive that
 * tells the walker how to handle the flag and its following argument.
 */
function classifyPatternCommandFlag(
  text: string,
  config: PatternCommandConfig,
): PatternCommandFlagDirective {
  if (text === "--") return { kind: "end-of-flags" };
  if (config.argConsumingFlags.has(text)) {
    return {
      kind: "consume-arg",
      nextArgAction: "skip",
      setsExplicitScript: text === "-e" || text === "-f",
    };
  }
  if (config.fileConsumingFlags.has(text)) {
    return {
      kind: "consume-arg",
      nextArgAction: "extract",
      setsExplicitScript: true,
    };
  }
  return { kind: "regular-flag" };
}

/**
 * Collect path-candidate tokens from a command known to have
 * pattern/script arguments in leading positional slots.
 *
 * Uses position-based skipping: the first N positional arguments
 * (where N = patternPositionals, default 1) are assumed to be
 * inline patterns/scripts and are skipped. Remaining positional
 * arguments are collected as path candidates.
 *
 * Flags listed in `argConsumingFlags` consume the next argument
 * (skipped). Flags in `fileConsumingFlags` consume the next
 * argument as a file path (collected). The flags `-e` and `-f`
 * additionally signal that an explicit script was provided via
 * flag, so no inline positional script is expected.
 */
function collectPatternCommandTokens(
  node: TSNode,
  config: PatternCommandConfig,
): CollectedToken[] {
  const patternPositionals = config.patternPositionals ?? 1;
  let hasExplicitScript = false;
  let positionalsSeen = 0;
  let nextArgAction: "skip" | "extract" | null = null;
  let pastEndOfFlags = false;
  const tokens: CollectedToken[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    // Skip command_name and variable_assignment nodes.
    if (child.type === "command_name" || child.type === "variable_assignment")
      continue;

    // Only process argument-like nodes; recurse into others
    // (e.g. command_substitution) for nested commands.
    if (!ARG_NODE_TYPES.has(child.type)) {
      tokens.push(...collectPathCandidateTokens(child));
      continue;
    }

    const text = resolveNodeText(child);

    // Handle consumed argument from previous flag.
    if (nextArgAction === "skip") {
      nextArgAction = null;
      continue;
    }
    if (nextArgAction === "extract") {
      tokens.push(arg(text));
      nextArgAction = null;
      continue;
    }

    // Flag detection (only before "--" end-of-flags marker).
    if (
      !pastEndOfFlags &&
      child.type === "word" &&
      text.startsWith("-") &&
      text.length > 1
    ) {
      const directive = classifyPatternCommandFlag(text, config);
      switch (directive.kind) {
        case "end-of-flags":
          pastEndOfFlags = true;
          break;
        case "consume-arg":
          nextArgAction = directive.nextArgAction;
          if (directive.setsExplicitScript) hasExplicitScript = true;
          break;
        case "regular-flag":
          break;
      }
      continue;
    }

    // Positional argument.
    if (!hasExplicitScript && positionalsSeen < patternPositionals) {
      positionalsSeen++;
      continue; // Skip: this is an inline pattern/script.
    }

    // File argument — collect as path candidate.
    tokens.push(arg(text));
  }

  return tokens;
}

/**
 * Collect all argument tokens from a generic (non-pattern-first) command node,
 * skipping the command name and variable assignments.
 */
function collectGenericCommandTokens(node: TSNode): CollectedToken[] {
  const tokens: CollectedToken[] = [];
  let seenCommandName = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "command_name") {
      seenCommandName = true;
      continue;
    }
    // Skip variable_assignment nodes (FOO=/bar)
    if (child.type === "variable_assignment") continue;

    // If there was no explicit command_name node, the first word-like
    // child is the command name itself — skip it.
    if (!seenCommandName && ARG_NODE_TYPES.has(child.type)) {
      seenCommandName = true;
      continue;
    }

    // Argument nodes: resolve their text and collect.
    if (ARG_NODE_TYPES.has(child.type)) {
      tokens.push(arg(resolveNodeText(child)));
      continue;
    }

    // Recurse into other children (e.g. command_substitution nested in args)
    tokens.push(...collectPathCandidateTokens(child));
  }

  return tokens;
}
