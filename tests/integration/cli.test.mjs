import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { tmpdir, writeTree, cleanupAll, runCli, runCliJson, sandbox as makeSandbox, initRepo, FRAMEWORK_ROOT, exists, readIfExists } from "../helpers.mjs";

test.after(cleanupAll);

const sandbox = () => makeSandbox("uaf-cli");

test("doctor reports the environment without side effects", () => {
  const { projectRoot, env } = sandbox();
  const report = runCliJson(["doctor"], { cwd: projectRoot, env });
  assert.equal(report.agents.length, 4);
  assert.ok(report.framework.version.match(/^\d+\.\d+\.\d+$/));
  assert.equal(report.manifest.exists, false);
  assert.equal(report.index, null);
  assert.ok(["lite", "full", "ultra"].includes(report.mode.resolved));
  assert.deepEqual(fs.readdirSync(projectRoot), []);
});

test("doctor distinguishes a detected agent from a document-derived adapter", () => {
  const { projectRoot, env } = sandbox();
  const report = runCliJson(["doctor"], { cwd: projectRoot, env });
  // Oh My Pi is the only supported agent installed in this environment, so the
  // other three must be reported as detected-but-unverified rather than trusted.
  for (const agent of report.agents) {
    if (agent.installed) assert.ok(agent.signal !== "absent");
    if (!agent.runtimeVerified) assert.ok(report.checks.some((c) => c.message.includes(agent.label)) || !agent.installed);
  }
  if (report.detected.length === 0) {
    assert.ok(report.checks.some((c) => /No target agent detected/.test(c.message)));
  }
});

test("compat prints a matrix whose project paths match the registry", () => {
  const { projectRoot, env } = sandbox();
  const rows = runCliJson(["compat"], { cwd: projectRoot, env });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.claude.skills.project, ".claude/skills");
  assert.equal(byId.codex.skills.project, ".agents/skills");
  assert.equal(byId.opencode.commands.project, ".opencode/command");
  assert.equal(byId.omp.skills.project, ".omp/skills");
  assert.equal(byId.codex.commands.project, null);
  assert.equal(byId.omp.runtimeVerified, true);
  assert.equal(byId.claude.runtimeVerified, false);
});

test("skills validates every authored skill and reports the listing budget", () => {
  const { projectRoot, env } = sandbox();
  const result = runCliJson(["skills"], { cwd: projectRoot, env });
  assert.ok(result.skills.length >= 10);
  assert.ok(result.skills.every((s) => s.valid), JSON.stringify(result.skills.filter((s) => !s.valid)));
  assert.ok(result.commands.length >= 8);
  assert.ok(result.listingTokens < 4000, `listing costs ${result.listingTokens} tokens`);
  for (const skill of result.skills) {
    assert.ok(skill.lines > 30, `${skill.name} is too thin at ${skill.lines} lines`);
    assert.ok(skill.files >= 1);
  }
});

test("index and search work end to end on a fixture project", () => {
  const { projectRoot, env } = sandbox();
  writeTree(projectRoot, {
    "package.json": JSON.stringify({ name: "x", scripts: { test: "vitest" } }),
    "src/retry.ts": "export function retryWithBackoff() { return 1; }\n",
    "src/other.ts": "export const other = 1;\n",
  });
  const indexed = runCliJson(["index"], { cwd: projectRoot, env });
  assert.ok(indexed.stats.indexed >= 3);

  const found = runCliJson(["search", "retryWithBackoff"], { cwd: projectRoot, env });
  assert.equal(found.results[0].path, "src/retry.ts");

  const missing = runCli(["search", "zzzznothing"], { cwd: projectRoot, env });
  assert.match(missing.stdout, /no matches/);
});

test("search without an index fails with an actionable message", () => {
  const { projectRoot, env } = sandbox();
  const result = runCli(["search", "anything"], { cwd: projectRoot, env, expectFailure: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /run `uaf index` first/);
});

test("remember refuses to store a credential and accepts a durable note", () => {
  const { projectRoot, env } = sandbox();
  const blocked = runCli(["remember", `token = "ghp_${"d".repeat(36)}"`], { cwd: projectRoot, env, expectFailure: true });
  assert.equal(blocked.code, 3);
  assert.match(blocked.stderr, /refusing to store a note containing credential material/);
  assert.equal(exists(path.join(projectRoot, ".uaf", "memory")), false);

  runCli(["remember", "Chose SQLite over Postgres for the local cache.", "--kind", "decision", "--id", "storage"], { cwd: projectRoot, env });
  const notes = runCliJson(["notes"], { cwd: projectRoot, env });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, "storage");
  assert.equal(notes[0].kind, "decision");

  runCli(["remember", "Revised: SQLite stays, but WAL mode is enabled.", "--id", "storage"], { cwd: projectRoot, env });
  const updated = runCliJson(["notes"], { cwd: projectRoot, env });
  assert.equal(updated.length, 1);
  assert.match(updated[0].text, /WAL mode/);
});

