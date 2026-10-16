// Git and GitHub preflight.
//
// Read-only by design: the framework reports, the human decides. The only writes
// anywhere in this framework happen during install/uninstall and index updates.

import { execFileSync } from "node:child_process";
import { scanText, isSecretFileName, isExemptSecretName } from "./secrets.mjs";

/** @typedef {{ ok: boolean, stdout: string, stderr: string, missing?: boolean }} RunResult */

export function makeRunner({ cwd, env = process.env, timeout = 20000 } = {}) {
  return (cmd, args) => {
    try {
      const stdout = execFileSync(cmd, args, { cwd, env, timeout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true, stdout, stderr: "" };
    } catch (error) {
      if (error.code === "ENOENT") return { ok: false, missing: true, stdout: "", stderr: `${cmd} is not installed` };
      return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message) };
    }
  };
}

const ARTIFACT_PATTERNS = [
  [/^node_modules\//, "node_modules"],
  [/^(dist|build|out|target|coverage)\//, "build output"],
  [/\.(log|tmp|bak|orig|rej)$/, "transient file"],
  [/(^|\/)\.DS_Store$/, "OS metadata"],
  [/(^|\/)(\.idea|\.vscode)\//, "editor state"],
];

/** Split `git status --porcelain=v1 -z` output into staged/unstaged/untracked. */
export function parseStatus(z) {
  const entries = z.split("\0").filter((e) => e !== "");
  const staged = [];
  const unstaged = [];
  const untracked = [];
  for (const entry of entries) {
    const x = entry[0];
    const y = entry[1];
    const file = entry.slice(3);
    if (x === "?" && y === "?") {
      untracked.push(file);
      continue;
    }
    if (x !== " " && x !== "?") staged.push({ file, status: x });
    if (y !== " " && y !== "?") unstaged.push({ file, status: y });
  }
  return { staged, unstaged, untracked };
}

/**
 * @param {object} options
 * @param {string} options.root
 * @param {boolean} [options.commitCheck] also require staged changes (pre-commit mode)
 * @param {(cmd: string, args: string[]) => RunResult} [options.run]
 */
export function gitPreflight({ root, commitCheck = false, run = makeRunner({ cwd: root }) }) {
  const findings = [];
  const info = {};
  const add = (level, code, message, action = null) => findings.push({ level, code, message, action });

  const insideRepo = run("git", ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok) {
    add("error", "not-a-repo", "Not inside a Git work tree.", "Run `git init` or point --cwd at the repository.");
    return { ok: false, findings, info };
  }

  const insideWorktree = run("git", ["rev-parse", "--is-inside-git-dir"]);
  const top = run("git", ["rev-parse", "--show-toplevel"]);
  info.topLevel = top.ok ? top.stdout.trim() : root;
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  // On a repository with no commits yet, `rev-parse --abbrev-ref HEAD` fails even
  // though the branch is already named. Fall back to the symbolic ref.
  const branchName = branch.ok ? branch.stdout.trim() : "";
  if (branchName === "" || branchName === "HEAD") {
    const symbolic = run("git", ["symbolic-ref", "--short", "HEAD"]);
    info.branch = symbolic.ok && symbolic.stdout.trim() !== "" ? symbolic.stdout.trim() : branchName || null;
  } else {
    info.branch = branchName;
  }
  const sha = run("git", ["rev-parse", "--short", "HEAD"]);
  info.head = sha.ok ? sha.stdout.trim() : null;

  if (info.branch === "HEAD") {
    add("error", "detached-head", "HEAD is detached; a commit here creates an unreferenced commit.", "Create or switch to a branch first.");
  }
  if (insideWorktree.ok && insideWorktree.stdout.trim() === "true") {
    add("warn", "in-gitdir", "Running inside .git; path checks may not reflect the work tree.");
  }

  // Identity: configured, but not necessarily correct.
  const localName = run("git", ["config", "--local", "user.name"]);
  const localEmail = run("git", ["config", "--local", "user.email"]);
  const globalName = run("git", ["config", "--global", "user.name"]);
  const globalEmail = run("git", ["config", "--global", "user.email"]);
  info.identity = {
    local: localName.ok && localEmail.ok ? { name: localName.stdout.trim(), email: localEmail.stdout.trim() } : null,
    global: globalName.ok && globalEmail.ok ? { name: globalName.stdout.trim(), email: globalEmail.stdout.trim() } : null,
  };
  if (!info.identity.local && !info.identity.global) {
    add(
      "error",
      "no-identity",
      "No commit identity configured (user.name / user.email).",
      "This framework never invents an identity. Confirm the name and email with the user, then set it with `git config --local user.name …` and `--local user.email …`.",
    );
  } else if (!info.identity.local && info.identity.global) {
    add(
      "review",
      "global-only-identity",
      `Identity is inherited from global config: ${info.identity.global.name} <${info.identity.global.email}>.`,
      "Confirm this is the intended author, or set a repository-local identity with `git config --local`.",
    );
  }

  const status = run("git", ["status", "--porcelain=v1", "-z"]);
  const parsed = status.ok ? parseStatus(status.stdout) : { staged: [], unstaged: [], untracked: [] };
  info.status = {
    staged: parsed.staged.map((s) => s.file),
    unstaged: parsed.unstaged.map((s) => s.file),
    untracked: parsed.untracked,
  };

  if (commitCheck && parsed.staged.length === 0) {
    add("error", "nothing-staged", "Nothing is staged for commit.", "Stage the intended files explicitly; the framework never runs `git add .` for you.");
  }
  if (parsed.unstaged.length > 0) {
    add("info", "unstaged", `${parsed.unstaged.length} file(s) have unstaged changes and will not be committed.`);
  }

  // Untracked secret-bearing files are the most common accidental leak.
  const untrackedSecrets = parsed.untracked.filter((f) => isSecretFileName(f) && !isExemptSecretName(f));
  for (const file of untrackedSecrets) {
    add("error", "untracked-secret-file", `Untracked file looks credential-bearing: ${file}`, "Add it to .gitignore and confirm it was never committed.");
  }
  const stagedSecrets = parsed.staged.map((s) => s.file).filter((f) => isSecretFileName(f) && !isExemptSecretName(f));
  for (const file of stagedSecrets) {
    add("error", "staged-secret-file", `Staged file looks credential-bearing: ${file}`, "Unstage it (`git restore --staged`), rotate anything it contained, and add it to .gitignore.");
  }

  // Content scan of exactly what would be committed: the index blobs.
  const secretContentFindings = [];
  for (const { file, status: code } of parsed.staged) {
    if (code === "D") continue;
    const blob = run("git", ["show", `:${file}`]);
    if (!blob.ok) continue;
    if (blob.stdout.length > 1024 * 1024) continue;
    for (const finding of scanText(blob.stdout, { pathHint: file })) {
      if (finding.severity !== "high") continue;
      secretContentFindings.push({ ...finding, file });
    }
  }
  for (const finding of secretContentFindings) {
    add("error", `secret:${finding.id}`, `${finding.file}:${finding.line} ${finding.description} (${finding.preview})`, "Remove the value, rotate the credential, and rewrite history if it was already pushed.");
  }

  for (const { file } of parsed.staged) {
    for (const [pattern, label] of ARTIFACT_PATTERNS) {
      if (pattern.test(file)) {
        add("warn", "staged-artifact", `Staged ${label}: ${file}`, "Confirm this artifact is meant to be versioned.");
        break;
      }
    }
  }

  if (!run("git", ["rev-parse", "--verify", "HEAD"]).ok) {
    add("info", "no-commits", "Repository has no commits yet; this would be the first commit.");
  }

  const gitignore = run("git", ["ls-files", ".gitignore"]);
  if (!gitignore.ok || gitignore.stdout.trim() === "") {
    add("warn", "no-gitignore", "No tracked .gitignore.", "Commit a .gitignore that covers .env files, build output, and editor state.");
  }

  const remotes = run("git", ["remote"]);
  info.remotes = remotes.ok ? remotes.stdout.split("\n").map((r) => r.trim()).filter(Boolean) : [];

  const blocking = findings.filter((f) => f.level === "error").length;
  return { ok: blocking === 0, findings, info };
}

/**
 * GitHub-side checks. Every remote call is best-effort: a missing `gh`, absent
 * credentials, or an offline machine downgrades the result instead of failing it.
 */
export function githubPreflight({ root, remote = "origin", run = makeRunner({ cwd: root }) }) {
  const findings = [];
  const info = {};
  const add = (level, code, message, action = null) => findings.push({ level, code, message, action });

  const remoteUrl = run("git", ["remote", "get-url", remote]);
  if (!remoteUrl.ok) {
    add("error", "no-remote", `No '${remote}' remote configured.`, "Create the repository first, then `git remote add origin <url>`. Nothing has been published.");
    return { ok: false, findings, info, published: false };
  }
  info.remoteUrl = remoteUrl.stdout.trim();
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(info.remoteUrl);
  info.owner = match ? match[1] : null;
  info.repo = match ? match[2] : null;

  const ghVersion = run("gh", ["--version"]);
  if (!ghVersion.ok) {
    add("warn", "gh-missing", "GitHub CLI is unavailable; repository, CI, and protection checks were skipped.", "Install `gh` and run `gh auth status` for a complete preflight.");
    return { ok: true, findings, info, published: false, degraded: true };
  }

  const auth = run("gh", ["auth", "status"]);
  if (!auth.ok) {
    add("error", "gh-unauthenticated", "GitHub CLI is not authenticated.", "Run `gh auth login`.");
    return { ok: false, findings, info, published: false };
  }
  info.authenticated = true;

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  info.branch = branch.ok ? branch.stdout.trim() : null;

  if (info.owner && info.repo) {
    const repo = run("gh", ["repo", "view", `${info.owner}/${info.repo}`, "--json", "nameWithOwner,visibility,isPrivate,defaultBranchRef,hasIssuesEnabled"]);
    if (!repo.ok) {
      add(
        "error",
        "repo-missing",
        `Cannot read ${info.owner}/${info.repo}.`,
        "It may not exist yet. Ask the user whether to create it; do not default to public visibility.",
      );
    } else {
      try {
        info.repoMetadata = JSON.parse(repo.stdout);
        if (info.repoMetadata.visibility === "PUBLIC") {
          add("review", "public-repo", "Destination repository is PUBLIC.", "Confirm the user authorized publishing this content publicly.");
        }
      } catch {
        add("warn", "repo-unparsed", "Could not parse `gh repo view` output.");
      }
    }
  }

  // Divergence against the remote-tracking branch.
  const upstream = run("git", ["rev-parse", "--abbrev-ref", `${remote}/${info.branch}`]);
  if (upstream.ok) {
    const counts = run("git", ["rev-list", "--left-right", "--count", `${remote}/${info.branch}...HEAD`]);
    if (counts.ok) {
      const [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
      info.ahead = ahead;
      info.behind = behind;
      if (behind > 0) {
        add("error", "diverged", `Local branch is ${behind} commit(s) behind ${remote}/${info.branch} and ${ahead} ahead.`, "Reconcile before pushing; do not force-push shared history without explicit authorization.");
      } else if (ahead > 0) {
        add("info", "ahead", `${ahead} commit(s) would be pushed to ${remote}/${info.branch}.`);
      } else {
        add("info", "up-to-date", `No commits to push to ${remote}/${info.branch}.`);
      }
    }
    // Secret scan of exactly the commits that would leave the machine.
    const diff = run("git", ["diff", "--unified=0", `${remote}/${info.branch}...HEAD`]);
    if (diff.ok && diff.stdout.length < 4 * 1024 * 1024) {
      const added = diff.stdout
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .join("\n");
      const hits = scanText(added).filter((f) => f.severity === "high");
      for (const hit of hits) {
        add("error", `outgoing-secret:${hit.id}`, `Outgoing commit content matches ${hit.description} (${hit.preview}).`, "Do not push. Remove the value, rotate the credential, and rewrite the affected commits.");
      }
    }
  } else {
    add("info", "no-upstream", `No ${remote}/${info.branch} tracking branch; the first push creates it.`);
  }

  if (info.owner && info.repo) {
    const workflows = run("gh", ["workflow", "list", "--repo", `${info.owner}/${info.repo}`, "--json", "name,state,path"]);
    if (workflows.ok) {
      try {
        const list = JSON.parse(workflows.stdout);
        info.workflows = list;
        if (list.length === 0) {
          add(
            "review",
            "no-ci-workflows",
            "No GitHub Actions workflows are defined.",
            "A workflow file is not evidence CI works; decide with the user whether basic automated tests are warranted.",
          );
        } else {
          const inactive = list.filter((w) => w.state !== "active").map((w) => w.name);
          if (inactive.length > 0) add("warn", "ci-inactive", `Inactive workflow(s): ${inactive.join(", ")}.`);
          const runs = run("gh", ["run", "list", "--repo", `${info.owner}/${info.repo}`, "--limit", "5", "--json", "workflowName,status,conclusion,headBranch"]);
          if (runs.ok) {
            try {
              info.recentRuns = JSON.parse(runs.stdout);
              const failing = info.recentRuns.filter((r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion));
              if (failing.length > 0) {
                add("error", "ci-failing", `Recent failing runs: ${failing.map((r) => `${r.workflowName}(${r.conclusion})`).join(", ")}.`, "Fix or explain the failures before publishing.");
              }
            } catch {
              add("warn", "ci-runs-unparsed", "Could not parse recent workflow runs.");
            }
          }
        }
      } catch {
        add("warn", "ci-unparsed", "Could not parse `gh workflow list` output.");
      }
    }
  }

  const blocking = findings.filter((f) => f.level === "error").length;
  return { ok: blocking === 0, findings, info, published: false };
}

export function formatFindings(findings) {
  const order = { error: 0, warn: 1, review: 2, info: 3 };
  return [...findings]
    .sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9))
    .map((f) => `${f.level.toUpperCase().padEnd(6)} [${f.code}] ${f.message}${f.action ? `\n         → ${f.action}` : ""}`)
    .join("\n");
}

export function summarize(findings) {
  return findings.reduce(
    (acc, f) => {
      acc[f.level] = (acc[f.level] ?? 0) + 1;
      return acc;
    },
    { error: 0, warn: 0, review: 0, info: 0 },
  );
}
