// SKILL.md discovery, frontmatter parsing, and validation.
//
// The authoring format is the vendor-neutral "Agent Skills" layout that all four
// target agents read: <root>/<skill-name>/SKILL.md with `name` and `description`
// frontmatter. Validation here is intentionally stricter than any single agent's
// loader so a skill that passes is portable.

import fs from "node:fs";
import path from "node:path";
import { isFile, listImmediateDirs, readText, toPosix } from "./util.mjs";

export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const KNOWN_KEYS = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "allowed_tools",
  "metadata",
  "version",
  "globs",
  "alwaysApply",
  "hide",
  "disable-model-invocation",
  "argument-hint",
  "model",
]);

/**
 * Minimal YAML frontmatter reader. Handles the flat scalar/list shapes that
 * skill frontmatter actually uses; refuses to guess at nested structures.
 */
export function parseFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { data: {}, body: text, hasFrontmatter: false, raw: "" };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text, hasFrontmatter: false, raw: "" };
  const block = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, "");

  const data = {};
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) continue; // nested value: handled by its parent key
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();

    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const collected = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        collected.push(lines[i + 1].replace(/^\s{2}/, ""));
        i += 1;
      }
      const joined = collected.join("\n").replace(/\n+$/, "");
      value = value.startsWith(">") ? joined.replace(/\n/g, " ") : joined;
      data[key] = value;
      continue;
    }

    if (value === "" ) {
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[i + 1].replace(/^\s*-\s+/, "").trim()));
        i += 1;
      }
      if (items.length > 0) {
        data[key] = items;
        continue;
      }
      // A nested mapping (for example `metadata:`); keep the raw text.
      const nested = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        nested.push(lines[i + 1].trim());
        i += 1;
      }
      data[key] = nested.length > 0 ? nested.join("; ") : "";
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter((v) => v !== "");
      continue;
    }
    data[key] = unquote(value);
  }
  return { data, body, hasFrontmatter: true, raw: block };
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Report frontmatter lines that a strict YAML parser (the ones the target agents
 * use) would reject or silently reinterpret. Runs on the raw block so quoting is
 * still visible; our own reader is deliberately forgiving and would otherwise
 * ship a value that only fails inside an agent. Nested blocks (an empty value
 * followed by indented lines) are left to their own keys.
 */
export function frontmatterIssues(rawBlock) {
  const issues = [];
  if (!rawBlock) return issues;
  for (const line of rawBlock.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) continue; // nested value, checked through its parent
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1);
    if (rawValue.includes("\t")) issues.push(`${key}: value contains a tab`);
    const value = rawValue.trim();
    if (value === "" || value === "|" || value === ">" || value === "|-" || value === ">-") continue;
    if (value.startsWith("'") || value.startsWith('"')) continue;
    if (value.includes(": ")) issues.push(`${key}: unquoted value contains ": ", which YAML reads as a nested mapping`);
    if (value.includes(" #")) issues.push(`${key}: unquoted value contains " #", which YAML reads as a comment`);
    if (/^[[{]/.test(value) || /[\]}][ \t]+\S/.test(value)) {
      issues.push(`${key}: unquoted value contains flow brackets that strict YAML rejects in this position`);
    }
    if (/^[*&!%@`|>?,-]/.test(value)) issues.push(`${key}: unquoted value starts with a YAML indicator character`);
  }
  return issues;
}

export function serializeFrontmatter(data) {
  const order = ["name", "description", "license", "allowed-tools", "metadata"];
  const keys = [...new Set([...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))])];
  const lines = ["---"];
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

/** Load and validate one skill directory. */
export function loadSkill(dir, { source = "unknown" } = {}) {
  const file = path.join(dir, "SKILL.md");
  if (!isFile(file)) return { ok: false, errors: [`missing SKILL.md in ${toPosix(dir)}`], dir };
  const fileText = readText(file);
  const { data, body, raw } = parseFrontmatter(fileText);
  const dirName = path.basename(dir);
  const name = String(data.name ?? dirName).trim();
  const description = String(data.description ?? "").trim();

  const errors = [];
  const warnings = [];
  if (!NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
    errors.push(`name "${name}" must be ${MAX_NAME_LENGTH} chars or fewer, lowercase alphanumerics and single hyphens`);
  }
  if (name !== dirName) errors.push(`frontmatter name "${name}" does not match directory "${dirName}"`);
  if (description === "") errors.push("description is required");
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description is ${description.length} chars; maximum is ${MAX_DESCRIPTION_LENGTH}`);
  }
  if (body.trim() === "") errors.push("skill body is empty");
  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`unknown frontmatter key "${key}" (preserved, ignored by loaders)`);
  }
  if (!/^[A-Z]|^[a-z]/.test(description)) warnings.push("description should start with a sentence, not punctuation");
  errors.push(...frontmatterIssues(raw));

  return {
    ok: errors.length === 0,
    name,
    description,
    dir,
    file,
    body,
    frontmatter: data,
    bytes: Buffer.byteLength(fileText, "utf8"),
    lines: body.split("\n").length,
    source,
    errors,
    warnings,
  };
}

/** Load every <root>/<name>/SKILL.md one level below `root` (non-recursive). */
export function loadSkillTree(root, { source = "framework" } = {}) {
  if (!fs.existsSync(root)) return [];
  const skills = [];
  for (const name of listImmediateDirs(root)) {
    const dir = path.join(root, name);
    if (!isFile(path.join(dir, "SKILL.md"))) continue;
    skills.push(loadSkill(dir, { source }));
  }
  return skills;
}

/** Token cost estimate used for the context budget report. ~4 chars per token. */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
