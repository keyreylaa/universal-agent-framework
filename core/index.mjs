// Deterministic, dependency-free project index.
//
// Deliberately not embeddings: a substring/symbol index answers the questions an
// agent actually asks at the start of a task ("where is X handled", "what are the
// build commands") at a fraction of the cost, with no service or model to trust.
// Revisit only if measured retrieval failures justify semantic search.

import fs from "node:fs";
import path from "node:path";
import {
  MAX_INDEX_FILE_BYTES,
  atomicWrite,
  findProjectRoot,
  isFile,
  listImmediateDirs,
  looksBinary,
  nowIso,
  readJsonOrNull,
  relativeTo,
  sha256,
  toPosix,
  walkProject,
} from "./util.mjs";
import { isExemptSecretName, isSecretFileName } from "./secrets.mjs";

export const INDEX_VERSION = 2;

const LANGUAGE_BY_EXT = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cs": "csharp",
  ".php": "php",
  ".rb": "ruby",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".swift": "swift",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".sql": "sql",
  ".html": "html",
  ".css": "css",
  ".scss": "css",
  ".vue": "vue",
  ".svelte": "svelte",
  ".dart": "dart",
  ".lua": "lua",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".tf": "terraform",
  ".hcl": "hcl",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".json": "json",
  ".jsonc": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".rst": "rst",
  ".dockerfile": "docker",
  ".proto": "protobuf",
  ".graphql": "graphql",
  ".gql": "graphql",
};

const SYMBOL_PATTERNS = {
  typescript: [
    /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  ],
  python: [/^(?:async\s+)?def\s+(\w+)/, /^class\s+(\w+)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?(\w+)/, /^type\s+(\w+)/],
  rust: [/^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?fn\s+(\w+)/, /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/, /^\s*impl\s+([\w:<>\s]+)/],
  java: [/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:class|interface|enum|record)\s+(\w+)/],
  kotlin: [/^\s*(?:fun|class|object|interface)\s+(\w+)/],
  csharp: [/^\s*(?:public|internal|private|protected)?\s*(?:static\s+|sealed\s+|abstract\s+)*(?:class|interface|record|struct|enum)\s+(\w+)/],
  php: [/^\s*(?:final\s+|abstract\s+)?(?:class|interface|trait|enum)\s+(\w+)/, /^\s*(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)/],
  ruby: [/^\s*def\s+(?:self\.)?(\w+[?!=]?)/, /^\s*(?:class|module)\s+(\w+)/],
  c: [/^\s*(?:static\s+|inline\s+)*[\w*]+\s+(\w+)\s*\([^;]*\)\s*\{/, /^\s*(?:typedef\s+)?(?:struct|union|enum)\s+(\w+)/],
  cpp: [/^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|enum)\s+(\w+)/, /^\s*[\w:<>*&]+\s+(\w+)\s*\([^;]*\)\s*\{/],
  shell: [/^\s*(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/],
  powershell: [/^\s*function\s+([\w-]+)/],
  sql: [/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|INDEX|FUNCTION|PROCEDURE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)/i],
  dart: [/^\s*(?:class|mixin|enum)\s+(\w+)/, /^\s*[\w<>]+\s+(\w+)\s*\([^;{]*\)\s*\{/],
  elixir: [/^\s*(?:defmodule|def|defp)\s+([\w.!?]+)/],
};

const TEST_PATH = /(^|\/)(tests?|spec|__tests__|e2e|integration)(\/|$)|\.(test|spec|_test)\.[a-z]+$/i;
const DOC_EXT = { ".md": true, ".mdx": true, ".rst": true, ".txt": true, ".adoc": true };
const CONFIG_EXT = { ".json": true, ".jsonc": true, ".yaml": true, ".yml": true, ".toml": true, ".ini": true, ".cfg": true, ".conf": true, ".env": true, ".tf": true, ".hcl": true };

const MAX_SYMBOLS = 60;

function classify(rel, ext) {
  if (TEST_PATH.test(rel)) return "test";
  if (DOC_EXT[ext] === true) return "doc";
  if (CONFIG_EXT[ext] === true) return "config";
  if (LANGUAGE_BY_EXT[ext]) return "code";
  return "other";
}

export function languageOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === "") {
    const base = path.basename(file).toLowerCase();
    if (base === "dockerfile") return "docker";
    if (base === "makefile" || base === "gnumakefile") return "make";
    if (base === "cmakelists.txt") return "cmake";
    return null;
  }
  return LANGUAGE_BY_EXT[ext] ?? null;
}

