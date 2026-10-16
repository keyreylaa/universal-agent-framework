// Secret detection used by git/GitHub preflight, the memory indexer, and the
// always-on hook. Pattern matching only: it never proves a repository is clean,
// and it deliberately errs toward reporting suspicious content.

import fs from "node:fs";
import path from "node:path";
import { looksBinary, toPosix, walkProject } from "./util.mjs";

/**
 * `severity: "high"` findings block a commit or push.
 * `severity: "review"` findings are reported and require an explicit override.
 */
export const SECRET_PATTERNS = [
  {
    id: "private-key",
    severity: "high",
    description: "PEM private key block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    id: "aws-access-key-id",
    severity: "high",
    description: "AWS access key id",
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "aws-secret-access-key",
    severity: "high",
    description: "AWS secret access key assignment",
    regex: /aws_?secret_?access_?key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/gi,
  },
  {
    id: "github-token",
    severity: "high",
    description: "GitHub personal access / app token",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  {
    id: "slack-token",
    severity: "high",
    description: "Slack token",
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "stripe-key",
    severity: "high",
    description: "Stripe secret key",
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: "openai-key",
    severity: "high",
    description: "OpenAI-style API key",
    regex: /\bsk-[A-Za-z0-9_-]{32,}\b/g,
  },
  {
    id: "anthropic-key",
    severity: "high",
    description: "Anthropic API key",
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "google-api-key",
    severity: "high",
    description: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "huggingface-token",
    severity: "high",
    description: "Hugging Face token",
    regex: /\bhf_[A-Za-z0-9]{30,}\b/g,
  },
  {
    id: "jwt",
    severity: "review",
    description: "JSON Web Token",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: "discord-bot-token",
    severity: "high",
    description: "Discord bot token",
    regex: /\b[MNO][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
  },
  {
    id: "generic-credential-assignment",
    severity: "review",
    description: "Hard-coded credential in an assignment",
    regex:
      /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token)\b["']?\s*[:=]\s*["'][^"'\s${}]{12,}["']/gi,
  },
  {
    id: "connection-string-password",
    severity: "review",
    description: "Password embedded in a connection URL",
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{6,}@[^\s/]+/gi,
  },
  {
    id: "npm-token",
    severity: "high",
    description: "npm access token",
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "bearer-token",
    severity: "review",
    description: "Literal bearer token",
    regex: /["']?[Bb]earer\s+[A-Za-z0-9._-]{20,}["']?/g,
  },
];

const SECRET_FILE_NAMES = {
  ".env": true,
  ".env.local": true,
  ".env.development": true,
  ".env.production": true,
  ".env.test": true,
  ".netrc": true,
  _netrc: true,
  ".pgpass": true,
  ".htpasswd": true,
  id_rsa: true,
  id_dsa: true,
  id_ecdsa: true,
  id_ed25519: true,
  credentials: true,
  "credentials.json": true,
  "service-account.json": true,
  "serviceaccount.json": true,
  ".npmrc": true,
  ".pypirc": true,
  ".dockercfg": true,
  ".git-credentials": true,
  "terraform.tfstate": true,
  kubeconfig: true,
  "secrets.yml": true,
  "secrets.yaml": true,
};

const SECRET_FILE_SUFFIXES = [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".asc"];

const SECRET_FILE_DIRS = { secrets: true, ".secrets": true, ".ssh": true, ".aws": true, ".gnupg": true };

/** Placeholder values that look like assignments but carry no secret. */
const PLACEHOLDER = /(?:example|placeholder|dummy|sample|redacted|changeme|your[_-]?|xxx+|\*\*\*|<[^>]+>|\$\{|\{\{|process\.env|os\.environ|import\.meta\.env)/i;

/** Files whose own name marks them as secret-bearing, regardless of content. */
export function isSecretFileName(relPath) {
  const posix = toPosix(relPath);
  const base = path.posix.basename(posix).toLowerCase();
  const dirs = posix.split("/").slice(0, -1).map((d) => d.toLowerCase());
  if (SECRET_FILE_NAMES[base] === true) return true;
  if (base.startsWith(".env.") && base !== ".env.example" && base !== ".env.sample" && base !== ".env.template") return true;
  // A `.env` suffix is a credential-file convention in every ecosystem, whether or
  // not the basename is exactly `.env` (for example `production.env`, `app.env`).
  if (base !== ".env.example" && base.endsWith(".env")) return true;
  if (base === ".envrc") return true;
  if (SECRET_FILE_SUFFIXES.some((suffix) => base.endsWith(suffix))) return true;
  if (dirs.some((d) => SECRET_FILE_DIRS[d] === true)) return true;
  return false;
}

/** Files that are safe to index even though their name looks secret-bearing. */
export function isExemptSecretName(relPath) {
  const base = path.posix.basename(toPosix(relPath)).toLowerCase();
  return (
    base === ".env.example" ||
    base === ".env.sample" ||
    base === ".env.template" ||
    base.endsWith(".example") ||
    base.endsWith(".sample") ||
    base.endsWith(".template") ||
    base.endsWith(".pub") ||
    base === ".npmrc.example"
  );
}

function redact(match) {
  if (match.length <= 8) return "***";
  return `${match.slice(0, 4)}…${match.slice(-2)}`;
}

function entropicCandidate(text) {
  // Catches long random-looking literals that no named pattern claims yet.
  const findings = [];
  const re = /["']([A-Za-z0-9+/=_-]{40,120})["']/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const value = match[1];
    if (PLACEHOLDER.test(value)) continue;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((c) => c.test(value)).length;
    if (classes < 3) continue;
    findings.push(value);
  }
  return findings;
}

/**
 * Scan text for secrets.
 * @returns {{id: string, severity: string, description: string, line: number, preview: string}[]}
 */
export function scanText(text, { pathHint = "" } = {}) {
  const findings = [];
  const lines = text.split("\n");
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      const lineText = lines[line - 1] ?? "";
      if (PLACEHOLDER.test(lineText) && pattern.severity !== "high") continue;
      findings.push({
        id: pattern.id,
        severity: pattern.severity,
        description: pattern.description,
        path: pathHint,
        line,
        preview: redact(match[0]),
      });
      if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
    }
  }
  for (const value of entropicCandidate(text)) {
    const index = text.indexOf(value);
    findings.push({
      id: "high-entropy-literal",
      severity: "review",
      description: "Long high-entropy string literal",
      path: pathHint,
      line: text.slice(0, index).split("\n").length,
      preview: redact(value),
    });
  }
  return findings;
}

export function scanBuffer(buf, options = {}) {
  if (looksBinary(buf)) return [];
  return scanText(buf.toString("utf8"), options);
}

export function summarize(findings) {
  const blocking = findings.filter((f) => f.severity === "high").length;
  const review = findings.length - blocking;
  return { total: findings.length, blocking, review };
}

export function formatFindings(findings, root) {
  return findings
    .map((f) => {
      const where = f.path ? ` ${root ? toPosix(path.relative(root, f.path)) : f.path}` : "";
      return `[${f.severity}]${where}:${f.line} ${f.description} (${f.preview})`;
    })
    .join("\n");
}

/**
 * Scan files or directories. Secret-named files are reported as findings by name
 * rather than being read, so a scan never pulls key material into memory or logs.
 */
export function scanPaths(targets, { ignoreSecrets = false, maxBytes = 2 * 1024 * 1024, extraExcludes = [] } = {}) {
  const findings = [];
  const files = [];
  const stats = { scanned: 0, skipped: 0 };

  for (const target of targets) {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      for (const rel of walkProject(target, { extraPatterns: extraExcludes })) files.push(path.join(target, rel));
    } else if (fs.existsSync(target)) {
      files.push(target);
    }
  }

  for (const file of files) {
    const shown = path.isAbsolute(file) ? file : path.resolve(file);
    if (!ignoreSecrets && isSecretFileName(file) && !isExemptSecretName(file)) {
      findings.push({ id: "secret-file", severity: "high", description: "File whose name marks it as credential-bearing", path: shown, line: 0, preview: path.basename(file) });
      stats.skipped += 1;
      continue;
    }
    let buf;
    try {
      const stat = fs.statSync(file);
      if (stat.size > maxBytes) {
        stats.skipped += 1;
        continue;
      }
      buf = fs.readFileSync(file);
    } catch {
      stats.skipped += 1;
      continue;
    }
    stats.scanned += 1;
    for (const finding of scanBuffer(buf, { pathHint: shown })) findings.push(finding);
  }

  return { scanned: stats.scanned, skipped: stats.skipped, findings };
}
