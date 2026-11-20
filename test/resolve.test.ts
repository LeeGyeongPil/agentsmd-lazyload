// AC-1: chain rules match Codex.
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyBudget, findRoot, inspectFolder, resolve, resolveChain } from "../src/resolve.js";
import { CFG, makeSandbox, write, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

const rel = (files: { file: string }[]) => files.map((f) => path.relative(sb.repo, f.file));

describe("chain rules (AC-1)", () => {
  it("returns only the root file at the root", () => {
    expect(rel(resolveChain(sb.repo, CFG).entries)).toEqual(["AGENTS.md"]);
  });

  it("picks AGENTS.override.md over AGENTS.md and reports the shadowed file", () => {
    const dir = path.join(sb.repo, "packages", "web", "src");
    expect(rel(resolveChain(dir, CFG).entries)).toEqual(["AGENTS.md", "packages/web/AGENTS.override.md"]);
    const folder = inspectFolder(path.join(sb.repo, "packages", "web"), CFG);
    expect(folder.candidates.map((c) => [c.name, c.status])).toEqual([
      ["AGENTS.override.md", "chosen"],
      ["AGENTS.md", "shadowed"],
    ]);
  });

  it("uses fallback names only when the higher names are missing or empty", () => {
    const cfg = { ...CFG, fallbackNames: ["TEAM.md"] };
    write(path.join(sb.repo, "packages", "only-team", "TEAM.md"), "team\n");
    write(path.join(sb.repo, "packages", "api", "TEAM.md"), "ignored\n");
    write(path.join(sb.repo, "packages", "empty", "TEAM.md"), "fallback after empty\n");
    expect(rel(resolveChain(path.join(sb.repo, "packages", "only-team"), cfg).entries)).toEqual([
      "AGENTS.md",
      "packages/only-team/TEAM.md",
    ]);
    expect(rel(resolveChain(path.join(sb.repo, "packages", "api"), cfg).entries)).toEqual([
      "AGENTS.md",
      "packages/api/AGENTS.md",
    ]);
    expect(rel(resolveChain(path.join(sb.repo, "packages", "empty"), cfg).entries)).toEqual([
      "AGENTS.md",
      "packages/empty/TEAM.md",
    ]);
  });

  it("skips empty files", () => {
    expect(rel(resolveChain(path.join(sb.repo, "packages", "empty"), CFG).entries)).toEqual(["AGENTS.md"]);
  });

  it("treats the nearest root marker as the boundary (nested repo)", () => {
    const dir = path.join(sb.repo, "packages", "legacy", "src");
    const chain = resolveChain(dir, CFG);
    expect(chain.root).toBe(path.join(sb.repo, "packages", "legacy"));
    expect(rel(chain.entries)).toEqual(["packages/legacy/AGENTS.md"]);
  });

  it("uses only the folder itself when no marker exists or markers are empty", () => {
    const dir = path.join(sb.repo, "packages", "api");
    expect(findRoot(dir, [])).toEqual({ root: dir, marker: null });
    expect(findRoot(dir, [".nothing-here"])).toEqual({ root: dir, marker: null });
    expect(rel(resolveChain(dir, { ...CFG, rootMarkers: [] }).entries)).toEqual(["packages/api/AGENTS.md"]);
  });

  it("truncates the last file to the remaining bytes and flags it (budget 30)", () => {
    const r = resolve(path.join(sb.repo, "packages", "api"), { ...CFG, maxBytes: 30 });
    expect(r.entries.map((e) => e.content).join("")).toBe("Root rules: use pnpm.\nAPI: run");
    expect(r.entries.map((e) => e.truncated)).toEqual([false, true]);
    expect(r.entries[1]?.bytes).toBe(8);
    expect(r.entries[1]?.fullBytes).toBe(23);
  });

  it("drops later files once the budget is used up exactly", () => {
    const r = resolve(path.join(sb.repo, "packages", "api"), { ...CFG, maxBytes: 22 });
    expect(rel(r.entries)).toEqual(["AGENTS.md"]);
    expect(rel(r.dropped)).toEqual(["packages/api/AGENTS.md"]);
  });

  it("yields an empty chain when the budget is 0", () => {
    const r = resolve(path.join(sb.repo, "packages", "api"), { ...CFG, maxBytes: 0 });
    expect(r.entries).toEqual([]);
  });

  it("applyBudget keeps files that fit untouched", () => {
    const chain = resolveChain(path.join(sb.repo, "packages", "api"), CFG);
    const { entries, dropped } = applyBudget(chain.entries, 32768);
    expect(entries.every((e) => !e.truncated)).toBe(true);
    expect(dropped).toEqual([]);
  });
});
