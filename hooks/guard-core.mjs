// Guard policy shared by every agent hook entrypoint.
//
// Design: blocking rules cover irreversible or credential-exposing actions, plus
// three deliberate exceptions (package-publish, global-git-config, bypass-verify)
// that the framework refuses to do at all. Everything requiring judgement is a
// review-level warning, so a normal task is never blocked by the guard. The rules
// file is data, not code, so operators can tighten or relax policy without editing
// the entrypoints.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE = new Map();

/** Walk up from `startDir` looking for `.uaf/guard-rules.json`. */
export function findRulesFile(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ".uaf", "guard-rules.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * @param {string} [startDir] directory to begin the upward search from
 */
export function loadRules(startDir) {
  const fromEnv = process.env.UAF_GUARD_RULES;
  const file = fromEnv && fs.existsSync(fromEnv) ? fromEnv : startDir ? findRulesFile(startDir) : null;
  if (!file) return { rules: null, file: null, error: "no .uaf/guard-rules.json found" };
  if (CACHE.has(file)) return { rules: CACHE.get(file), file, error: null };
  try {
    const rules = JSON.parse(fs.readFileSync(file, "utf8"));
    CACHE.set(file, rules);
    return { rules, file, error: null };
  } catch (error) {
    return { rules: null, file, error: `unreadable guard rules: ${error.message}` };
  }
}

function matches(rule, value) {
  if (!rule.pattern) return false;
  let re;
  try {
    re = new RegExp(rule.pattern, rule.flags ?? "");
  } catch {
    return false;
  }
  if (!re.test(value)) return false;
  if (rule.exemptPattern && new RegExp(rule.exemptPattern).test(value)) return false;
  return true;
}

/**
 * Evaluate a shell command string.
 * @returns {{decision: "allow"|"review"|"block", id: string|null, reason: string|null}}
 */
export function evaluateCommand(command, rules) {
  if (!rules || typeof command !== "string") {
    return { decision: "allow", id: null, reason: null };
  }
  for (const rule of rules.blockedCommands ?? []) {
    if (matches(rule, command)) return { decision: "block", id: rule.id, reason: rule.reason ?? "blocked by policy" };
  }
  for (const rule of rules.reviewCommands ?? []) {
    if (matches(rule, command)) return { decision: "review", id: rule.id, reason: rule.reason ?? "review the command" };
  }
  return { decision: "allow", id: null, reason: null };
}

/**
 * Evaluate a file write, both by destination path and by content.
 * @returns {{decision: "allow"|"review"|"block", id: string|null, reason: string|null}}
 */
export function evaluateWrite({ filePath = "", content = "" }, rules) {
  if (!rules) return { decision: "allow", id: null, reason: null };
  const normalized = filePath.split(path.sep).join("/");
  for (const rule of rules.blockedPathWrites ?? []) {
    if (new RegExp(rule.pattern).test(normalized)) {
      return { decision: "block", id: `path:${rule.pattern}`, reason: rule.reason ?? "blocked path" };
    }
  }
  if (typeof content === "string" && content.length > 0) {
    for (const rule of rules.blockedContent ?? []) {
      if (matches(rule, content)) return { decision: "block", id: rule.id, reason: rule.reason ?? "blocked content" };
    }
  }
  return { decision: "allow", id: null, reason: null };
}

/** Resolve the directory of the calling module, for import.meta.url based callers. */
export function moduleDir(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl));
}

/**
 * Extract the most useful command string from a tool-call payload without knowing
 * the agent's exact schema. Covers Bash `command`, PowerShell `command`, and an
 * argv array.
 */
export function extractCommand(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return input;
  if (typeof input !== "object") return null;
  for (const key of ["command", "cmd", "script", "shell_command"]) {
    if (typeof input[key] === "string") return input[key];
  }
  if (Array.isArray(input)) return input.join(" ");
  return null;
}
