// Reversal of an install plan, driven entirely by the ownership manifest.
//
// Nothing is deleted unless the manifest claims it and the on-disk content still
// matches what we wrote. A user-edited artifact is reported, never silently removed.

import fs from "node:fs";
import path from "node:path";
import { BLOCK_END, loadManifest, manifestPath, removeBlock } from "./manifest.mjs";
import { atomicWrite, exists, isDirectory, isFile, nowIso, readTextOrNull, sha256, toPosix } from "./util.mjs";

function hashOf(target) {
  if (!exists(target)) return null;
  const stat = fs.statSync(target);
  if (stat.isFile()) return sha256(fs.readFileSync(target));
  if (!stat.isDirectory()) return null;
  const parts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else parts.push(`${toPosix(path.relative(target, abs))}:${sha256(fs.readFileSync(abs))}`);
    }
  };
  walk(target);
  return sha256(parts.join("\n"));
}

/** Deep removal of one JSON array element, pruning now-empty containers. */
function removeJsonValue(root, pointer, value) {
  const parents = [];
  let node = root;
  for (let i = 0; i < pointer.length - 1; i += 1) {
    parents.push([node, pointer[i]]);
    if (typeof node[pointer[i]] !== "object" || node[pointer[i]] === null) return { removed: false, changed: false };
    node = node[pointer[i]];
  }
  const key = pointer[pointer.length - 1];
  if (!Array.isArray(node[key])) return { removed: false, changed: false };
  const index = node[key].findIndex((item) => JSON.stringify(item) === JSON.stringify(value));
  if (index === -1) return { removed: false, changed: false };
  node[key].splice(index, 1);
  if (node[key].length === 0) delete node[key];
  for (const [parent, parentKey] of parents.reverse()) {
    if (typeof parent[parentKey] === "object" && parent[parentKey] !== null && Object.keys(parent[parentKey]).length === 0) delete parent[parentKey];
  }
  return { removed: true, changed: true };
}

/**
 * Prune every directory left empty by the removal pass, deepest first. Without
 * this, an uninstall leaves the agent's directory tree behind as empty folders,
 * which looks like a partial removal.
 */
function pruneEmptiedTree(targets, scopeRoot) {
  const candidates = new Set();
  for (const target of targets) {
    let dir = path.dirname(target);
    while (dir.startsWith(scopeRoot) && dir !== scopeRoot && dir !== path.dirname(dir)) {
      if (path.basename(dir).startsWith(".") || dir.includes(`${path.sep}.`)) candidates.add(dir);
      dir = path.dirname(dir);
    }
  }
  const ordered = [...candidates].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  const removed = [];
  for (const dir of ordered) {
    if (!isDirectory(dir)) continue;
    if (fs.readdirSync(dir).length > 0) continue;
    fs.rmdirSync(dir);
    removed.push(dir);
  }
  return removed;
}

/**
 * @param {object} options
 * @param {string} options.scopeRoot
 * @param {boolean} [options.purgeProjectState] also delete index/memory (never delete user config)
 * @param {(e: object) => void} [options.onEvent]
 */
