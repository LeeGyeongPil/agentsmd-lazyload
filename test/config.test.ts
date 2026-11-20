// AC-6: reading Codex config.toml.
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, codexHome, loadUserConfig } from "../src/config.js";
import { sessionConfig } from "../src/hook.js";
import { makeSandbox, write, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

const userToml = (text: string) => write(path.join(sb.env.CODEX_HOME as string, "config.toml"), text);

describe("config (AC-6)", () => {
  it("defaults are 32768, [] and ['.git']", () => {
    expect(DEFAULT_CONFIG).toEqual({ maxBytes: 32768, fallbackNames: [], rootMarkers: [".git"] });
  });

  it("reads the three keys from $CODEX_HOME/config.toml", () => {
    userToml('project_doc_max_bytes = 1000\nproject_doc_fallback_filenames = ["TEAM.md", "CLAUDE.md"]\nproject_root_markers = [".hg", "pnpm-workspace.yaml"]\n');
    expect(loadUserConfig(sb.env)).toEqual({
      maxBytes: 1000,
      fallbackNames: ["TEAM.md", "CLAUDE.md"],
      rootMarkers: [".hg", "pnpm-workspace.yaml"],
    });
  });

  it("lets a project .codex/config.toml override the user config", () => {
    userToml('project_doc_max_bytes = 1000\nproject_root_markers = [".hg"]\n');
    write(path.join(sb.repo, ".codex", "config.toml"), "project_doc_max_bytes = 500\n");
    const { cfg, root } = sessionConfig(sb.repo, sb.env);
    expect(cfg.maxBytes).toBe(500);
    expect(cfg.rootMarkers).toEqual([".hg"]);
    expect(root).toBe(sb.repo);
  });

  it("applies deeper project configs after shallower ones", () => {
    userToml('project_root_markers = [".hg"]\n');
    write(path.join(sb.repo, ".codex", "config.toml"), "project_doc_max_bytes = 500\n");
    write(path.join(sb.repo, "packages", "api", ".codex", "config.toml"), "project_doc_max_bytes = 100\n");
    expect(sessionConfig(path.join(sb.repo, "packages", "api"), sb.env).cfg.maxBytes).toBe(100);
    expect(sessionConfig(sb.repo, sb.env).cfg.maxBytes).toBe(500);
  });

  it("falls back to defaults when files are missing", () => {
    const env = { ...sb.env, CODEX_HOME: path.join(sb.tmp, "does-not-exist") };
    expect(loadUserConfig(env)).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to defaults when the TOML is broken", () => {
    userToml("project_doc_max_bytes = [unterminated\n");
    expect(loadUserConfig(sb.env)).toEqual(DEFAULT_CONFIG);
  });

  it("ignores values with the wrong type or a negative budget, keeping the other keys", () => {
    userToml('project_doc_max_bytes = "lots"\nproject_doc_fallback_filenames = [1, 2]\nproject_root_markers = [".hg"]\n');
    expect(loadUserConfig(sb.env)).toEqual({ ...DEFAULT_CONFIG, rootMarkers: [".hg"] });
    userToml("project_doc_max_bytes = -5\n");
    expect(loadUserConfig(sb.env).maxBytes).toBe(32768);
  });

  it("accepts 0 as a budget and an empty marker list", () => {
    userToml("project_doc_max_bytes = 0\nproject_root_markers = []\n");
    expect(loadUserConfig(sb.env)).toMatchObject({ maxBytes: 0, rootMarkers: [] });
  });

  it("uses ~/.codex when CODEX_HOME is unset", () => {
    expect(codexHome({})).toMatch(/\.codex$/);
  });
});
