import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { execFileSync } from "node:child_process";

import { tmpdir, writeTree, cleanupAll, runCli, runCliJson, sandbox, exists, readIfExists, FRAMEWORK_ROOT } from "../helpers.mjs";

test.after(cleanupAll);

const ALL = "claude,codex,opencode,omp";

test("install dry-run reports the plan and changes nothing", () => {
  const { projectRoot, env } = sandbox();
  const result = runCli(["install", "--agents", ALL, "--dry-run"], { cwd: projectRoot, env });
  assert.match(result.stdout, /scope: project/);
  assert.match(result.stdout, /\.claude\/skills/);
  assert.deepEqual(fs.readdirSync(projectRoot), []);
});

test("install writes exactly the planned artifacts and never leaves the project", () => {
  const { projectRoot, home, env } = sandbox();
  const plan = runCliJson(["install", "--agents", ALL, "--dry-run"], { cwd: projectRoot, env });
  runCli(["install", "--agents", ALL, "--yes"], { cwd: projectRoot, env });

  for (const skill of plan.skills) {
    assert.ok(exists(path.join(projectRoot, ".claude", "skills", skill.name, "SKILL.md")), `${skill.name} missing`);
    assert.ok(exists(path.join(projectRoot, ".agents", "skills", skill.name, "SKILL.md")), `${skill.name} missing from .agents`);
  }
  for (const agent of ["claude", "opencode", "omp"]) {
    assert.ok(exists(path.join(projectRoot, `.${agent === "claude" ? "claude" : agent}`, "commands", "uaf-doctor.md")) || exists(path.join(projectRoot, `.${agent}`, agent === "opencode" ? "command" : "commands", "uaf-doctor.md")), `${agent} commands missing`);
  }
  assert.ok(exists(path.join(projectRoot, ".uaf", "framework", "core", "cli.mjs")));
  assert.ok(exists(path.join(projectRoot, ".uaf", "guard-rules.json")));
  assert.ok(exists(path.join(projectRoot, ".omp", "hooks", "pre", "uaf-guard.ts")));
  assert.ok(exists(path.join(projectRoot, ".opencode", "plugin", "uaf-guard.ts")));
  assert.ok(exists(path.join(projectRoot, ".codex", "hooks.json")));
  const settings = JSON.parse(readIfExists(path.join(projectRoot, ".claude", "settings.json")));
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PreToolUse[0].matcher, "Bash");

  // Nothing was written into the sandbox home at project scope.
  assert.deepEqual(fs.readdirSync(home), []);
});

test("the managed context block is appended, not overwritten, and survives a reinstall", () => {
  const { projectRoot, env } = sandbox();
  writeTree(projectRoot, { "AGENTS.md": "# House rules\n\nNever deploy on Friday.\n" });
  runCli(["install", "--agents", ALL, "--yes"], { cwd: projectRoot, env });
  const after = readIfExists(path.join(projectRoot, "AGENTS.md"));
  assert.match(after, /# House rules/);
  assert.match(after, /Never deploy on Friday\./);
  assert.match(after, /uaf:begin v1/);

  runCli(["install", "--agents", ALL, "--yes"], { cwd: projectRoot, env });
  const reinstalled = readIfExists(path.join(projectRoot, "AGENTS.md"));
  assert.equal((reinstalled.match(/uaf:begin v1/g) ?? []).length, 1, "reinstall must not duplicate the block");
  assert.match(reinstalled, /Never deploy on Friday\./);
});

test("existing Claude settings are preserved and only the hook entry is added", () => {
  const { projectRoot, env } = sandbox();
  const settingsPath = path.join(projectRoot, ".claude", "settings.json");
  writeTree(projectRoot, {
    ".claude/settings.json": JSON.stringify({ permissions: { deny: ["Read(./secrets/**)"] }, model: "opus" }, null, 2),
  });
  runCli(["install", "--agents", "claude", "--yes"], { cwd: projectRoot, env });

  const settings = JSON.parse(readIfExists(settingsPath));
  assert.deepEqual(settings.permissions.deny, ["Read(./secrets/**)"]);
  assert.equal(settings.model, "opus");
  assert.equal(settings.hooks.PreToolUse.length, 1);
});

test("invalid existing Claude settings are left untouched and reported", () => {
  const { projectRoot, env } = sandbox();
  const settingsPath = path.join(projectRoot, ".claude", "settings.json");
  writeTree(projectRoot, { ".claude/settings.json": "{\n  // a comment Claude rejects\n}\n" });
  const result = runCli(["install", "--agents", "claude", "--yes", "--json"], { cwd: projectRoot, env });
  const payload = JSON.parse(result.stdout);
  assert.equal(readIfExists(settingsPath), "{\n  // a comment Claude rejects\n}\n");
  const skipped = payload.actions.find((a) => a.status === "skipped");
  assert.ok(skipped, "the hook registration must be reported as skipped");
  assert.match(skipped.reason, /not valid JSON/);
});

test("an existing Codex hooks.json is never overwritten", () => {
  const { projectRoot, env } = sandbox();
  const hooksPath = path.join(projectRoot, ".codex", "hooks.json");
  writeTree(projectRoot, { ".codex/hooks.json": '{ "PreToolUse": [] }\n' });
  runCli(["install", "--agents", "codex", "--yes"], { cwd: projectRoot, env });
  assert.equal(readIfExists(hooksPath), '{ "PreToolUse": [] }\n');
});

test("install is idempotent: a second run reports the same file set", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", ALL, "--yes"], { cwd: projectRoot, env });
  const first = runCliJson(["status"], { cwd: projectRoot, env });
  runCli(["install", "--agents", ALL, "--yes"], { cwd: projectRoot, env });
  const second = runCliJson(["status"], { cwd: projectRoot, env });
  assert.equal(second.entries, first.entries);
  assert.deepEqual(second.drift, []);
});