export function uninstall({ scopeRoot, purgeProjectState = false, onEvent = () => {} }) {
  const manifest = loadManifest(scopeRoot);
  const removed = [];
  const preserved = [];
  const pruned = [];
  const removalTargets = [];
  const contextFilesToCheck = new Set();

  for (const entry of manifest.entries) {
    const target = entry.target;
    switch (entry.type) {
      case "copy": {
        if (!exists(target)) {
          preserved.push({ ...entry, reason: "already absent" });
          break;
        }
        const current = hashOf(target);
        if (entry.hash && current !== entry.hash) {
          preserved.push({ ...entry, reason: "content changed since install; left in place" });
          break;
        }
        fs.rmSync(target, { recursive: true, force: true });
        removalTargets.push(target);
        removed.push(entry);
        break;
      }
      case "link": {
        if (!exists(target)) {
          preserved.push({ ...entry, reason: "already absent" });
          break;
        }
        if (!fs.lstatSync(target).isSymbolicLink()) {
          preserved.push({ ...entry, reason: "target is no longer a symlink; left in place" });
          break;
        }
        fs.unlinkSync(target);
        removalTargets.push(target);
        removed.push(entry);
        break;
      }
      case "block": {
        const text = readTextOrNull(target);
        if (text === null) {
          preserved.push({ ...entry, reason: "file absent" });
          break;
        }
        if (!text.includes(BLOCK_END)) {
          preserved.push({ ...entry, reason: "managed block not found; left in place" });
          break;
        }
        const { text: next, removed: didRemove } = removeBlock(text);
        if (!didRemove) {
          preserved.push({ ...entry, reason: "managed block not found; left in place" });
          break;
        }
        if (next.trim() === "" && entry.created) {
          fs.rmSync(target, { force: true });
          removalTargets.push(target);
          removed.push({ ...entry, status: "file-removed" });
        } else {
          atomicWrite(target, next);
          contextFilesToCheck.add(target);
          removed.push({ ...entry, status: "block-removed" });
        }
        break;
      }
      case "json-array-append": {
        const text = readTextOrNull(target);
        if (text === null) {
          preserved.push({ ...entry, reason: "file absent" });
          break;
        }
        const parsed = (() => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        })();
        if (parsed === null || typeof parsed !== "object") {
          preserved.push({ ...entry, reason: "not valid JSON; left in place" });
          break;
        }
        const result = removeJsonValue(parsed, entry.pointer, entry.value);
        if (!result.removed) {
          preserved.push({ ...entry, reason: "value no longer present (edited by hand?); left in place" });
          break;
        }
        if (entry.created && Object.keys(parsed).length === 0) {
          fs.rmSync(target, { force: true });
          removalTargets.push(target);
          removed.push({ ...entry, status: "file-removed" });
          break;
        }
        atomicWrite(target, `${JSON.stringify(parsed, null, 2)}\n`);
        removed.push({ ...entry, status: "value-removed" });
        break;
      }
      case "write-if-absent": {
        if (!exists(target)) {
          preserved.push({ ...entry, reason: "already absent" });
          break;
        }
        if (hashOf(target) !== entry.hash) {
          preserved.push({ ...entry, reason: "content changed since install; left in place" });
          break;
        }
        fs.rmSync(target, { force: true });
        removalTargets.push(target);
        removed.push(entry);
        break;
      }
      default:
        preserved.push({ ...entry, reason: `unknown entry type ${entry.type}` });
    }
  }

  // Framework-owned plumbing that is not agent-facing.
  for (const file of [path.join(scopeRoot, ".uaf", "guard-rules.json"), path.join(scopeRoot, ".uaf", "index.lock")]) {
    if (isFile(file)) {
      fs.rmSync(file, { force: true });
      removalTargets.push(file);
      removed.push({ type: "internal", target: file });
    }
  }

  if (purgeProjectState) {
    const stateRoot = path.join(scopeRoot, ".uaf");
    for (const rel of ["index.json", "memory", "cache"]) {
      const target = path.join(stateRoot, rel);
      if (exists(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push({ type: "project-state", target });
      }
    }
  } else {
    onEvent({ type: "info", message: "project index and memory were kept; pass --purge to delete .uaf/index.json and .uaf/memory" });
  }

  const manifestFile = manifestPath(scopeRoot);
  if (isFile(manifestFile)) {
    fs.rmSync(manifestFile, { force: true });
    removalTargets.push(manifestFile);
    removed.push({ type: "manifest", target: manifestFile });
  }

  pruned.push(...pruneEmptiedTree(removalTargets, scopeRoot));

  return { removed, preserved, pruned, scopeRoot, finishedAt: nowIso() };
}

/** Manifest inspection used by `uaf status` and `doctor`. */
export function describeManifest(scopeRoot) {
  const manifest = loadManifest(scopeRoot);
  const drift = [];
  for (const entry of manifest.entries) {
    if (!exists(entry.target)) {
      drift.push({ ...entry, state: "missing" });
      continue;
    }
    if (entry.hash && hashOf(entry.target) !== entry.hash) drift.push({ ...entry, state: "modified" });
  }
  return {
    exists: isFile(manifestPath(scopeRoot)),
    scopeRoot,
    frameworkVersion: manifest.frameworkVersion,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    agents: manifest.agents,
    entries: manifest.entries.length,
    drift,
  };
}