function extractSymbols(text, language) {
  const patterns = SYMBOL_PATTERNS[language];
  if (!patterns) return [];
  const symbols = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && symbols.length < MAX_SYMBOLS; i += 1) {
    const line = lines[i];
    if (line.length > 400) continue;
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match && match[1]) {
        const name = match[1].trim();
        if (name !== "" && name.length <= 80) symbols.push({ name, line: i + 1 });
        break;
      }
    }
  }
  return symbols;
}

function readIndexFile(root, rel) {
  const abs = path.join(root, rel);
  const stat = fs.statSync(abs);
  if (stat.size > MAX_INDEX_FILE_BYTES) return { skipped: "too-large", size: stat.size };
  const buf = fs.readFileSync(abs);
  if (looksBinary(buf)) return { skipped: "binary", size: stat.size };
  return { buf, stat };
}

/**
 * Build or incrementally refresh the project index.
 * @returns {{index: object, stats: object, warnings: string[]}}
 */
export function buildIndex(root = process.cwd(), { previous = null, force = false, extraExcludes = [] } = {}) {
  const projectRoot = findProjectRoot(root);
  const warnings = [];
  const startedAt = Date.now();
  const files = walkProject(projectRoot, { extraPatterns: extraExcludes });
  const previousByPath = new Map((previous?.files ?? []).map((f) => [f.path, f]));
  const entries = [];
  const stats = { scanned: files.length, indexed: 0, reused: 0, rehashed: 0, skippedSecret: 0, skippedBinary: 0, skippedLarge: 0, removed: 0, added: 0, changed: 0 };

  for (const rel of files) {
    if (isSecretFileName(rel) && !isExemptSecretName(rel)) {
      stats.skippedSecret += 1;
      continue;
    }
    const prev = previousByPath.get(rel);
    let read;
    try {
      read = readIndexFile(projectRoot, rel);
    } catch {
      warnings.push(`unreadable: ${rel}`);
      continue;
    }
    if (read.skipped === "too-large") {
      stats.skippedLarge += 1;
      entries.push({ path: rel, size: read.size, kind: "other", skipped: "too-large" });
      continue;
    }
    if (read.skipped === "binary") {
      stats.skippedBinary += 1;
      entries.push({ path: rel, size: read.size, kind: "binary", skipped: "binary" });
      continue;
    }
    const { buf, stat } = read;
    const ext = path.extname(rel).toLowerCase();
    const language = languageOf(rel);
    const kind = classify(rel, ext);

    if (!force && prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs && !prev.skipped) {
      stats.reused += 1;
      entries.push({ ...prev, kind: prev.kind ?? kind, language: prev.language ?? language });
      continue;
    }

    stats.rehashed += 1;
    const digest = sha256(buf);
    if (prev && prev.hash === digest) {
      // Rewritten or touched but byte-identical: keep the old entry, refresh metadata.
      stats.reused += 1;
      entries.push({ ...prev, size: stat.size, mtimeMs: stat.mtimeMs });
      continue;
    }

    const text = buf.toString("utf8");
    if (prev === undefined) stats.added += 1;
    else stats.changed += 1;

    entries.push({
      path: rel,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: digest,
      lines: text === "" ? 0 : text.split("\n").length,
      kind,
      language,
      symbols: extractSymbols(text, language),
      headline: firstMeaningfulLine(text),
    });
  }

  const seen = new Set(entries.map((e) => e.path));
  stats.removed = (previous?.files ?? []).filter((f) => !seen.has(f.path)).length;
  stats.indexed = entries.filter((e) => !e.skipped).length;

  const index = {
    version: INDEX_VERSION,
    root: projectRoot,
    generatedAt: nowIso(),
    mode: previous?.mode ?? null,
    files: entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    tooling: detectTooling(projectRoot, entries),
    structure: summarizeStructure(projectRoot, entries),
    notes: previous?.notes ?? [],
  };
  stats.durationMs = Date.now() - startedAt;
  return { index, stats, warnings };
}

