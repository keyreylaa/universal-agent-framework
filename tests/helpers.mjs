// Shared test helpers. Every test builds its own temporary tree; nothing touches
// the developer's real configuration directories.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, "..");
export const CLI = path.join(FRAMEWORK_ROOT, "core", "cli.mjs");

const created = [];

/** @returns {string} an empty temporary directory */
export function tmpdir(prefix = "uaf-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
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
