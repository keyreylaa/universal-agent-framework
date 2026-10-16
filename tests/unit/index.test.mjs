import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { buildIndex, readIndex, writeIndex, acquireLock, indexPath, upsertNote, detectTooling } from "../../core/index.mjs";
import { searchIndex, formatResults } from "../../core/search.mjs";
import { tmpdir, writeTree, cleanupAll } from "../helpers.mjs";

test.after(cleanupAll);

const fixture = {
  "package.json": JSON.stringify({ name: "fixture", scripts: { test: "vitest run", build: "tsc" }, dependencies: { zod: "^3" } }, null, 2),
  "vitest.config.ts": "export default {};\n",
  ".eslintrc.json": "{}\n",
  ".github/workflows/ci.yml": "name: ci\non: [push]\n",
  ".gitignore": "dist/\n",
  "dist/bundle.js": "console.log('built');\n",
  "src/index.ts": "export function retryWithBackoff(attempts: number) {\n  return attempts;\n}\n\nexport class RetryQueue {}\n",
  "src/util.ts": "export const helpers = 1;\n",
  "src/migrations/0001_init.sql": "CREATE TABLE orders (id uuid primary key);\n",
  "tests/index.test.ts": "import { test } from 'vitest';\ntest('x', () => {});\n",
  ".env": "SECRET=value\n",
  "assets/logo.png": "\u0000\u0001binary",
};

function makeFixture() {
  const dir = tmpdir();
  writeTree(dir, fixture);
  return dir;
}

test("buildIndex indexes source, classifies kinds, and extracts symbols", () => {
  const dir = makeFixture();
  const { index, stats } = buildIndex(dir);
  const byPath = Object.fromEntries(index.files.map((f) => [f.path, f]));

  assert.equal(byPath["src/index.ts"].kind, "code");
  assert.equal(byPath["src/index.ts"].language, "typescript");
  assert.deepEqual(
    byPath["src/index.ts"].symbols.map((s) => s.name),
    ["retryWithBackoff", "RetryQueue"],
  );
  assert.equal(byPath["src/index.ts"].symbols[0].line, 1);
  assert.equal(byPath["tests/index.test.ts"].kind, "test");
  assert.equal(byPath["package.json"].kind, "config");
  assert.equal(byPath["assets/logo.png"].kind, "binary");
  assert.equal(byPath["assets/logo.png"].skipped, "binary");
  assert.equal(stats.skippedSecret, 1, ".env must not be indexed");
  assert.equal(byPath[".env"], undefined);
  assert.equal(stats.added >= 8, true);
});

test("buildIndex excludes build output and ignored paths", () => {
  const dir = makeFixture();
  const { index } = buildIndex(dir);
  assert.equal(index.files.some((f) => f.path.startsWith("dist/")), false);
});

test("detectTooling reads manifests, tests, lint, and CI from the index", () => {
  const dir = makeFixture();
  const { index } = buildIndex(dir);
  assert.deepEqual(index.tooling.testTools, ["vitest"]);
  assert.deepEqual(index.tooling.lintTools, ["eslint"]);
  assert.deepEqual(index.tooling.ci, [".github/workflows/ci.yml"]);
  assert.equal(index.tooling.commands.test, "npm test");
  assert.equal(index.tooling.commands.build, "npm run build");
  assert.deepEqual(index.tooling.commands.scripts, ["build", "test"]);
  assert.ok(index.tooling.languages.typescript >= 2);
});

test("incremental rebuild reuses unchanged files and only rehashes changes", () => {
  const dir = makeFixture();
  const first = buildIndex(dir);
  writeIndex(dir, first.index);

  const second = buildIndex(dir, { previous: readIndex(dir) });
  assert.ok(second.stats.reused >= 8);
  assert.equal(second.stats.changed, 0);
  assert.equal(second.stats.added, 0);

  fs.writeFileSync(path.join(dir, "src/util.ts"), "export const helpers = 2;\n");
  const third = buildIndex(dir, { previous: readIndex(dir) });
  assert.equal(third.stats.changed, 1);
  assert.ok(third.stats.reused >= 8);
});

test("a touched-but-identical file is reused rather than reported as changed", () => {
  const dir = makeFixture();
  const first = buildIndex(dir);
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, "src/util.ts"), future, future);

  const second = buildIndex(dir, { previous: first.index });
  assert.equal(second.stats.changed, 0);
  const entry = second.index.files.find((f) => f.path === "src/util.ts");
  assert.equal(entry.mtimeMs, fs.statSync(path.join(dir, "src/util.ts")).mtimeMs);
});

