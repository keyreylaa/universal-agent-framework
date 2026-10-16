// End-to-end proof that an installed skill set is actually discovered by a real
// agent. This is the only test that exercises an agent's own discovery code; the
// other adapters are documentation-derived and are reported as unverified.
//
// Skipped, not silently passed, when the agent is unavailable.

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { tmpdir, runCli, cleanupAll, sandboxEnv } from "../helpers.mjs";

test.after(cleanupAll);

function hasOmp() {
  try {
    execFileSync("omp", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

const OMP_AVAILABLE = hasOmp();

function ompRead(target, { cwd, home }) {
  const stdout = execFileSync("omp", ["read", target], {
    cwd,
    encoding: "utf8",
    // The sandbox env keeps the agent from reading the developer's own config.
    env: { ...sandboxEnv(home), PI_NO_TITLE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return stdout;
}

test("oh-my-pi discovers every installed skill through its own skill:// resolver", { skip: !OMP_AVAILABLE && "omp is not installed" }, () => {
  const projectRoot = tmpdir("uaf-e2e-");
  const home = tmpdir("uaf-e2e-home-");
  runCli(["install", "--agents", "claude,codex,opencode,omp", "--yes"], { cwd: projectRoot, env: sandboxEnv(home) });

  const body = ompRead("skill://code-quality", { cwd: projectRoot, home });
  assert.match(body, /^\[Skill file: .*SKILL\.md\]/m);
  assert.match(body, /name: code-quality/);
  assert.match(body, /## Procedure/);
});

test("duplicate copies in two shared skill roots collapse instead of being namespaced", { skip: !OMP_AVAILABLE && "omp is not installed" }, () => {
  const projectRoot = tmpdir("uaf-e2e-");
  const home = tmpdir("uaf-e2e-home-");
  runCli(["install", "--agents", "claude,codex,opencode,omp", "--yes"], { cwd: projectRoot, env: sandboxEnv(home) });

  // `.claude/skills` and `.agents/skills` hold byte-identical copies. If they did
  // not collapse, the second copy would be reachable as `claude/<name>` or
  // `agents/<name>` with a collision warning.
  let listing = "";
  try {
    ompRead("skill://definitely-not-a-skill", { cwd: projectRoot, home });
  } catch (error) {
    listing = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  const available = /Available: ([^\n]+)/.exec(listing)?.[1]?.split(",").map((s) => s.trim()) ?? [];
  assert.ok(available.length >= 13, `expected the installed skills, saw: ${listing.slice(0, 300)}`);
  assert.equal(available.some((name) => name.includes("/")), false, `namespaced duplicates: ${available.join(", ")}`);

  for (const expected of ["code-quality", "root-cause", "strategy", "commit", "publish", "data-extraction", "bot-development"]) {
    assert.ok(available.includes(expected), `${expected} missing from ${available.join(", ")}`);
  }
});
