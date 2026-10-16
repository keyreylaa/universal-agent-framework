// Shared filesystem, hashing, and output helpers.
// No third-party dependencies: node: builtins only.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const MAX_INDEX_FILE_BYTES = 512 * 1024;

/** Directories that never contain useful project source and are expensive to walk. */
export const DEFAULT_EXCLUDED_DIRS = {
  ".git": true,
  ".hg": true,
  ".svn": true,
  node_modules: true,
  bower_components: true,
  vendor: true,
  dist: true,
  build: true,
  out: true,
  target: true,
  coverage: true,
  ".next": true,
  ".nuxt": true,
  ".turbo": true,
  ".cache": true,
  ".parcel-cache": true,
  ".venv": true,
  venv: true,
  __pycache__: true,
  ".mypy_cache": true,
  ".pytest_cache": true,
  ".ruff_cache": true,
  ".gradle": true,
  ".idea": true,
  ".vscode": true,
  ".terraform": true,
  ".uaf": true,
};

export function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function sha256Short(data) {
  return sha256(data).slice(0, 16);
}

/**
 * Write via a temp file in the destination directory plus rename, so an
 * interrupted write never leaves a half-written file behind.
 */
export function atomicWrite(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function readText(file) {
  return fs.readFileSync(file, "utf8");
}

export function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function readJsonOrNull(file) {
  const raw = readTextOrNull(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** NUL byte or invalid-UTF8 decode in the first 8 KiB is treated as binary. */
export function looksBinary(buf) {
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  if (probe.includes(0)) return true;
  let suspicious = 0;
  for (const byte of probe) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return probe.length > 0 && suspicious / probe.length > 0.3;
}

export function toPosix(p) {
  return p.split(path.sep).join("/");
}

export function findUp(startDir, relPaths) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (relPaths.some((rel) => exists(path.join(dir, rel)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findProjectRoot(startDir = process.cwd()) {
  return findUp(startDir, [".git"]) ?? path.resolve(startDir);
}

export function countLines(text) {
  if (text === "") return 0;
  return text.split("\n").length;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

export function relativeTo(root, p) {
  const rel = path.relative(root, p);
  return toPosix(rel === "" ? "." : rel);
}

// --- .gitignore subset ------------------------------------------------------
//
// Supports the constructs that matter for excluding build output and secrets:
// comments, negation, `/`-anchored patterns, trailing-`/` directory patterns,
// `*`, `?`, and `**`. Not supported: `[...]` character classes with `!` negation
// inside the class, and git's deeper "cannot re-include a file inside an excluded
// directory" rule.

function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const prevSlash = i === 0 || glob[i - 1] === "/";
        const trailing = i + 2 === glob.length;
        if (trailing) {
          // A trailing `**` means "everything below", so it must match at least
          // one path segment rather than collapsing to nothing.
          out += prevSlash ? ".*" : ".*";
          i += 1;
        } else {
          let j = i + 2;
          if (prevSlash && glob[j] === "/") j += 1;
          out += prevSlash ? "(?:.*/)?" : ".*";
          i = j - 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

/** @returns {(relPath: string, isDir?: boolean) => boolean} */
export function compileIgnore(patterns) {
  const rules = [];
  for (const raw of patterns) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const body = negated ? line.slice(1) : line;
    const dirOnly = body.endsWith("/");
    const pattern = dirOnly ? body.slice(0, -1) : body;
    const anchored = pattern.includes("/") && !pattern.startsWith("**/");
    const bare = pattern.startsWith("/") ? pattern.slice(1) : pattern;
    const normalized = anchored || pattern.startsWith("/") ? bare : `**/${bare}`;
    rules.push({
      negated,
      dirOnly,
      regex: globToRegExp(normalized),
      rootRegex: globToRegExp(bare.replace(/^\*\*\//, "")),
      // `dir/` excludes everything beneath it, so descendants must match too.
      descendantRegex: globToRegExp(`${normalized}/**`),
      descendantRootRegex: globToRegExp(`${bare.replace(/^\*\*\//, "")}/**`),
    });
  }
  return (relPath, isDir = false) => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly) {
        const self = isDir && (rule.regex.test(relPath) || rule.rootRegex.test(relPath));
        const under = rule.descendantRegex.test(relPath) || rule.descendantRootRegex.test(relPath);
        if (!self && !under) continue;
      } else if (!rule.regex.test(relPath) && !rule.rootRegex.test(relPath)) {
        continue;
      }
      ignored = !rule.negated;
    }
    return ignored;
  };
}

/**
 * Load every .gitignore from the root down to the file's directory and return the
 * same ignore patterns regardless of walk order. Nested files are rare enough that
 * a per-directory read during the walk is cheaper than pre-indexing.
 */
export function readGitignore(dir) {
  const file = path.join(dir, ".gitignore");
  const text = readTextOrNull(file);
  if (text === null) return [];
  return text.split("\n");
}

/** Recursively collect .gitignore patterns applying to `relDir` below `root`. */
export function gitignoreStack(root, relDir) {
  const patterns = [];
  const segments = relDir === "." ? [] : relDir.split("/");
  let current = root;
  for (let depth = 0; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join("/");
    for (const line of readGitignore(current)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      // Patterns in a nested .gitignore are relative to that directory.
      patterns.push(prefix === "" ? line : anchorPattern(line, prefix));
    }
    current = path.join(current, segments[depth] ?? "");
  }
  return patterns;
}

function anchorPattern(line, prefix) {
  const negated = line.startsWith("!");
  const body = negated ? line.slice(1) : line;
  const dirOnly = body.endsWith("/");
  const bare = body.replace(/\/$/, "").replace(/^\//, "");
  // A nested pattern only matches below its own directory.
  return `${negated ? "!" : ""}/${prefix}/${bare}${dirOnly ? "/" : ""}`;
}

/**
 * Walk `root` iteratively, skipping excluded and ignored directories.
 * Returns paths relative to root in POSIX form, sorted for determinism.
 *
 * Symlinks are followed only while they stay inside `root`: a link pointing at
 * `/etc` or a home directory must not pull out-of-project files into the index.
 */
export function walkProject(root, { extraPatterns = [], excludeDirs = DEFAULT_EXCLUDED_DIRS, followSymlinks = true } = {}) {
  const results = [];
  const realRoot = fs.realpathSync(root);
  const insideRoot = (target) => {
    let real;
    try {
      real = fs.realpathSync(target);
    } catch {
      return false;
    }
    return real === realRoot || real.startsWith(realRoot + path.sep);
  };
  const stack = [{ abs: root, rel: "." }];
  while (stack.length > 0) {
    const { abs, rel } = stack.pop();
    const ignore = compileIgnore([...gitignoreStack(root, rel), ...extraPatterns]);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel === "." ? entry.name : `${rel}/${entry.name}`;
      const childAbs = path.join(abs, entry.name);
      const linked = entry.isSymbolicLink();
      if (linked && (!followSymlinks || !insideRoot(childAbs))) continue;
      const isDir = entry.isDirectory() || (linked && isDirectory(childAbs));
      const isFileEntry = entry.isFile() || (linked && isFile(childAbs));
      if (isDir) {
        if (excludeDirs[entry.name] === true) continue;
        if (ignore(childRel, true)) continue;
        stack.push({ abs: childAbs, rel: childRel });
      } else if (isFileEntry) {
        if (ignore(childRel, false)) continue;
        results.push(childRel);
      }
    }
  }
  results.sort();
  return results;
}

export function listImmediateDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDirectory(path.join(dir, e.name))))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