test("deleting a file drops it from the index and counts as removed", () => {
  const dir = makeFixture();
  const first = buildIndex(dir);
  fs.rmSync(path.join(dir, "src/util.ts"));
  const second = buildIndex(dir, { previous: first.index });
  assert.equal(second.stats.removed, 1);
  assert.equal(second.index.files.some((f) => f.path === "src/util.ts"), false);
});

test("--force rehashes every file but still reports byte-identical content as reused", () => {
  const dir = makeFixture();
  const first = buildIndex(dir);
  const forced = buildIndex(dir, { previous: first.index, force: true });
  assert.equal(forced.stats.rehashed >= 9, true, "force must bypass the mtime shortcut");
  assert.equal(forced.stats.changed, 0, "identical content is not a change");
  assert.equal(forced.stats.added, 0);
});

test("an interrupted index run leaves the previous index intact and reports a stale lock", () => {
  const dir = makeFixture();
  const first = buildIndex(dir);
  const file = writeIndex(dir, first.index);

  // Simulate a crash: lock written, index never updated.
  const staleLock = acquireLock(dir);
  assert.equal(staleLock.stale, false);
  const second = acquireLock(dir);
  assert.equal(second.stale, true, "a leftover lock must be detected as stale");

  const recovered = buildIndex(dir, { previous: readIndex(dir) });
  writeIndex(dir, recovered.index);
  second.release();

  assert.equal(fs.existsSync(path.join(path.dirname(file), "index.lock")), false);
  const reread = readIndex(dir);
  assert.equal(reread.files.length, recovered.index.files.length);
  assert.equal(reread.version, 2);
});

test("index files are written atomically under .uaf/", () => {
  const dir = makeFixture();
  const { index } = buildIndex(dir);
  const file = writeIndex(dir, index);
  assert.equal(file, indexPath(dir));
  assert.ok(file.endsWith(path.join(".uaf", "index.json")));
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["index.json"]);
});

test("upsertNote replaces by id rather than appending duplicates", () => {
  const dir = makeFixture();
  const { index } = buildIndex(dir);
  upsertNote(index, { id: "a", kind: "decision", text: "first" });
  upsertNote(index, { id: "a", kind: "decision", text: "second" });
  upsertNote(index, { id: "b", kind: "constraint", text: "third" });
  assert.equal(index.notes.length, 2);
  assert.equal(index.notes.find((n) => n.id === "a").text, "second");
});

test("search ranks a symbol match above an incidental path match", () => {
  const dir = makeFixture();
  const { index } = buildIndex(dir);
  const results = searchIndex(index, "retry");
  assert.equal(results[0].path, "src/index.ts");
  assert.ok(results[0].symbols.some((s) => s.name === "retryWithBackoff"));
});

test("search filters by kind and language, and honours the limit", () => {
  const dir = makeFixture();
  const { index } = buildIndex(dir);
  const tests = searchIndex(index, "index", { kind: "test" });
  assert.ok(tests.length > 0);
  assert.ok(tests.every((r) => r.kind === "test"));

  const sql = searchIndex(index, "orders", { language: "sql" });
  assert.deepEqual(sql.map((r) => r.path), ["src/migrations/0001_init.sql"]);

  assert.equal(searchIndex(index, "index", { limit: 1 }).length, 1);
});

test("search returns nothing for a query that matches nothing", () => {
  const dir = makeFixture();
  const { index } = buildIndex(dir);
  assert.deepEqual(searchIndex(index, "definitelynotpresent"), []);
  assert.deepEqual(searchIndex(index, "   "), []);
});

test("formatResults respects the character budget", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ path: `src/module-${i}.ts`, symbols: [], headline: "", language: "typescript" }));
  const text = formatResults(rows, { maxChars: 120 });
  assert.ok(text.length <= 200);
  assert.ok(text.split("\n").length < 50);
});

test("detectTooling reports nothing rather than guessing on an empty project", () => {
  const tooling = detectTooling("/nonexistent", []);
  assert.deepEqual(tooling.manifests, []);
  assert.deepEqual(tooling.testTools, []);
  assert.deepEqual(tooling.commands, {});
});

test("config index.exclude patterns are honoured by the indexer", () => {
  const dir = makeFixture();
  writeTree(dir, { ".uaf/config.json": JSON.stringify({ index: { exclude: ["src/migrations/"] } }) });
  const { index } = buildIndex(dir, { extraExcludes: ["src/migrations/"] });
  assert.equal(index.files.some((f) => f.path.startsWith("src/migrations/")), false);
});
