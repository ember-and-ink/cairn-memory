import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "..");
const oxlint = join(repo, "node_modules", ".bin", "oxlint");

// Oxlint has no lint-a-string API, and its overrides match on the path relative to the
// config. So each probe is written at the path under test beside a copy of the real config.
const sandbox = mkdtempSync(join(tmpdir(), "cairn-lint-"));
copyFileSync(join(repo, ".oxlintrc.json"), join(sandbox, ".oxlintrc.json"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function messagesFor(filePath, code) {
  const file = join(sandbox, filePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
  let out;
  try {
    out = execFileSync(oxlint, ["-f", "json", filePath], { cwd: sandbox, encoding: "utf8" });
  } catch (err) {
    out = err.stdout; // findings exit non-zero; the report is still on stdout
  } finally {
    rmSync(file);
  }
  // `code` reads `eslint(no-console)`; keep the rule id.
  return JSON.parse(out).diagnostics.map((d) => d.code.replace(/^.*\((.*)\)$/, "$1"));
}

/**
 * The mechanical half of plan §6's no-clone invariant (CLAUDE.md §9.35). A test
 * of the rule itself, so deleting it from .oxlintrc.json fails the gate.
 */
describe("the no-clone lint rule", () => {
  it("bans structuredClone in shipped code", () => {
    expect(
      messagesFor("src/probe.js", "export const copy = (m) => structuredClone(m);\n"),
    ).toContain("no-restricted-globals");
    expect(messagesFor("index.js", "export const copy = (m) => structuredClone(m);\n")).toContain(
      "no-restricted-globals",
    );
  });

  it("leaves tests free to snapshot with it", () => {
    expect(
      messagesFor("test/probe.test.js", "export const copy = (m) => structuredClone(m);\n"),
    ).not.toContain("no-restricted-globals");
  });
});

/** D-0079's lesson, made mechanical: the store reaching up into the layers above it. */
describe("the store-layer import rule", () => {
  it("bans a store module importing from the layers above it", () => {
    for (const from of ["../memory/canon.js", "../pipeline/budgeter.js", "../settings.js"]) {
      expect(
        messagesFor("src/store/chat-store.js", `import { x } from '${from}';\nexport { x };\n`),
      ).toContain("no-restricted-imports");
    }
  });

  it("lets it import its own layer and util", () => {
    const code =
      "import { a } from './schema.js';\nimport { b } from '../util/hash.js';\nexport { a, b };\n";
    expect(messagesFor("src/store/chat-store.js", code)).not.toContain("no-restricted-imports");
  });
});

/** CLAUDE.md §4.19: logging goes through util/log.js, which is the one place allowed console. */
describe("the console rule", () => {
  it("bans console in shipped code but not in the logger", () => {
    expect(messagesFor("src/probe.js", "console.log(1);\n")).toContain("no-console");
    expect(messagesFor("src/util/log.js", "console.log(1);\n")).not.toContain("no-console");
  });
});
