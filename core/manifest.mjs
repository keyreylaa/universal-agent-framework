// Ownership manifest.
//
// Every mutation the framework makes is recorded here so uninstall can remove
// exactly what this framework created and nothing else. An entry that a user has
// edited after installation is detected by hash and reported instead of deleted.

import path from "node:path";
import { atomicWrite, exists, isFile, nowIso, readJsonOrNull, readTextOrNull, sha256, toPosix } from "./util.mjs";

export const MANIFEST_VERSION = 1;
export const BLOCK_BEGIN = "<!-- uaf:begin v1 -->";
export const BLOCK_END = "<!-- uaf:end -->";

export function manifestPath(scopeRoot) {
  return path.join(scopeRoot, ".uaf", "install.json");
}

export function loadManifest(scopeRoot) {
  const data = readJsonOrNull(manifestPath(scopeRoot));
  if (!data || typeof data !== "object") return emptyManifest(scopeRoot);
  return {
    version: data.version ?? MANIFEST_VERSION,
    scopeRoot,
    scope: data.scope ?? "unknown",
    frameworkVersion: data.frameworkVersion ?? "0.0.0",
    createdAt: data.createdAt ?? nowIso(),
    updatedAt: data.updatedAt ?? nowIso(),
    agents: Array.isArray(data.agents) ? data.agents : [],
    entries: Array.isArray(data.entries) ? data.entries : [],
  };
}

export function emptyManifest(scopeRoot, { scope = "unknown", frameworkVersion = "0.0.0" } = {}) {
  return {
    version: MANIFEST_VERSION,
    scopeRoot,
    scope,
    frameworkVersion,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    agents: [],
    entries: [],
  };
}

export function saveManifest(manifest) {
  manifest.updatedAt = nowIso();
  manifest.agents = [...new Set(manifest.entries.map((e) => e.agent).filter(Boolean))].sort();
  const file = manifestPath(manifest.scopeRoot);
  atomicWrite(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

export function addEntry(manifest, entry) {
  const key = `${entry.type}|${entry.target}`;
  const existing = manifest.entries.find((e) => `${e.type}|${e.target}` === key);
  const record = { ...entry, installedAt: entry.installedAt ?? nowIso() };
  if (existing) {
    Object.assign(existing, record);
    return existing;
  }
  manifest.entries.push(record);
  return record;
}

export function entriesFor(manifest, agent) {
  return manifest.entries.filter((e) => e.agent === agent);
}

// --- managed block helpers --------------------------------------------------

export function renderBlock(body, { title = "universal-agent-framework" } = {}) {
  return `${BLOCK_BEGIN}\n<!-- ${title}: content between these markers is generated; edit the framework sources instead. -->\n${body.trimEnd()}\n${BLOCK_END}\n`;
}

export function hasBlock(text) {
  return text.includes(BLOCK_BEGIN) && text.includes(BLOCK_END);
}

/** Replace an existing managed block, or append one. */
export function upsertBlock(text, body, options) {
  const block = renderBlock(body, options);
  if (hasBlock(text)) {
    const start = text.indexOf(BLOCK_BEGIN);
    const end = text.indexOf(BLOCK_END) + BLOCK_END.length;
    const trailing = text.slice(end).replace(/^\n/, "");
    return `${text.slice(0, start)}${block}${trailing === "" ? "" : `\n${trailing}`}`;
  }
  if (text.trim() === "") return block;
  return `${text.replace(/\s*$/, "")}\n\n${block}`;
}

/** Remove the managed block. @returns {{text: string, removed: boolean}} */
export function removeBlock(text) {
  if (!hasBlock(text)) return { text, removed: false };
  const start = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END) + BLOCK_END.length;
  const before = text.slice(0, start).replace(/\s*$/, "");
  const after = text.slice(end).replace(/^\s*/, "");
  const joined = [before, after].filter((part) => part !== "").join("\n\n");
  return { text: joined === "" ? "" : `${joined}\n`, removed: true };
}

/** Hash of the region the framework owns, so uninstall can detect user edits. */
export function blockHash(text) {
  const start = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1) return null;
  return sha256(text.slice(start, end + BLOCK_END.length));
}

export function currentBlockHash(text) {
  return blockHash(text);
}

export function fileHash(file) {
  const text = readTextOrNull(file);
  return text === null ? null : sha256(text);
}

export function describeEntry(entry, scopeRoot) {
  const rel = toPosix(path.relative(scopeRoot, entry.target));
  return `${entry.type.padEnd(5)} ${rel}${entry.skill ? ` (${entry.skill})` : ""}`;
}

export function targetExists(entry) {
  return exists(entry.target) || isFile(entry.target);
}