test("status reports drift when an installed file is edited by hand", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", "claude", "--yes"], { cwd: projectRoot, env });
  const skill = path.join(projectRoot, ".claude", "skills", "code-quality", "SKILL.md");
  fs.appendFileSync(skill, "\n<!-- local tweak -->\n");
  const status = runCliJson(["status"], { cwd: projectRoot, env, expectFailure: true });
  assert.equal(status.drift.length, 1);
  assert.equal(status.drift[0].state, "modified");
  assert.ok(status.drift[0].target.endsWith(path.join(".claude", "skills", "code-quality")), status.drift[0].target);
});

test("uninstall removes framework artifacts, preserves user content and hand-edited files", () => {
  const { projectRoot, env } = sandbox();
  writeTree(projectRoot, { "AGENTS.md": "# House rules\n", "src/app.js": "export const x = 1;\n" });
  runCli(["install", "--agents", ALL, "--yes"], { cwd: projectRoot, env });
  const skillDir = path.join(projectRoot, ".claude", "skills", "code-quality");
  const tweaked = path.join(skillDir, "SKILL.md");
  fs.appendFileSync(tweaked, "\n<!-- local tweak -->\n");

  const result = runCliJson(["uninstall", "--yes"], { cwd: projectRoot, env });
  assert.ok(result.removed.length > 0);
  assert.ok(result.preserved.some((p) => p.target === skillDir), `the edited skill must be preserved: ${JSON.stringify(result.preserved.map((p) => p.target))}`);

  assert.ok(exists(tweaked), "hand-edited file kept");
  assert.equal(readIfExists(path.join(projectRoot, "AGENTS.md")), "# House rules\n");
  assert.equal(readIfExists(path.join(projectRoot, "src", "app.js")), "export const x = 1;\n");
  assert.equal(exists(path.join(projectRoot, ".uaf", "install.json")), false);
  assert.equal(exists(path.join(projectRoot, ".claude", "settings.json")), false, "settings.json created by us is removed");
});

test("uninstall preserves unrelated keys in a pre-existing settings.json", () => {
  const { projectRoot, env } = sandbox();
  writeTree(projectRoot, { ".claude/settings.json": JSON.stringify({ model: "opus", permissions: { allow: ["Bash(git status)"] } }) });
  runCli(["install", "--agents", "claude", "--yes"], { cwd: projectRoot, env });
  runCli(["uninstall", "--yes"], { cwd: projectRoot, env });

  const settings = JSON.parse(readIfExists(path.join(projectRoot, ".claude", "settings.json")));
  assert.deepEqual(settings, { model: "opus", permissions: { allow: ["Bash(git status)"] } });
});

test("uninstall keeps project memory unless --purge is given, then removes it", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", "omp", "--yes"], { cwd: projectRoot, env });
  runCli(["index"], { cwd: projectRoot, env });
  runCli(["remember", "Chose SQLite over Postgres for the local cache."], { cwd: projectRoot, env });
  assert.ok(exists(path.join(projectRoot, ".uaf", "index.json")));

  runCli(["uninstall", "--yes"], { cwd: projectRoot, env });
  assert.ok(exists(path.join(projectRoot, ".uaf", "index.json")), "memory survives a plain uninstall");
  assert.ok(exists(path.join(projectRoot, ".uaf", "memory", "NOTES.json")));

  runCli(["install", "--agents", "omp", "--yes"], { cwd: projectRoot, env });
  runCli(["uninstall", "--yes", "--purge"], { cwd: projectRoot, env });
  assert.equal(exists(path.join(projectRoot, ".uaf", "index.json")), false);
  assert.equal(exists(path.join(projectRoot, ".uaf", "memory")), false);
});

