import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Terms encoded base64 so this test file is itself ship-safe — listing the
// terms in cleartext would leak them into the very tarball this test audits.
const VOCAB_FORBIDDEN_B64 = [
  "YXBvaGE=",
  "UklQRU5FRA==",
  "UEFSVExZLVJJUEVORUQ=",
  "UklQRU5FRC1ESUZGRVJFTlRMWQ==",
  "S0lMTC1GSVJFRA==",
  "c2hhMjU2X3ByZV92ZXJkaWN0",
  "cHJlcmVnX3NlYWw=",
  "cmlwZW5zX3ByZV9yZWc=",
  "c2VhbHNfcHJlX3JlZw==",
  "c2hhLXN0YW1w",
  "ZWlybWF0aA==",
  "Y2FydmVkLWZhY2Vz",
];
const VOCAB_FORBIDDEN = VOCAB_FORBIDDEN_B64.map((s) =>
  Buffer.from(s, "base64").toString("utf8"),
);

const FILENAME_FORBIDDEN: RegExp[] = [
  /methodology/i,
  /\bsubstrate\b/i,
  /chain-audit-keeper/i,
  /apoha/i,
];

const SKIP_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "svg",
  "ttf", "woff", "woff2", "otf",
  "tgz", "gz", "zip", "wasm", "pdf",
]);

type PackedFile = { path: string; size: number; mode: number };

let packedFiles: PackedFile[] = [];

beforeAll(() => {
  const out = execSync("npm pack --dry-run --json", {
    encoding: "utf8",
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  const result = JSON.parse(out);
  packedFiles = result[0].files;
});

describe("npm pack content audit", () => {
  it("no shipped path matches forbidden filename patterns", () => {
    const hits = packedFiles
      .map((f) => f.path)
      .filter((p) => FILENAME_FORBIDDEN.some((re) => re.test(p)));
    expect(hits, "forbidden filename patterns in tarball").toEqual([]);
  });

  it("no shipped text-file content contains forbidden vocab", () => {
    const hits: { path: string; term: string }[] = [];
    for (const f of packedFiles) {
      const ext = (f.path.split(".").pop() || "").toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      const abs = join(REPO_ROOT, f.path);
      try {
        if (!statSync(abs).isFile()) continue;
      } catch {
        continue;
      }
      let content: string;
      try {
        content = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      for (const term of VOCAB_FORBIDDEN) {
        if (content.includes(term)) {
          hits.push({ path: f.path, term });
        }
      }
    }
    expect(hits, "forbidden vocab in shipped file contents").toEqual([]);
  });

  it("package.json has expected bin entry and scoped name", () => {
    const pkgPath = join(REPO_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    expect(pkg.name, "package.json name must be scoped to @eir-dev").toMatch(
      /^@eir-dev\//,
    );
    expect(pkg.bin, "package.json must declare a bin entry").toBeDefined();
  });
});
