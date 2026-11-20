// AC-9: UI language.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { MESSAGES, resolveLang, t } from "../src/i18n.js";
import { CLI, makeSandbox, runCli, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

function run(args: string[], env = sb.env) {
  let out = "";
  let err = "";
  const code = main(args, env, sb.repo, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

const hangul = /[가-힣]/;

describe("message tables (AC-9)", () => {
  it("en and ko have identical key sets", () => {
    expect(Object.keys(MESSAGES.ko).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it("every key has a non-empty text in both languages and the same placeholders", () => {
    for (const key of Object.keys(MESSAGES.en)) {
      const en = MESSAGES.en[key] as string;
      const ko = MESSAGES.ko[key] as string;
      expect(en.length, key).toBeGreaterThan(0);
      expect(ko.length, key).toBeGreaterThan(0);
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(ko), key).toEqual(names(en));
    }
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(t("en", "uninstall.done", { count: 2, file: "f.json" })).toBe("Removed 2 handler(s) from f.json.");
    expect(t("en", "uninstall.done", { count: 2 })).toContain("{file}");
  });
});

describe("language precedence (AC-9)", () => {
  it("--lang beats the environment", () => {
    expect(resolveLang("en", { AGENTSMD_LAZYLOAD_LANG: "ko", LANG: "ko_KR.UTF-8" })).toBe("en");
    expect(resolveLang("ko", { LANG: "en_US.UTF-8" })).toBe("ko");
  });

  it("AGENTSMD_LAZYLOAD_LANG beats LC_ALL, LC_MESSAGES and LANG", () => {
    expect(resolveLang(undefined, { AGENTSMD_LAZYLOAD_LANG: "ko", LC_ALL: "en_US.UTF-8" })).toBe("ko");
    expect(resolveLang(undefined, { AGENTSMD_LAZYLOAD_LANG: "en", LANG: "ko_KR.UTF-8" })).toBe("en");
  });

  it("falls through LC_ALL > LC_MESSAGES > LANG", () => {
    expect(resolveLang(undefined, { LC_ALL: "ko_KR.UTF-8", LC_MESSAGES: "en_US", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { LC_MESSAGES: "ko_KR.UTF-8", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { LANG: "ko_KR.UTF-8" })).toBe("ko");
  });

  it("anything that is not Korean is English", () => {
    expect(resolveLang(undefined, {})).toBe("en");
    expect(resolveLang(undefined, { LANG: "ja_JP.UTF-8" })).toBe("en");
    expect(resolveLang(undefined, { LANG: "C" })).toBe("en");
    expect(resolveLang("fr", { LANG: "en_US" })).toBe("en");
  });
});

describe("output language (AC-9)", () => {
  const base = { PATH: "", CODEX_HOME: "", AGENTSMD_LAZYLOAD_STATE_DIR: "" };

  it("--help is in the chosen language", () => {
    const ko = run(["--lang", "ko", "--help"], base);
    const en = run(["--lang", "en", "--help"], base);
    expect(ko.out).toContain("사용법");
    expect(hangul.test(en.out)).toBe(false);
    expect(en.out).toContain("Usage:");
  });

  it("explain is in the chosen language", () => {
    const ko = run(["explain", "packages/web/src/app.ts", "--lang", "ko"]);
    const en = run(["explain", "packages/web/src/app.ts", "--lang=en"]);
    expect(ko.out).toContain("프로젝트 루트");
    expect(ko.out).toContain("가려짐");
    expect(en.out).toContain("Project root");
    expect(en.out).toContain("shadowed");
    expect(hangul.test(en.out)).toBe(false);
  });

  it("install --dry-run is in the chosen language", () => {
    const ko = run(["install", "--dry-run", "--lang", "ko"]);
    const en = run(["install", "--dry-run", "--lang", "en"]);
    expect(ko.out).toContain("미리보기");
    expect(en.out).toContain("Dry run");
    expect(hangul.test(en.out)).toBe(false);
  });

  it("errors follow the language as well", () => {
    expect(run(["explain", "nope", "--lang", "ko"]).err).toContain("경로를 찾을 수 없습니다");
    expect(run(["explain", "nope", "--lang", "en"]).err).toContain("Path not found");
  });

  it("environment variables pick the language when no flag is given", () => {
    expect(run(["--help"], { ...base, LANG: "ko_KR.UTF-8" }).out).toContain("사용법");
    expect(run(["--help"], { ...base, LANG: "ko_KR.UTF-8", AGENTSMD_LAZYLOAD_LANG: "en" }).out).toContain("Usage:");
  });

  it("rejects an unknown --lang value with a hint", () => {
    const r = run(["--lang", "fr", "--help"], base);
    expect(r.code).toBe(2);
    expect(r.err).toContain("'en' or 'ko'");
  });

  it("the built CLI prints Korean usage for --lang ko --help", () => {
    const r = runCli(["--lang", "ko", "--help"], { env: { PATH: "" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("사용법");
    expect(CLI).toContain("dist");
  });

  it("unknown commands and options exit 2", () => {
    expect(run(["bogus"]).code).toBe(2);
    expect(run(["demo", "--bogus"]).code).toBe(2);
    expect(run(["--version"]).out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