function firstMeaningfulLine(text) {
  for (const line of text.split("\n", 40)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
  }
  return "";
}

const MANIFESTS = [
  { file: "package.json", manager: "npm/pnpm/yarn", kind: "node" },
  { file: "pnpm-lock.yaml", manager: "pnpm", kind: "node" },
  { file: "yarn.lock", manager: "yarn", kind: "node" },
  { file: "package-lock.json", manager: "npm", kind: "node" },
  { file: "pyproject.toml", manager: "pip/uv/poetry", kind: "python" },
  { file: "requirements.txt", manager: "pip", kind: "python" },
  { file: "uv.lock", manager: "uv", kind: "python" },
  { file: "Pipfile", manager: "pipenv", kind: "python" },
  { file: "go.mod", manager: "go", kind: "go" },
  { file: "Cargo.toml", manager: "cargo", kind: "rust" },
  { file: "pom.xml", manager: "maven", kind: "jvm" },
  { file: "build.gradle", manager: "gradle", kind: "jvm" },
  { file: "build.gradle.kts", manager: "gradle", kind: "jvm" },
  { file: "Gemfile", manager: "bundler", kind: "ruby" },
  { file: "composer.json", manager: "composer", kind: "php" },
  { file: "mix.exs", manager: "mix", kind: "elixir" },
  { file: "pubspec.yaml", manager: "pub", kind: "dart" },
  { file: "*.csproj", manager: "dotnet", kind: "dotnet" },
];

const TEST_TOOLS = [
  ["vitest.config.ts", "vitest"], ["vitest.config.js", "vitest"], ["jest.config.js", "jest"], ["jest.config.ts", "jest"],
  ["pytest.ini", "pytest"], ["tox.ini", "tox"], ["playwright.config.ts", "playwright"], ["cypress.config.ts", "cypress"],
  ["Cargo.toml", "cargo test"], ["go.mod", "go test"], ["build.gradle", "gradle test"], ["pom.xml", "maven test"],
];

const LINT_TOOLS = [
  [".eslintrc", "eslint"], [".eslintrc.js", "eslint"], [".eslintrc.json", "eslint"], ["eslint.config.js", "eslint"], ["eslint.config.mjs", "eslint"],
  ["biome.json", "biome"], ["ruff.toml", "ruff"], [".ruff.toml", "ruff"], [".flake8", "flake8"], ["golangci.yml", ".golangci.yml"],
  [".prettierrc", "prettier"], ["rustfmt.toml", "rustfmt"], [".editorconfig", "editorconfig"],
];

export function detectTooling(root, entries) {
  const paths = new Set(entries.map((e) => e.path));
  const baseNames = new Set(entries.map((e) => path.posix.basename(e.path)));
  const manifests = MANIFESTS.filter((m) => paths.has(m.file) || baseNames.has(m.file)).map((m) => ({ file: m.file, manager: m.manager, kind: m.kind }));
  const tests = [];
  for (const [file, tool] of TEST_TOOLS) if (paths.has(file)) tests.push(tool);
  const lint = [];
  for (const [file, tool] of LINT_TOOLS) if (paths.has(file)) lint.push(tool);
  const ci = entries.filter((e) => e.path.startsWith(".github/workflows/") || e.path === ".gitlab-ci.yml" || e.path.startsWith(".circleci/")).map((e) => e.path);
  const languages = {};
  for (const entry of entries) {
    if (!entry.language) continue;
    languages[entry.language] = (languages[entry.language] ?? 0) + 1;
  }
  const commands = detectCommands(root, paths, manifests, tests, lint);
  return {
    manifests,
    testTools: [...new Set(tests)],
    lintTools: [...new Set(lint)],
    ci,
    languages,
    commands,
    hasDocker: baseNames.has("Dockerfile") || baseNames.has("docker-compose.yml") || baseNames.has("compose.yaml"),
    hasAgentsMd: baseNames.has("AGENTS.md"),
    hasClaudeMd: baseNames.has("CLAUDE.md"),
  };
}