test("prompt prints a bounded always-on block containing the mode", () => {
  const { projectRoot, env } = sandbox();
  const payload = runCliJson(["prompt", "--mode", "ultra"], { cwd: projectRoot, env });
  assert.equal(payload.mode, "ultra");
  assert.ok(payload.tokens < 900, `context block costs ${payload.tokens} tokens`);
  assert.match(payload.block, /\*\*ultra\*\*/);
  assert.match(payload.block, /Never print, commit, copy, or transmit credentials/);
});

test("mode get/set/suggest round-trips through the project config", () => {
  const { projectRoot, env } = sandbox();
  assert.equal(runCliJson(["mode", "get"], { cwd: projectRoot, env }).origin, "default");
  runCli(["mode", "set", "lite"], { cwd: projectRoot, env });
  const after = runCliJson(["mode", "get"], { cwd: projectRoot, env });
  assert.equal(after.mode, "lite");
  assert.equal(after.origin, "project config");
  assert.equal(JSON.parse(readIfExists(path.join(projectRoot, ".uaf", "config.json"))).mode, "lite");

  const suggestion = runCliJson(["mode", "suggest", "--files", "src/auth/login.ts,db/migrations/01.sql,package.json"], { cwd: projectRoot, env });
  assert.equal(suggestion.mode, "ultra");
  assert.equal(suggestion.risk.level, "high");

  const invalid = runCli(["mode", "set", "turbo"], { cwd: projectRoot, env, expectFailure: true });
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /mode must be one of/);
});

test("secrets exits non-zero when a blocking finding exists", () => {
  const { projectRoot, env } = sandbox();
  writeTree(projectRoot, { "src/clean.js": "export const x = 1;\n" });
  const clean = runCli(["secrets"], { cwd: projectRoot, env });
  assert.match(clean.stdout, /does not prove the code is free of secrets/);

  writeTree(projectRoot, { "src/leak.js": `const k = "ghp_${"e".repeat(36)}";\n` });
  const dirty = runCli(["secrets"], { cwd: projectRoot, env, expectFailure: true });
  assert.equal(dirty.code, 1);
  assert.match(dirty.stdout, /blocking/);
});

test("git preflight on a clean repo passes, and blocks a staged credential file", () => {
  const { projectRoot, env } = sandbox();
  initRepo(projectRoot);
  writeTree(projectRoot, { ".gitignore": ".env\n", "src/app.js": "export const x = 1;\n" });
  runCli(["git", "--commit"], { cwd: projectRoot, env, expectFailure: true });

  execFileSync("git", ["add", ".gitignore", "src/app.js"], { cwd: projectRoot });
  const ok = runCliJson(["git", "--commit"], { cwd: projectRoot, env });
  assert.equal(ok.ok, true, JSON.stringify(ok.findings));

  fs.writeFileSync(path.join(projectRoot, ".env"), "TOKEN=x\n");
  execFileSync("git", ["add", "-f", ".env"], { cwd: projectRoot });
  const blocked = runCliJson(["git", "--commit"], { cwd: projectRoot, env, expectFailure: true });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.findings.some((f) => f.code === "staged-secret-file"));
});

test("gh preflight reports a missing remote instead of claiming success", () => {
  const { projectRoot, env } = sandbox();
  initRepo(projectRoot);
  const result = runCliJson(["gh"], { cwd: projectRoot, env, expectFailure: true });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === "no-remote"));
  assert.equal(result.summary.error >= 1, true);
});

test("unknown commands fail with usage and a non-zero exit code", () => {
  const result = runCli(["definitely-not-a-command"], { cwd: tmpdir(), expectFailure: true });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown command/);
});

