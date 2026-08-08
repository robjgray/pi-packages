import { afterEach, describe, expect, it, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

import { AccessPath } from "#src/access-intent/access-path";
import { BashProgram } from "#src/access-intent/bash/program";
import { describeBashPathGate } from "#src/handlers/gates/bash-path";
import type {
  GateBypass,
  GateDescriptor,
  GateResult,
} from "#src/handlers/gates/descriptor";
import { isGateBypass, isGateDescriptor } from "#src/handlers/gates/descriptor";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { pathFlavorForPlatform, posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { getNonEmptyString, toRecord } from "#src/value-guards";

import {
  makeGateCheckResult as makeCheckResult,
  makePathDispatchResolver,
  makeResolver,
  makeTcc,
} from "#test/helpers/gate-fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Mirror the handler's parse-once derivation: parse the bash command into a
 * shared `BashProgram` and inject it, exactly as `permission-gate-handler.ts`
 * does, so the gate is exercised through the production wiring.
 */
async function describeGate(
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
): Promise<GateResult> {
  return describeGateOnPlatform(process.platform, tcc, resolver);
}

/**
 * Variant of {@link describeGate} that injects an explicit host platform, so a
 * win32-specific decision can be exercised on a POSIX CI host (and vice versa)
 * without mocking `node:path` (#520).
 */
async function describeGateOnPlatform(
  platform: NodeJS.Platform,
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
): Promise<GateResult> {
  const command = getNonEmptyString(toRecord(tcc.input).command);
  const bashProgram =
    tcc.toolName === "bash" && command
      ? await BashProgram.parse(
          command,
          new PathNormalizer(pathFlavorForPlatform(platform), tcc.cwd),
        )
      : null;
  return describeBashPathGate(tcc, bashProgram, resolver);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("describeBashPathGate", () => {
  it("returns null for non-bash tools", async () => {
    const result = await describeGate(
      makeTcc({ toolName: "read", input: { path: ".env" } }),
      makeResolver(),
    );
    expect(result).toBeNull();
  });

  it("returns null when no tokens are extracted", async () => {
    const result = await describeGate(
      makeTcc({ input: { command: "echo hello" } }),
      makeResolver(),
    );
    expect(result).toBeNull();
  });

  it("returns null when all tokens evaluate to allow", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult({ state: "allow" })),
    );
    expect(result).toBeNull();
  });

  it("returns GateDescriptor when a token evaluates to deny", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult({ state: "deny", matchedPattern: "*.env" })),
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    // `cat .env` is a bash *read*; B′ routes reads to the `path` surface.
    expect(desc.surface).toBe("path");
    expect(desc.preCheck?.state).toBe("deny");
  });

  it("returns GateDescriptor when a token evaluates to ask", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult({ state: "ask", matchedPattern: "*" })),
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("ask");
  });

  it("descriptor includes triggering token in prompt message", async () => {
    const result = (await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult({ state: "deny", matchedPattern: "*.env" })),
    )) as GateDescriptor;
    expect(result.denialContext).toMatchObject({
      kind: "bash_path",
      command: "cat .env",
      pathValue: ".env",
    });
    expect(result.promptDetails.message).toContain(".env");
  });

  it("descriptor decision uses surface 'path'", async () => {
    const result = (await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult({ state: "deny", matchedPattern: "*.env" })),
    )) as GateDescriptor;
    // `cat .env` is a bash *read*; B′ routes reads to the `path` surface.
    expect(result.decision.surface).toBe("path");
  });

  it("carries the deciding token's access facts on promptDetails (bash path surface)", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*.env" }),
    );
    const result = (await describeGate(makeTcc(), resolver)) as GateDescriptor;
    // The facts are the string projection of the same AccessPath the gate
    // resolved for the deciding token.
    const intent = resolver.resolve.mock.calls.at(-1)?.[0];
    const path = intent?.kind === "access-path" ? intent.path : undefined;
    expect(path).toBeDefined();
    // `cat .env` is a bash *read*; B′ routes reads to the `path` surface, so
    // the deciding surface and access-intent facts both report `path`.
    expect(result.promptDetails.accessIntent).toEqual({
      surface: "path",
      matchValues: path?.matchValues(),
      boundaryValue: path?.boundaryValue(),
    });
  });

  it("returns GateBypass when session rule covers the path", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult({ state: "allow", source: "session" })),
    );
    expect(result).not.toBeNull();
    expect(isGateBypass(result)).toBe(true);
    expect((result as GateBypass).action).toBe("allow");
  });

  it("returns null when command is missing", async () => {
    const result = await describeGate(makeTcc({ input: {} }), makeResolver());
    expect(result).toBeNull();
  });

  it("evaluates most restrictive across multiple tokens", async () => {
    const resolver = makePathDispatchResolver(
      { "src/foo.ts": makeCheckResult({ state: "allow" }) },
      makeCheckResult({ state: "deny", matchedPattern: "*.env" }),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "cat src/foo.ts .env" } }),
      resolver,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).preCheck?.state).toBe("deny");
  });

  it("deny wins in multi-token: cp .env README.md", async () => {
    const resolver = makePathDispatchResolver(
      { ".env": makeCheckResult({ state: "deny", matchedPattern: "*.env" }) },
      makeCheckResult({ state: "allow" }),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "cp .env README.md" } }),
      resolver,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("deny");
    expect(desc.decision.value).toBe(".env");
  });

  it("extracts redirect target: echo test > .env triggers deny", async () => {
    const resolver = makePathDispatchResolver(
      { ".env": makeCheckResult({ state: "deny", matchedPattern: "*.env" }) },
      makeCheckResult({ state: "allow" }),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "echo test > .env" } }),
      resolver,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).preCheck?.state).toBe("deny");
  });

  it("returns null when all tokens match only the universal default", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(
        makeCheckResult({
          state: "ask",
          matchedPattern: undefined,
          source: "special",
          origin: "builtin",
        }),
      ),
    );
    expect(result).toBeNull();
  });

  it("ignores tokens matching universal default but fires for explicit rule matches", async () => {
    const resolver = makePathDispatchResolver(
      { ".env": makeCheckResult({ state: "deny", matchedPattern: "*.env" }) },
      // Other tokens match only the universal default (no matchedPattern)
      makeCheckResult({
        state: "ask",
        matchedPattern: undefined,
        source: "special",
        origin: "builtin",
      }),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "cat src/foo.ts .env" } }),
      resolver,
    );
    expect(result).not.toBeNull();
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("deny");
    expect(desc.decision.value).toBe(".env");
  });

  it("resolves cd-aware policy values while keeping the raw prompt token", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*" }),
    );
    const result = (await describeGate(
      makeTcc({
        input: { command: "cd nested && cat src/file.txt" },
        cwd: "/test/project",
      }),
      resolver,
    )) as GateDescriptor;

    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "access-path",
      surface: "path",
      path: AccessPath.forPath("src/file.txt", {
        cwd: "/test/project",
        resolveBase: "/test/project/nested",
        flavor: posixPathFlavor,
      }),
      agentName: undefined,
    });
    // The raw token drives the prompt, denial context, and session approval.
    expect(result.denialContext).toMatchObject({ pathValue: "src/file.txt" });
    expect(result.decision.value).toBe("src/file.txt");
  });

  it("does not resolve relative policy values through an unknown cd", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "deny", matchedPattern: "*" }),
    );
    await describeGate(
      makeTcc({
        input: { command: 'cd "$DIR" && cat src/foo.ts' },
        cwd: "/test/project",
      }),
      resolver,
    );

    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "access-path",
      surface: "path",
      path: AccessPath.forLiteral("src/foo.ts"),
      agentName: undefined,
    });
  });

  it("binds a current-directory token's session approval to the cwd subtree", async () => {
    const resolver = makeResolver(
      makeCheckResult({ state: "ask", matchedPattern: "*" }),
    );
    const result = (await describeGate(
      makeTcc({
        input: { command: "cat .env" },
        cwd: "/test/project",
      }),
      resolver,
    )) as GateDescriptor;

    expect(result.decision.value).toBe(".env");
    // `cat .env` is a bash *read*; B′ routes reads to the `path` surface.
    expect(result.sessionApproval?.surface).toBe("path");
    expect(result.sessionApproval?.representativePattern).toBe(
      "/test/project/*",
    );
  });
});