test("uninstall is safe to run twice and reports nothing to do the second time", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", "omp", "--yes"], { cwd: projectRoot, env });
  runCli(["uninstall", "--yes"], { cwd: projectRoot, env });
  const second = runCliJson(["uninstall", "--yes"], { cwd: projectRoot, env });
  assert.deepEqual(second.removed, []);
});

test("user-scope install targets the sandbox home only", () => {
  const { projectRoot, home, env } = sandbox();
  runCli(["install", "--scope", "user", "--agents", "claude,omp", "--yes"], { cwd: projectRoot, env });
  assert.ok(exists(path.join(home, ".claude", "skills", "code-quality", "SKILL.md")));
  assert.ok(exists(path.join(home, ".claude", "CLAUDE.md")));
  assert.ok(exists(path.join(home, ".omp", "agent", "AGENTS.md")));
  assert.equal(exists(path.join(projectRoot, ".claude")), false, "user scope must not touch the project");

  runCli(["uninstall", "--scope", "user", "--yes"], { cwd: projectRoot, env });
  assert.equal(exists(path.join(home, ".claude", "skills")), false);
  assert.equal(exists(path.join(home, ".claude", "CLAUDE.md")), false);
});

test("a dry-run plan and the applied result describe the same targets", () => {
  const { projectRoot, env } = sandbox();
  const plan = runCliJson(["install", "--agents", "opencode", "--dry-run"], { cwd: projectRoot, env });
  const result = runCliJson(["install", "--agents", "opencode", "--yes"], { cwd: projectRoot, env });
  const planned = plan.actions.map((a) => a.target).sort();
  const applied = result.actions.map((a) => a.target).sort();
  assert.deepEqual(applied, planned);
});

test("uninstall leaves no empty framework directories behind", () => {
  const { projectRoot, home, env } = sandbox();
  runCli(["install", "--agents", "claude,codex,opencode,omp", "--yes"], { cwd: projectRoot, env });
  runCli(["uninstall", "--yes"], { cwd: projectRoot, env });
  const leftovers = [".claude", ".omp", ".opencode", ".codex", ".agents"]
    .filter((rel) => exists(path.join(projectRoot, rel)));
  assert.deepEqual(leftovers, [], `empty directories left behind: ${leftovers.join(", ")}`);
  assert.deepEqual(fs.readdirSync(projectRoot).filter((n) => n !== ".uaf"), []);
  assert.equal(exists(path.join(projectRoot, ".uaf", "install.json")), false);
});

test("install refuses to target the framework's own checkout unless --self is passed", () => {
  const result = runCli(["install", "--agents", "omp", "--dry-run"], { cwd: FRAMEWORK_ROOT, expectFailure: true });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /refusing to install into the framework's own checkout/);
  assert.match(result.stderr, /--self/);
  // With --self it is allowed, which is what developing the framework needs.
  const allowed = runCliJson(["install", "--agents", "omp", "--dry-run", "--self"], { cwd: FRAMEWORK_ROOT });
  assert.deepEqual(allowed.agents, ["omp"]);
});

test("the POSIX wrapper accepts a target directory and does not install into its own checkout", { skip: process.platform === "win32" && "POSIX wrapper" }, () => {
  const { projectRoot, home, env } = sandbox("uaf-wrap-");
  execFileSync("sh", [path.join(FRAMEWORK_ROOT, "scripts", "install.sh"), "--yes", "-C", projectRoot, "--agents", "omp"], {
    cwd: FRAMEWORK_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(exists(path.join(projectRoot, ".uaf", "install.json")), "the wrapper must target --cwd");
  assert.equal(exists(path.join(FRAMEWORK_ROOT, ".uaf", "install.json")), false, "the checkout must stay clean");
  assert.deepEqual(fs.readdirSync(home), [], "the sandbox home must remain untouched");
});

test("uninstall leaves no empty agent directories behind", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", ALL, "--yes"], { cwd: projectRoot, env });
  runCli(["uninstall", "--yes"], { cwd: projectRoot, env });
  // A partial-looking removal is worse than no removal: the tree must be gone, not
  // left as skeleton directories that suggest the agent config is still present.
  assert.deepEqual(fs.readdirSync(projectRoot), []);
});

test("uninstall keeps .uaf only when index or memory actually exists", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", "omp", "--yes"], { cwd: projectRoot, env });
  const withoutIndex = runCli(["uninstall", "--yes"], { cwd: projectRoot, env });
  assert.doesNotMatch(withoutIndex.stdout, /kept \.uaf\/index\.json/);
  assert.equal(exists(path.join(projectRoot, ".uaf")), false);

  runCli(["install", "--agents", "omp", "--yes"], { cwd: projectRoot, env });
  runCli(["index"], { cwd: projectRoot, env });
  const withIndex = runCli(["uninstall", "--yes"], { cwd: projectRoot, env });
  assert.match(withIndex.stdout, /kept \.uaf\/index\.json/);
  assert.ok(exists(path.join(projectRoot, ".uaf", "index.json")));
});

