// Test launcher. Exists because `node --test "tests/unit/*.test.mjs"` only works on Node 21+:
// Node 20 (our floor) does not expand globs, treats the quoted pattern as one literal path,
// and "could not find" it — which looked like a passing run of zero tests.
// So we expand each suite directory here and hand `node --test` explicit file paths.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const suites = process.argv.slice(2);

if (suites.length === 0) {
  console.error("usage: node tests/run.mjs <suite-dir>...  (e.g. tests/unit tests/integration)");
  process.exit(2);
}

const files = [];
for (const suite of suites) {
  let entries;
  try {
    entries = readdirSync(path.resolve(root, suite));
  } catch {
    // Fail loudly: a typo'd or renamed suite must not pass as zero tests.
    console.error(`tests/run.mjs: suite directory not found: ${suite}`);
    process.exit(2);
  }
  const matched = entries
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join(path.resolve(root, suite), name))
    .filter((file) => statSync(file).isFile());
  if (matched.length === 0) {
    console.error(`tests/run.mjs: no *.test.mjs files in suite: ${suite}`);
    process.exit(2);
  }
  files.push(...matched);
}

const { status } = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(status ?? 1);
