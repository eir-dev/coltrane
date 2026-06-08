// pack_contents_audit.test.ts — assert what `npm pack` produces matches
// the intended publish surface.
//
// Why this exists: `npm publish` ships whatever ends up in the produced
// .tgz tarball. Without an explicit `files` field in package.json (or a
// matching .npmignore), npm defaults to publishing the entire repo minus
// a few git/node-modules conventions. That can ship tests, scratch dirs,
// internal docs, etc.
//
// This test:
//   1. Runs `npm pack --dry-run --json` to enumerate what WOULD ship.
//   2. Asserts the manifest contains the required public surface.
//   3. Asserts the manifest does NOT contain anything in the
//      explicit excluded-set.
//   4. Asserts package.json declares the explicit `files` (or `.npmignore`
//      is present) so the surface is intentional, not implicit.
//
// This test runs as part of CI on every PR. Any change that drifts the
// pack surface fails here BEFORE a publish gate.

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");

// --- Required: every published tarball MUST contain these entries.
const REQUIRED_ENTRIES: ReadonlyArray<string | RegExp> = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/src/server_entry.js",
  /^dist\/src\/composition\.js$/,
  /^dist\/src\/loader\.js$/,
  /^dist\/src\/runtime\.js$/,
  /^dist\/src\/server\.js$/,
  /^dist\/src\/canonical_form\.js$/,
];

// --- Forbidden: the tarball MUST NOT contain any of these.
const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  // Test files should never publish.
  /^tests\//,
  /\.test\.js$/,
  /\.test\.ts$/,
  /\.spec\.js$/,
  /\.spec\.ts$/,

  // TypeScript source files; only compiled .js should ship.
  /^src\/.*\.ts$/,

  // Build artifacts / IDE / scratch dirs.
  /^node_modules\//,
  /^\.git\//,
  /^\.vscode\//,
  /^\.idea\//,
  /^tmp\//,
  /^scratch\//,
  /^\.coltrane\//,
  /^coverage\//,

  // Internal-only artifacts that should not ship.
  /^MEMORY\.md$/,
  /^READY_FOR_DEMO\.md$/,
  /^tracking\.json$/,
  /^prereg.*/,
  /^docs\/_archive\//,
  /\.playwrig/,

  // CI / dev-only configs.
  /^\.github\//,
  /^vitest\.config/,
];

// --- Helper: get the pack manifest.
type PackEntry = { path: string; size: number };
type PackResult = { files: PackEntry[]; name: string; version: string };

function readPackManifest(): PackResult[] {
  // --dry-run avoids actually writing the .tgz to disk; --json emits the
  // file manifest as a parseable structure.
  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

describe("pack contents audit", () => {
  it("package.json declares either `files` or `.npmignore` so the publish surface is explicit", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
    );
    const hasFiles = Array.isArray(pkg.files) && pkg.files.length > 0;
    const hasNpmignore = fs.existsSync(path.join(REPO_ROOT, ".npmignore"));
    expect(
      hasFiles || hasNpmignore,
      "package.json `files` field must be set (preferred) OR `.npmignore` must exist. Without either, `npm publish` ships the entire repo.",
    ).toBe(true);
  });

  it("npm pack runs cleanly and produces a non-empty manifest", () => {
    const result = readPackManifest();
    expect(result).toHaveLength(1);
    expect(result[0].files.length).toBeGreaterThan(0);
  });

  it("pack manifest contains every required entry", () => {
    const result = readPackManifest();
    const paths = result[0].files.map((f) => f.path);

    for (const req of REQUIRED_ENTRIES) {
      const matched =
        typeof req === "string"
          ? paths.includes(req)
          : paths.some((p) => req.test(p));
      expect(matched, `Required entry missing from pack manifest: ${req}`).toBe(
        true,
      );
    }
  });

  it("pack manifest contains zero forbidden entries", () => {
    const result = readPackManifest();
    const paths = result[0].files.map((f) => f.path);

    const violations: { path: string; matched: string }[] = [];
    for (const p of paths) {
      for (const forbidden of FORBIDDEN_PATTERNS) {
        if (forbidden.test(p)) {
          violations.push({ path: p, matched: forbidden.source });
          break;
        }
      }
    }

    expect(
      violations,
      `Pack manifest contains forbidden entries:\n${violations
        .map((v) => `  ${v.path}  (matched: ${v.matched})`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("package.json declares Apache-2.0 license", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
    );
    expect(pkg.license).toBe("Apache-2.0");
  });

  it("package.json bin entry points at a file that exists in dist", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
    );
    const bin = pkg.bin;
    expect(bin, "package.json must declare a `bin` entry").toBeDefined();

    const binPaths =
      typeof bin === "string"
        ? [bin]
        : Object.values(bin as Record<string, string>);

    for (const binPath of binPaths) {
      const absPath = path.join(REPO_ROOT, binPath);
      expect(
        fs.existsSync(absPath),
        `bin entry points at ${binPath}, but that file does not exist (run \`npm run build\`?)`,
      ).toBe(true);
    }
  });

  it("README and LICENSE files are present at repo root", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "LICENSE"))).toBe(true);
  });
});
