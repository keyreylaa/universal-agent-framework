import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { scanText, scanBuffer, scanPaths, isSecretFileName, isExemptSecretName, summarize } from "../../core/secrets.mjs";
import { compileIgnore, walkProject, looksBinary, atomicWrite, readTextOrNull } from "../../core/util.mjs";
import { tmpdir, writeTree, cleanupAll } from "../helpers.mjs";

test.after(cleanupAll);

// Fixtures are assembled at runtime so no credential-shaped literal is committed.
const fake = (...parts) => parts.join("");

test("scanText flags high-severity credential shapes", () => {
  const cases = [
    ["aws-access-key-id", fake("AKIA", "IOSFODNN7EXAMPLE")],
    ["github-token", fake("ghp_", "a".repeat(36))],
    ["slack-token", fake("xoxb-", "123456789012-abcdefghijklmnop")],
    ["stripe-key", fake("sk_live_", "x".repeat(24))],
    ["anthropic-key", fake("sk-ant-", "api03-", "y".repeat(24))],
    ["google-api-key", fake("AIza", "z".repeat(35))],
    ["npm-token", fake("npm_", "q".repeat(36))],
    ["discord-bot-token", fake("M", "N".repeat(23), ".", "a".repeat(6), ".", "b".repeat(27))],
  ];
  for (const [id, value] of cases) {
    const findings = scanText(`const value = "${value}";`);
    assert.ok(
      findings.some((f) => f.id === id && f.severity === "high"),
      `expected ${id} to be detected`,
    );
  }
});

test("scanText finds a private key block", () => {
  const pem = fake("-----BEGIN ", "RSA PRIVATE KEY", "-----\nMIIEow...\n");
  const findings = scanText(pem);
  assert.equal(findings[0].id, "private-key");
  assert.equal(findings[0].severity, "high");
});

test("scanText redacts the matched value in the preview", () => {
  const secret = fake("ghp_", "a".repeat(36));
  const [finding] = scanText(`token: ${secret}`);
  assert.notEqual(finding.preview, secret);
  assert.ok(finding.preview.includes("…"));
});

test("scanText reports the correct line number", () => {
  const findings = scanText(`line one\nline two\nkey = "${fake("AKIA", "IOSFODNN7EXAMPLE")}"\n`);
  assert.equal(findings[0].line, 3);
});

test("scanText does not flag placeholder and example values", () => {
  const benign = [
    'api_key = "your-api-key-here"',
    'password = "${DB_PASSWORD}"',
    'token: "changeme"',
    'secret = process.env.SECRET',
    'api_key = "example-placeholder-key"',
  ].join("\n");
  const findings = scanText(benign).filter((f) => f.severity === "high");
  assert.deepEqual(findings, []);
});

test("scanText still flags a high-severity pattern even on a line that looks like a placeholder", () => {
  const findings = scanText(`# example token: ${fake("ghp_", "b".repeat(36))}`);
  assert.ok(findings.some((f) => f.id === "github-token" && f.severity === "high"));
});

test("scanText reports long high-entropy literals as review-level, never blocking", () => {
  const literal = fake("Xq7Zp2Lm9Rt4Wv1Yb6Nc3Hd8Fj5Kg0Sa", "Qw4Er7Ty");
  const findings = scanText(`const k = "${literal}";`);
  const entropy = findings.filter((f) => f.id === "high-entropy-literal");
  assert.ok(entropy.length >= 1);
  assert.ok(entropy.every((f) => f.severity === "review"));
  assert.ok(summarize(findings).blocking === 0);
});

test("scanBuffer ignores binary content", () => {
  const buf = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x41]);
  assert.deepEqual(scanBuffer(buf), []);
});

test("isSecretFileName covers dotenv variants, key suffixes, and credential directories", () => {
  for (const rel of [".env", ".env.production", "config/.env.local", "certs/server.pem", "id_rsa", ".aws/credentials", "deploy/secrets/token.txt", ".npmrc"]) {
    assert.equal(isSecretFileName(rel), true, `${rel} should be treated as secret-bearing`);
  }
  for (const rel of ["src/env.ts", "docs/environment.md", "package.json", ".env.example"]) {
    assert.equal(isSecretFileName(rel), false, `${rel} should not be treated as secret-bearing`);
  }
});