// bash_path surface (redirect-to-source / bare-token denies) ────────────
//
// The gate resolves redirect-target and promoted bare tokens against the
// `bash_path` surface — distinct from the cross-cutting `path` surface that
// gates `edit`/`write`/`read` tools. A `bash_path` deny blocks `bash` redirects
// to a source file without blocking `edit`/`write` to it, and without needing
// a `path` rule (so existing `path`-only configs are unaffected — #58).
describe("describeBashPathGate — bash_path surface", () => {
  it("denies a redirect target matching a bash_path rule", async () => {
    // `sed 's/a/b/' f > src/main.go` — the redirect target `src/main.go` is a
    // path-rule candidate (it contains `/`, so the broad classifier accepts it
    // without an existence probe); a `bash_path` deny on `*.go` blocks it.
    const resolver = makePathDispatchResolver(
      {
        "src/main.go": makeCheckResult({
          state: "deny",
          matchedPattern: "*.go",
        }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = (await describeGate(
      makeTcc({ input: { command: "sed 's/a/b/' f > src/main.go" } }),
      resolver,
    )) as GateDescriptor;

    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.preCheck?.matchedPattern).toBe("*.go");
    expect(result.decision.surface).toBe("bash_path");
    expect(result.sessionApproval?.surface).toBe("bash_path");
  });

  it("surfaces a bash_path deny-with-reason on the descriptor", async () => {
    const resolver = makePathDispatchResolver(
      {
        "src/main.go": makeCheckResult({
          state: "deny",
          matchedPattern: "*.go",
          reason: "Use the edit tool, not bash redirects",
        }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = (await describeGate(
      makeTcc({ input: { command: "echo x > src/main.go" } }),
      resolver,
    )) as GateDescriptor;

    expect(result.preCheck?.state).toBe("deny");
    expect(result.preCheck?.reason).toBe(
      "Use the edit tool, not bash redirects",
    );
    expect(result.denialContext).toMatchObject({
      kind: "bash_path",
      reason: "Use the edit tool, not bash redirects",
    });
  });

  it("returns null when no explicit bash_path rule matches (#58 compat)", async () => {
    // A config with no `bash_path` key — the universal default fires for every
    // token, so the gate skips (backward compatibility for path-only configs).
    const resolver = makeResolver(
      makeCheckResult({
        state: "ask",
        matchedPattern: undefined,
        source: "special",
        origin: "builtin",
      }),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "echo x > main.go" } }),
      resolver,
    );
    expect(result).toBeNull();
  });
});

// Home-relative path characterization (#350) ──────────────────────────────
//
// The parser extracts ~/... tokens from bash commands; the resolver receives
// the raw token and normalizeInput handles expansion. These tests verify the
// gate correctly dispatches ~/... tokens through the deny/ask path.

describe("describeBashPathGate — home-relative paths", () => {
  it("extracts ~/... token and builds descriptor on deny", async () => {
    // node:os is mocked: homedir() returns "/mock/home".
    // cat ~/.ssh/config → token "~/.ssh/config" extracted.
    const resolver = makePathDispatchResolver(
      {
        "/mock/home/.ssh/config": makeCheckResult({
          state: "deny",
          matchedPattern: "~/.ssh/*",
        }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = (await describeGate(
      makeTcc({ input: { command: "cat ~/.ssh/config" } }),
      resolver,
    )) as GateDescriptor;

    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.denialContext).toMatchObject({
      kind: "bash_path",
      command: "cat ~/.ssh/config",
      pathValue: "~/.ssh/config",
    });
  });

  it("extracts $HOME/... token and builds descriptor on deny", async () => {
    const resolver = makePathDispatchResolver(
      {
        "/mock/home/.ssh/config": makeCheckResult({
          state: "deny",
          matchedPattern: "$HOME/.ssh/*",
        }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = (await describeGate(
      makeTcc({ input: { command: "cat $HOME/.ssh/config" } }),
      resolver,
    )) as GateDescriptor;

    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.denialContext).toMatchObject({
      kind: "bash_path",
      pathValue: "$HOME/.ssh/config",
    });
  });
});

// Win32 backslash-relative path gating (#520) ──────────────────────────────
//
// On Windows a backslash is a path separator, so a backslash-relative bash
// argument (`cat dir\file`) must be gated by a `path` rule the same as its
// forward-slash equivalent (`dir/file`). On POSIX `\` is a legal filename
// character, so the token stays bare and is not gated.

describe("describeBashPathGate — win32 backslash-relative paths", () => {
  it("denies a backslash-relative token matching a path rule on win32", async () => {
    // The win32 normalizer resolves `dir\file` to matchValues including the
    // relative `dir\file` alias, which the rule (`dir/file`, folded to
    // `dir\file` under win32 separators) matches.
    const resolver = makePathDispatchResolver(
      {
        "dir\\file": makeCheckResult({
          state: "deny",
          matchedPattern: "dir/file",
        }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = (await describeGateOnPlatform(
      "win32",
      makeTcc({
        input: { command: "cat dir\\file" },
        cwd: "C:\\Projects\\App",
      }),
      resolver,
    )) as GateDescriptor;

    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.denialContext).toMatchObject({
      kind: "bash_path",
      pathValue: "dir\\file",
    });
  });

  it("does not gate a backslash-relative token on posix (stays bare)", async () => {
    const resolver = makePathDispatchResolver(
      {
        "dir\\file": makeCheckResult({
          state: "deny",
          matchedPattern: "dir/file",
        }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = await describeGateOnPlatform(
      "linux",
      makeTcc({
        input: { command: "cat dir\\file" },
        cwd: "/projects/app",
      }),
      resolver,
    );
    expect(result).toBeNull();
  });
});

// B′ — redirect-scope + backward-compat fallback ─────────────────────────
//
// `bash_path` gates bash *writes* (file_redirect destinations); bash *reads*
// (bare-filename arguments) resolve against the cross-cutting `path` surface.
// A `bash_path` write with no explicit `bash_path` rule falls back to `path`,
// so a `path`-only config keeps bash read+write protection (no silent regression).
describe("describeBashPathGate — B′ redirect-scope + path fallback", () => {
  // A redirect (write) token resolves against `bash_path`; a read (argument)
  // token resolves against `path`. The per-surface stub distinguishes them so
  // each route can be exercised independently.
  function surfaceDispatchResolver(
    bySurface: Record<string, ReturnType<typeof makeCheckResult>>,
  ) {
    const resolve = vi.fn<ScopedPermissionResolver["resolve"]>();
    resolve.mockImplementation((intent) => {
      if (intent.kind === "access-path") {
        return bySurface[intent.surface] ?? makeCheckResult({ state: "allow" });
      }
      return makeCheckResult({ state: "allow" });
    });
    return { resolve };
  }

  it("routes a redirect (write) to bash_path and denies on a bash_path rule", async () => {
    const resolver = surfaceDispatchResolver({
      bash_path: makeCheckResult({
        state: "deny",
        matchedPattern: "*.go",
        source: "special",
        origin: "global",
      }),
    });
    const result = (await describeGate(
      makeTcc({ input: { command: "echo x > src/main.go" } }),
      resolver,
    )) as GateDescriptor;
    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.surface).toBe("bash_path");
    expect(result.decision.surface).toBe("bash_path");
    expect(result.sessionApproval?.surface).toBe("bash_path");
  });

  it("routes a read (argument) to path, not bash_path", async () => {
    // `cat src/main.go` is a read. A `bash_path` deny must NOT block it; a
    // `path` deny DOES block it (the read resolves to `path`).
    const resolver = surfaceDispatchResolver({
      bash_path: makeCheckResult({
        state: "deny",
        matchedPattern: "*.go",
        source: "special",
        origin: "global",
      }),
      path: makeCheckResult({
        state: "allow",
        source: "special",
        origin: "global",
      }),
    });
    const result = await describeGate(
      makeTcc({ input: { command: "cat src/main.go" } }),
      resolver,
    );
    expect(result).toBeNull();
  });

  it("a read is denied by a path rule (read routes to path)", async () => {
    const resolver = surfaceDispatchResolver({
      path: makeCheckResult({
        state: "deny",
        matchedPattern: "*.go",
        source: "special",
        origin: "global",
      }),
    });
    const result = (await describeGate(
      makeTcc({ input: { command: "cat src/main.go" } }),
      resolver,
    )) as GateDescriptor;
    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.surface).toBe("path");
    expect(result.sessionApproval?.surface).toBe("path");
  });

  it("falls back to path for a write with no explicit bash_path rule (#58 + B′)", async () => {
    // A `path`-only config (no `bash_path` key): a redirect write falls back
    // from `bash_path` (no explicit rule) to `path`, which denies — so a
    // path-only config keeps bash write protection (no silent regression).
    const resolver = surfaceDispatchResolver({
      bash_path: makeCheckResult({
        state: "ask",
        matchedPattern: undefined,
        source: "special",
        origin: "builtin",
      }),
      path: makeCheckResult({
        state: "deny",
        matchedPattern: "*.env",
        source: "special",
        origin: "global",
      }),
    });
    const result = (await describeGate(
      makeTcc({ input: { command: "echo secret > .env" } }),
      resolver,
    )) as GateDescriptor;
    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    // The fallback decided on `path`, so the descriptor/session-approval scope
    // to `path` (a future write re-runs bash_path → fallback → path session rule).
    expect(result.surface).toBe("path");
    expect(result.sessionApproval?.surface).toBe("path");
  });

  it("a path-only config keeps a bash read denied (no silent regression)", async () => {
    // Boundary regression: `cat .env` (read) under a `path`-only deny stays
    // denied — the read routes to `path` directly.
    const resolver = surfaceDispatchResolver({
      path: makeCheckResult({
        state: "deny",
        matchedPattern: "*.env",
        source: "special",
        origin: "global",
      }),
    });
    const result = (await describeGate(
      makeTcc({ input: { command: "cat .env" } }),
      resolver,
    )) as GateDescriptor;
    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.surface).toBe("path");
  });

  it("a `<` input-redirect routes the destination to path (read), not bash_path", async () => {
    // P2: `cat < .env` is a read — the `.env` destination is tagged
    // `argument`, so it resolves against `path` only. A `bash_path` deny must
    // not block it.
    const resolver = surfaceDispatchResolver({
      bash_path: makeCheckResult({
        state: "deny",
        matchedPattern: "*.env",
        source: "special",
        origin: "global",
      }),
      path: makeCheckResult({
        state: "allow",
      }),
    });
    const result = await describeGate(
      makeTcc({ input: { command: "cat < .env" } }),
      resolver,
    );
    expect(result).toBeNull();
  });

  it("a `<` input-redirect is denied by a path deny (read routes to path)", async () => {
    const resolver = surfaceDispatchResolver({
      bash_path: makeCheckResult({
        state: "allow",
      }),
      path: makeCheckResult({
        state: "deny",
        matchedPattern: "*.env",
        source: "special",
        origin: "global",
      }),
    });
    const result = (await describeGate(
      makeTcc({ input: { command: "cat < .env" } }),
      resolver,
    )) as GateDescriptor;
    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.surface).toBe("path");
  });

  it("a `bash_path` catch-all allow does not bypass a path deny for a write", async () => {
    // Headline B′ contract at the gate level: `bash_path: { "*": "allow" }` +
    // `path: { "*.env": "deny" }` → `echo > .env` denied. The catch-all allow
    // sets matchedPattern "*" but the path deny wins most-restrictive.
    const resolver = surfaceDispatchResolver({
      bash_path: makeCheckResult({
        state: "allow",
        matchedPattern: "*",
        source: "special",
        origin: "global",
      }),
      path: makeCheckResult({
        state: "deny",
        matchedPattern: "*.env",
        source: "special",
        origin: "global",
      }),
    });
    const result = (await describeGate(
      makeTcc({ input: { command: "echo secret > .env" } }),
      resolver,
    )) as GateDescriptor;
    expect(isGateDescriptor(result)).toBe(true);
    expect(result.preCheck?.state).toBe("deny");
    expect(result.surface).toBe("path");
    expect(result.preCheck?.matchedPattern).toBe("*.env");
  });
});
