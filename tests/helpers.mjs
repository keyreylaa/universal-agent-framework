// Shared test helpers. Every test builds its own temporary tree; nothing touches
// the developer's real configuration directories.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, "..");
export const CLI = path.join(FRAMEWORK_ROOT, "core", "cli.mjs");

const created = [];

/**
 * @returns {string} an empty temporary directory, canonicalised
 *
 * Canonicalising matters because the CLI resolves every path against
 * `process.cwd()`, which is the POSIX `getcwd()` value. On macOS `/var` is a
 * symlink to `/private/var`, so the manifest stores `/private/var/...` while a
 * bare `os.tmpdir()` based expectation says `/var/...`; install and uninstall
 * would then appear to disagree about a path that is really the same one.
 */
export function tmpdir(prefix = "uaf-test-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/**
 * Environment for a CLI subprocess that cannot see the developer's real
 * configuration, on every platform. The overrides are pinned to the same
 * locations the agent would use by default under `home`, so a sandbox is
 * hermetic without moving where installs land.
 *
 * `HOME` alone is not enough. Node's `os.homedir()` reads `USERPROFILE` on
 * Windows and `HOME` everywhere else, and the documented per-agent overrides
 * bypass the home directory entirely, so detection would still find the
 * developer's own config. `core/agents.mjs` consults `PI_CODING_AGENT_DIR`
 * (Oh My Pi), `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_CONFIG_DIR` and
 * `XDG_CONFIG_HOME` (OpenCode) ahead of any home-derived root.
 */
export function sandboxEnv(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    PI_CODING_AGENT_DIR: path.join(home, ".omp", "agent"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    CODEX_HOME: path.join(home, ".codex"),
    OPENCODE_CONFIG_DIR: path.join(home, ".config", "opencode"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PATH: process.env.PATH,
  };
}

/** A disposable project + home pair whose CLI subprocesses see nothing else. */
export function sandbox(prefix = "uaf") {
  const projectRoot = tmpdir(`${prefix}-proj-`);
  const home = tmpdir(`${prefix}-home-`);
  return { projectRoot, home, env: sandboxEnv(home) };
}

export function cleanupAll() {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Write a tree of files described as { "rel/path": "content" }. */
export function writeTree(root, tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

/** Run the CLI in-process-like (a real subprocess, so exit codes are exercised). */
export function runCli(args, { cwd = process.cwd(), env = {}, expectFailure = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    if (!expectFailure) throw new Error(`uaf ${args.join(" ")} failed: ${error.stderr || error.message}`);
    return { code: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

export function runCliJson(args, options) {
  return JSON.parse(runCli([...args, "--json"], options).stdout);
}

export function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Minimal repository: no commits, deterministic identity, .gitignore in place. */
export function initRepo(dir, { withCommit = true } = {}) {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "Test Fixture"]);
  git(dir, ["config", "user.email", "fixture@example.invalid"]);
  if (withCommit) {
    fs.writeFileSync(path.join(dir, "README.md"), "# fixture\n");
    git(dir, ["add", "README.md"]);
    git(dir, ["commit", "-qm", "initial"]);
  }
  return dir;
}

export function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