test("isExemptSecretName keeps committed templates and public keys", () => {
  for (const rel of [".env.example", ".env.sample", "certs/server.pub", "config/app.yml.example", "id_rsa.pub"]) {
    assert.equal(isExemptSecretName(rel), true, `${rel} should be exempt`);
  }
});

test("scanPaths reports a secret-named file without reading it", () => {
  const dir = tmpdir();
  writeTree(dir, {
    ".env": "SOME_KEY=whatever\n",
    "src/app.js": "export const x = 1;\n",
  });
  const result = scanPaths([dir]);
  assert.equal(result.scanned, 1);
  assert.ok(result.findings.some((f) => f.id === "secret-file"));
});

test("scanPaths does not treat .env.example as a credential file", () => {
  const dir = tmpdir();
  writeTree(dir, { ".env.example": "DATABASE_URL=\n", "src/app.js": "export const x = 1;\n" });
  const result = scanPaths([dir]);
  assert.equal(result.scanned, 2);
  assert.deepEqual(result.findings, []);
});

test("compileIgnore implements negation, anchoring, and directory patterns", () => {
  const ignore = compileIgnore(["node_modules/", "*.log", "!keep.log", "/root-only.txt", "build/**"]);
  assert.equal(ignore("node_modules/x.js"), true);
  assert.equal(ignore("deep/node_modules/x.js"), true);
  assert.equal(ignore("debug.log"), true);
  assert.equal(ignore("keep.log"), false);
  assert.equal(ignore("root-only.txt"), true);
  assert.equal(ignore("nested/root-only.txt"), false);
  assert.equal(ignore("build/a/b.js"), true);
  assert.equal(ignore("src/index.js"), false);
});

test("walkProject honours .gitignore, skips excluded directories, and is deterministic", () => {
  const dir = tmpdir();
  writeTree(dir, {
    ".gitignore": "dist/\n*.tmp\n",
    "src/index.js": "",
    "src/deep/nested.js": "",
    "dist/bundle.js": "",
    "notes.tmp": "",
    "node_modules/left-pad/index.js": "",
    ".git/config": "",
    "README.md": "",
  });
  const files = walkProject(dir);
  assert.deepEqual(files, [".gitignore", "README.md", "src/deep/nested.js", "src/index.js"]);
});

test("walkProject applies negated rules from a nested .gitignore relative to its directory", () => {
  const dir = tmpdir();
  writeTree(dir, {
    ".gitignore": "*.snap\n",
    "pkg/.gitignore": "!keep.snap\n",
    "pkg/keep.snap": "",
    "pkg/drop.snap": "",
    "other/drop.snap": "",
  });
  const files = walkProject(dir);
  assert.ok(files.includes("pkg/keep.snap"));
  assert.ok(!files.includes("pkg/drop.snap"));
  assert.ok(!files.includes("other/drop.snap"));
});

test("walkProject follows symlinked directories without re-entering excluded ones", () => {
  const dir = tmpdir();
  writeTree(dir, { "real/a.js": "", "src/b.js": "" });
  fs.symlinkSync(path.join(dir, "real"), path.join(dir, "linked"));
  const files = walkProject(dir);
  assert.ok(files.includes("linked/a.js") || files.includes("real/a.js"));
  assert.ok(!files.some((f) => f.startsWith("linked/real/")));
});

test("looksBinary distinguishes text from binary", () => {
  assert.equal(looksBinary(Buffer.from("plain text\n", "utf8")), false);
  assert.equal(looksBinary(Buffer.from([0x00, 0x00, 0x01])), true);
});

test("atomicWrite leaves no temporary file behind and replaces content", () => {
  const dir = tmpdir();
  const file = path.join(dir, "out.json");
  atomicWrite(file, "first");
  atomicWrite(file, "second");
  assert.equal(readTextOrNull(file), "second");
  assert.deepEqual(fs.readdirSync(dir), ["out.json"]);
});