test("the installer refuses to install into the framework's own checkout", () => {
  const result = runCli(["install", "--agents", "omp", "--yes"], { cwd: FRAMEWORK_ROOT, expectFailure: true });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /refusing to install into the framework's own checkout/);
});

test("the POSIX wrapper accepts an explicit target directory", { skip: process.platform === "win32" && "POSIX wrapper" }, () => {
  const { projectRoot, home, env } = sandbox();
  const script = path.join(FRAMEWORK_ROOT, "scripts", "install.sh");
  execFileSync("sh", [script, "--cwd", projectRoot, "--agents", "omp", "--yes"], {
    cwd: FRAMEWORK_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.ok(exists(path.join(projectRoot, ".uaf", "install.json")));
  assert.ok(exists(path.join(projectRoot, ".claude", "skills", "code-quality", "SKILL.md")));
  assert.deepEqual(fs.readdirSync(home), []);
});

// --- curl-style bootstrap ---------------------------------------------------

function runGetScript({ args, source, cache, env, input = null }) {
  const script = path.join(FRAMEWORK_ROOT, "scripts", "get.sh");
  const command = input === null ? null : input;
  try {
    const stdout = execFileSync("sh", ["-s", "--", ...args], {
      cwd: cache.cwd,
      env: { ...process.env, ...env, UAF_SOURCE: source, UAF_HOME: cache.dir },
      encoding: "utf8",
      input: command ?? undefined,
      stdio: [command === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("the bootstrap installer works from a piped stdin and installs into the target", { skip: process.platform === "win32" && "POSIX bootstrap" }, () => {
  const { projectRoot, env } = sandbox();
  const cache = { dir: tmpdir("uaf-cache-"), cwd: FRAMEWORK_ROOT };
  const script = readIfExists(path.join(FRAMEWORK_ROOT, "scripts", "get.sh"));
  const result = runGetScript({
    args: ["--agents", "claude,omp", "--yes"],
    source: FRAMEWORK_ROOT,
    cache,
    env: { ...env, UAF_TARGET: projectRoot },
    // Exactly how `curl … | sh -s -- …` delivers the script.
    input: script,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(exists(path.join(projectRoot, ".uaf", "install.json")));
  assert.ok(exists(path.join(projectRoot, ".claude", "skills", "code-quality", "SKILL.md")));
  assert.ok(exists(path.join(cache.dir, "src", "core", "cli.mjs")), "the framework must be cached");
  assert.equal(exists(path.join(projectRoot, ".uaf", "framework", "core", "cli.mjs")), true);
});

test("the bootstrap installer changes nothing when stdin cannot answer the prompt", { skip: process.platform === "win32" && "POSIX bootstrap" }, () => {
  const { projectRoot, env } = sandbox();
  const cache = { dir: tmpdir("uaf-cache-"), cwd: FRAMEWORK_ROOT };
  const script = readIfExists(path.join(FRAMEWORK_ROOT, "scripts", "get.sh"));
  const result = runGetScript({
    args: ["--agents", "omp"],
    source: FRAMEWORK_ROOT,
    cache,
    env: { ...env, UAF_TARGET: projectRoot },
    input: script,
  });
  assert.notEqual(result.code, 0, "an unanswered prompt must not be treated as consent");
  assert.deepEqual(fs.readdirSync(projectRoot), [], "nothing may be written without approval");
});

test("the bootstrap installer refuses to target its own cache directory", { skip: process.platform === "win32" && "POSIX bootstrap" }, () => {
  const { env } = sandbox();
  const cache = { dir: tmpdir("uaf-cache-"), cwd: tmpdir("uaf-cwd-") };
  const script = readIfExists(path.join(FRAMEWORK_ROOT, "scripts", "get.sh"));
  const result = runGetScript({
    args: ["--agents", "omp", "--yes"],
    source: FRAMEWORK_ROOT,
    cache,
    env: { ...env, UAF_TARGET: path.join(cache.dir, "src") },
    input: script,
  });
  assert.equal(result.code, 2, `expected a refusal, got: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /target resolves to the framework cache/);
  assert.equal(exists(path.join(cache.dir, "src", ".uaf")), false, "the cache must not be configured as a project");
});