function detectCommands(root, paths, manifests, tests, lint) {
  const commands = {};
  const pkgPath = path.join(root, "package.json");
  if (isFile(pkgPath)) {
    const pkg = readJsonOrNull(pkgPath);
    const scripts = pkg?.scripts ?? {};
    if (scripts.test) commands.test = `npm test`;
    if (scripts.build) commands.build = `npm run build`;
    if (scripts.lint) commands.lint = `npm run lint`;
    commands.scripts = Object.keys(scripts).sort();
    commands.packageManager = pkg?.packageManager ?? null;
  }
  if (paths.has("Makefile")) {
    commands.make = true;
    const text = safeRead(path.join(root, "Makefile"));
    if (text) {
      commands.makeTargets = [...text.matchAll(/^([a-zA-Z0-9_.-]+):(?!=)/gm)].map((m) => m[1]).slice(0, 25);
    }
  }
  if (paths.has("pyproject.toml")) {
    const text = safeRead(path.join(root, "pyproject.toml")) ?? "";
    if (text.includes("[tool.pytest")) commands.test ??= "pytest";
    if (text.includes("hatch")) commands.build ??= "python -m build";
  }
  if (paths.has("Cargo.toml")) {
    commands.build ??= "cargo build";
    commands.test ??= "cargo test";
    commands.lint ??= "cargo clippy";
  }
  if (paths.has("go.mod")) {
    commands.build ??= "go build ./...";
    commands.test ??= "go test ./...";
    commands.lint ??= "go vet ./...";
  }
  if (manifests.some((m) => m.kind === "jvm")) {
    commands.build ??= manifests.some((m) => m.manager === "maven") ? "mvn package" : "./gradlew build";
    commands.test ??= manifests.some((m) => m.manager === "maven") ? "mvn test" : "./gradlew test";
  }
  if (tests.includes("pytest") && !commands.test) commands.test = "pytest";
  if (lint.length > 0 && !commands.lint) commands.lint = lint[0];
  return commands;
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function summarizeStructure(root, entries, depth = 2) {
  const buckets = new Map();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    const key = parts.slice(0, depth).join("/") || ".";
    const bucket = buckets.get(key) ?? { path: key, files: 0, codeFiles: 0, lines: 0 };
    bucket.files += 1;
    if (entry.kind === "code" || entry.kind === "test") bucket.codeFiles += 1;
    bucket.lines += entry.lines ?? 0;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.files - a.files || a.path.localeCompare(b.path)).slice(0, 60);
}

// --- persistence ------------------------------------------------------------

export function indexPath(root) {
  return path.join(findProjectRoot(root), ".uaf", "index.json");
}

export function memoryDir(root) {
  return path.join(findProjectRoot(root), ".uaf", "memory");
}

export function lockPath(root) {
  return path.join(findProjectRoot(root), ".uaf", "index.lock");
}

export function readIndex(root) {
  return readJsonOrNull(indexPath(root));
}

export function writeIndex(root, index) {
  const file = indexPath(root);
  atomicWrite(file, `${JSON.stringify(index, null, 2)}\n`);
  return file;
}

/**
 * Lock file protocol: created before walking, removed after the index is written.
 * A leftover lock means the previous run was interrupted; the index is still
 * consistent because writes are atomic, so recovery is just re-running the build.
 */
export function acquireLock(root) {
  const file = lockPath(root);
  const stale = isFile(file);
  atomicWrite(file, `${JSON.stringify({ pid: process.pid, startedAt: nowIso() })}\n`);
  return {
    stale,
    release() {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* already gone */
      }
    },
  };
}

export function indexStats(index) {
  const byKind = {};
  const byLanguage = {};
  let lines = 0;
  for (const file of index.files ?? []) {
    byKind[file.kind] = (byKind[file.kind] ?? 0) + 1;
    if (file.language) byLanguage[file.language] = (byLanguage[file.language] ?? 0) + 1;
    lines += file.lines ?? 0;
  }
  return { files: (index.files ?? []).length, lines, byKind, byLanguage };
}

export function upsertNote(index, note) {
  const notes = index.notes ?? [];
  const existing = notes.findIndex((n) => n.id === note.id);
  const record = { ...note, updatedAt: nowIso() };
  if (existing === -1) notes.push(record);
  else notes[existing] = { ...notes[existing], ...record };
  index.notes = notes;
  return index;
}

export { relativeTo, listImmediateDirs, toPosix };