test("--help and --version exit cleanly", () => {
  assert.match(runCli(["--version"]).stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.match(runCli(["--help"]).stdout, /Usage: uaf <command>/);
});

test("the guard blocks a catastrophic command and allows a benign one", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", "claude", "--yes"], { cwd: projectRoot, env });
  const guard = path.join(projectRoot, ".uaf", "hooks", "claude-guard.mjs");

  const run = (payload) => {
    try {
      const stdout = execFileSync(process.execPath, [guard], {
        cwd: projectRoot,
        env: { ...process.env, ...env },
        input: JSON.stringify(payload),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { code: 0, stdout };
    } catch (error) {
      return { code: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    }
  };

  const blocked = run({ tool_name: "Bash", tool_input: { command: "rm -rf / --no-preserve-root" } });
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /Recursive force-delete/);
  assert.match(blocked.stdout, /"decision":"block"/);

  const allowed = run({ tool_name: "Bash", tool_input: { command: "npm test" } });
  assert.equal(allowed.code, 0);

  const reviewed = run({ tool_name: "Bash", tool_input: { command: "git reset --hard HEAD~1" } });
  assert.equal(reviewed.code, 0);
  assert.match(reviewed.stdout, /Discards uncommitted work/);

  // A non-shell tool has no command string, so the guard must not interfere.
  const notAShellTool = run({ tool_name: "Read", tool_input: { file_path: "/etc/hosts" } });
  assert.equal(notAShellTool.code, 0);
  assert.equal(notAShellTool.stdout.trim(), "");
});

test("a malformed hook payload is not treated as a violation", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", "claude", "--yes"], { cwd: projectRoot, env });
  const guard = path.join(projectRoot, ".uaf", "hooks", "claude-guard.mjs");
  const stdout = execFileSync(process.execPath, [guard], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    input: "this is not json",
    encoding: "utf8",
  });
  assert.equal(stdout.trim(), "");
});

test("the installed runtime CLI is self-contained and works from the vendored copy", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", "omp", "--yes"], { cwd: projectRoot, env });
  const vendored = path.join(projectRoot, ".uaf", "framework", "core", "cli.mjs");
  const stdout = execFileSync(process.execPath, [vendored, "mode", "get", "--json"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(JSON.parse(stdout).mode, "full");
});

test("the framework never writes outside the project at project scope, even with every artifact", () => {
  const { projectRoot, home, env } = sandbox();
  runCli(["install", "--agents", "claude,codex,opencode,omp", "--yes"], { cwd: projectRoot, env });
  runCli(["index"], { cwd: projectRoot, env });
  runCli(["remember", "note"], { cwd: projectRoot, env });
  runCli(["mode", "set", "full"], { cwd: projectRoot, env });
  assert.deepEqual(fs.readdirSync(home), [], "the sandbox home must remain untouched");
  assert.ok(exists(path.join(projectRoot, ".uaf", "install.json")));
});

test("the vendored runtime is independent of the framework checkout", () => {
  const { projectRoot, env } = sandbox();
  runCli(["install", "--agents", "omp", "--yes"], { cwd: projectRoot, env });
  const vendored = path.join(projectRoot, ".uaf", "framework", "core");
  assert.ok(exists(path.join(vendored, "cli.mjs")));
  assert.deepEqual(fs.readdirSync(vendored).sort(), fs.readdirSync(path.join(FRAMEWORK_ROOT, "core")).sort());
});

test("a configured agent list is used when --agents is absent and nothing is detected", () => {
  const { projectRoot, env } = sandbox();
  writeTree(projectRoot, { ".uaf/config.json": JSON.stringify({ agents: ["claude"], mode: "lite" }) });
  // Detection must genuinely find nothing before the configured list can become the
  // default: an empty PATH (no agent binary to discover) and a home with no user
  // config directory. `sandbox()` is what makes the second half true on Windows —
  // overriding HOME alone does not isolate the child, because Node's os.homedir()
  // reads USERPROFILE there, and core/agents.mjs resolves the user roots through
  // PI_CODING_AGENT_DIR, CLAUDE_CONFIG_DIR, CODEX_HOME, OPENCODE_CONFIG_DIR and
  // XDG_CONFIG_HOME before it ever looks at the home directory.
  const isolated = { ...env, PATH: tmpdir("uaf-empty-path-") };
  const detected = runCliJson(["doctor"], { cwd: projectRoot, env: isolated }).detected;
  assert.deepEqual(detected, [], "precondition: no agent may be detected");
  const plan = runCliJson(["install", "--dry-run"], { cwd: projectRoot, env: isolated });
  assert.deepEqual(plan.agents, ["claude"]);
});

test("index.exclude from project config is applied to the index", () => {
  const { projectRoot, env } = sandbox();
  writeTree(projectRoot, {
    "src/app.js": "export const x = 1;\n",
    "vendor-copy/generated.js": "export const y = 2;\n",
    ".uaf/config.json": JSON.stringify({ index: { exclude: ["vendor-copy/"] } }),
  });
  runCliJson(["index"], { cwd: projectRoot, env });
  const found = runCliJson(["search", "generated"], { cwd: projectRoot, env });
  assert.deepEqual(found.results, []);
  const app = runCliJson(["search", "app.js"], { cwd: projectRoot, env });
  assert.ok(app.results.length >= 1);
});
