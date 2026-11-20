// AC-2: target path extraction.
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_TARGETS, extractTargets } from "../src/extract.js";
import type { HookInput } from "../src/types.js";
import { makeSandbox, patchInput, preToolUse, write, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

const p = (...parts: string[]) => path.join(sb.repo, ...parts);
const targets = (tool: string, toolInput: unknown) =>
  extractTargets(preToolUse(sb.repo, tool, toolInput) as unknown as HookInput);
const bash = (command: string) => targets("Bash", { command });

describe("apply_patch (AC-2)", () => {
  it("reads Add, Update, Delete and Move to headers", () => {
    const command = [
      "*** Begin Patch",
      "*** Add File: packages/api/new.ts",
      "+x",
      "*** Update File: packages/web/src/app.ts",
      "*** Move to: packages/legacy/src/moved.ts",
      "*** Delete File: packages/empty/src/e.ts",
      "*** End Patch",
    ].join("\n");
    expect(targets("apply_patch", { command })).toEqual([
      p("packages/api/new.ts"),
      p("packages/web/src/app.ts"),
      p("packages/legacy/src/moved.ts"),
      p("packages/empty/src/e.ts"),
    ]);
  });

  it("ignores lines that only look like headers inside the patch body", () => {
    const command = "*** Begin Patch\n*** Update File: a.ts\n+text *** Add File: nope.ts\n*** End Patch\n";
    expect(targets("apply_patch", { command })).toEqual([p("a.ts")]);
  });

  it("works with the simple helper input", () => {
    expect(targets("apply_patch", patchInput("packages/api/src/h.ts"))).toEqual([p("packages/api/src/h.ts")]);
  });
});

describe("Bash (AC-2)", () => {
  it("follows cd and resolves later arguments against it", () => {
    expect(bash("cd packages/web && cat src/app.ts")).toEqual([p("packages/web"), p("packages/web/src/app.ts")]);
  });

  it("handles pushd", () => {
    expect(bash("pushd packages/api; ls src")).toEqual([p("packages/api"), p("packages/api/src")]);
  });

  it("handles git -C", () => {
    expect(bash("git -C packages/api status src")).toEqual([p("packages/api"), p("packages/api/src")]);
  });

  it("unwraps bash -lc one level", () => {
    expect(bash("bash -lc 'cd packages/legacy && cat src/old.ts'")).toEqual([
      p("packages/legacy"),
      p("packages/legacy/src/old.ts"),
    ]);
  });

  it("splits on &&, ;, | and ||", () => {
    expect(bash("cat packages/api/AGENTS.md | head -n 1; ls packages/web || ls packages/legacy")).toEqual([
      p("packages/api/AGENTS.md"),
      p("packages/web"),
      p("packages/legacy"),
    ]);
  });

  it("reports quoted paths and redirect targets whose folder exists", () => {
    expect(bash("echo hi > 'packages/api/out.txt' 2>/dev/null")).toContain(p("packages/api/out.txt"));
    expect(bash("cat < packages/web/AGENTS.md")).toContain(p("packages/web/AGENTS.md"));
  });

  it("ignores arguments that do not exist, flags, variables and unbalanced input", () => {
    expect(bash("grep -rn needle nothing/here $HOME ~/x --color=always")).toEqual([]);
    expect(bash("echo 'unterminated")).toEqual([]);
  });

  it("does not follow a cd to a missing folder", () => {
    expect(bash("cd missing && cat AGENTS.md")).toEqual([p("AGENTS.md")]);
  });
});

describe("MCP tools (AC-2)", () => {
  it("reads path-like keys and arrays, even for files that do not exist yet", () => {
    expect(
      targets("mcp__fs__write", { path: "packages/api/new.ts", paths: ["packages/web/a.ts"], content: "x", other: "ignored/z.ts" }),
    ).toEqual([p("packages/api/new.ts"), p("packages/web/a.ts")]);
  });

  it("reads source and destination", () => {
    expect(targets("mcp__fs__move", { source: "a/x.ts", destination: "b/y.ts" })).toEqual([p("a/x.ts"), p("b/y.ts")]);
  });

  it("ignores non-string values and unknown tools", () => {
    expect(targets("mcp__x__y", { path: 5, paths: [1, {}] })).toEqual([]);
    expect(targets("WebSearch", { query: "x" })).toEqual([]);
  });
});

describe("limits (AC-2)", () => {
  it("returns at most 64 distinct targets", () => {
    const lines = ["*** Begin Patch"];
    for (let i = 0; i < 100; i++) lines.push("*** Add File: gen/f" + i + ".ts");
    lines.push("*** End Patch");
    const out = targets("apply_patch", { command: lines.join("\n") });
    expect(out).toHaveLength(MAX_TARGETS);
    expect(new Set(out).size).toBe(MAX_TARGETS);
  });

  it("de-duplicates repeated targets", () => {
    write(p("dup.txt"), "x");
    expect(bash("cat dup.txt dup.txt ./dup.txt")).toEqual([p("dup.txt")]);
  });
});
