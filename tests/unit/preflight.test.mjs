import assert from "node:assert/strict";
import test from "node:test";

import { parseStatus, gitPreflight, githubPreflight, summarize, formatFindings } from "../../core/preflight.mjs";

const fake = (...parts) => parts.join("");

/**
 * Build a runner from a map of "cmd arg1 arg2" -> { ok, stdout, stderr }.
 * Anything unmapped succeeds with empty output, so a test only encodes the
 * responses that matter to the behaviour under test.
 */
function runnerFrom(responses, { defaultOk = true } = {}) {
  const calls = [];
  const run = (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    calls.push(key);
    if (key in responses) {
      const value = responses[key];
      return typeof value === "string" ? { ok: true, stdout: value, stderr: "" } : value;
    }
    return defaultOk ? { ok: true, stdout: "", stderr: "" } : { ok: false, stdout: "", stderr: `unexpected: ${key}` };
  };
  run.calls = calls;
  return run;
}

test("parseStatus splits staged, unstaged, and untracked entries", () => {
  const z = ["M  src/a.ts", " M src/b.ts", "MM src/c.ts", "?? notes.txt", "A  src/d.ts", "D  src/e.ts"].join("\0") + "\0";
  const parsed = parseStatus(z);
  assert.deepEqual(parsed.staged.map((s) => s.file).sort(), ["src/a.ts", "src/c.ts", "src/d.ts", "src/e.ts"]);
  assert.deepEqual(parsed.unstaged.map((s) => s.file).sort(), ["src/b.ts", "src/c.ts"]);
  assert.deepEqual(parsed.untracked, ["notes.txt"]);
});

test("gitPreflight refuses to proceed outside a repository", () => {
  const run = runnerFrom({ "git rev-parse --is-inside-work-tree": { ok: false, stdout: "", stderr: "not a repo" } });
  const result = gitPreflight({ root: "/tmp", run });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].code, "not-a-repo");
});

test("gitPreflight never invents an identity and explains the global-only case", () => {
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "git config --local user.name": { ok: false, stdout: "", stderr: "" },
    "git config --local user.email": { ok: false, stdout: "", stderr: "" },
    "git config --global user.name": "Someone\n",
    "git config --global user.email": "someone@example.invalid\n",
  });
  const result = gitPreflight({ root: "/repo", run });
  const identity = result.findings.find((f) => f.code === "global-only-identity");
  assert.ok(identity);
  assert.equal(identity.level, "review");
  assert.match(identity.message, /someone@example\.invalid/);
  assert.match(identity.action, /--local/);
});

test("gitPreflight reports a missing identity as an error with a confirmation instruction", () => {
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    "git config --local user.name": { ok: false, stdout: "", stderr: "" },
    "git config --global user.name": { ok: false, stdout: "", stderr: "" },
  });
  const result = gitPreflight({ root: "/repo", run });
  const finding = result.findings.find((f) => f.code === "no-identity");
  assert.equal(finding.level, "error");
  assert.match(finding.action, /never invents an identity/i);
});

test("gitPreflight blocks a committed-mode run with nothing staged", () => {
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "git status --porcelain=v1 -z": "",
    "git rev-parse --verify HEAD": "abc123\n",
  });
  const result = gitPreflight({ root: "/repo", run, commitCheck: true });
  assert.ok(result.findings.some((f) => f.code === "nothing-staged" && f.level === "error"));
  assert.equal(result.ok, false);
});

test("gitPreflight blocks on a staged credential file and on credential content in the index", () => {
  const secretFile = ".env.production";
  const content = fake("AWS_ACCESS_KEY_ID=AKIA", "IOSFODNN7EXAMPLE");
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    "git rev-parse --abbrev-ref HEAD": "feature\n",
    "git status --porcelain=v1 -z": `A  ${secretFile}\0M  src/config.ts\0`,
    [`git show :${secretFile}`]: "PLACEHOLDER=1\n",
    "git show :src/config.ts": `export const key = "${content}";\n`,
    "git rev-parse --verify HEAD": "abc\n",
    "git ls-files .gitignore": ".gitignore\n",
  });
  const result = gitPreflight({ root: "/repo", run });
  assert.ok(result.findings.some((f) => f.code === "staged-secret-file" && f.level === "error"));
  const contentFinding = result.findings.find((f) => f.code.startsWith("secret:"));
  assert.equal(contentFinding.level, "error");
  assert.match(contentFinding.message, /src\/config\.ts:1/);
  assert.equal(result.ok, false);
});

test("gitPreflight flags an untracked credential file", () => {
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "git status --porcelain=v1 -z": "?? .env\0?? src/a.ts\0",
  });
  const result = gitPreflight({ root: "/repo", run });
  assert.ok(result.findings.some((f) => f.code === "untracked-secret-file"));
});

test("gitPreflight warns about staged build artifacts and a missing .gitignore", () => {
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "git status --porcelain=v1 -z": "A  dist/bundle.js\0A  node_modules/left-pad/index.js\0",
    "git show :dist/bundle.js": "console.log(1);\n",
    "git show :node_modules/left-pad/index.js": "module.exports = 1;\n",
    "git ls-files .gitignore": "",
  });
  const result = gitPreflight({ root: "/repo", run });
  assert.equal(result.findings.filter((f) => f.code === "staged-artifact").length, 2);
  assert.ok(result.findings.some((f) => f.code === "no-gitignore"));
});

test("gitPreflight errors on a detached HEAD", () => {
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    "git rev-parse --abbrev-ref HEAD": "HEAD\n",
  });
  const result = gitPreflight({ root: "/repo", run });
  assert.ok(result.findings.some((f) => f.code === "detached-head" && f.level === "error"));
});

test("githubPreflight stops early with guidance when there is no remote", () => {
  const run = runnerFrom({ "git remote get-url origin": { ok: false, stdout: "", stderr: "no such remote" } });
  const result = githubPreflight({ root: "/repo", run });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].code, "no-remote");
  assert.equal(result.published, false);
});

test("githubPreflight degrades gracefully when the GitHub CLI is missing", () => {
  const run = runnerFrom({
    "git remote get-url origin": "git@github.com:acme/widget.git\n",
    "gh --version": { ok: false, missing: true, stdout: "", stderr: "gh is not installed" },
  });
  const result = githubPreflight({ root: "/repo", run });
  assert.equal(result.degraded, true);
  assert.equal(result.ok, true);
  assert.ok(result.findings.some((f) => f.code === "gh-missing"));
});

test("githubPreflight refuses to continue when gh is not authenticated", () => {
  const run = runnerFrom({
    "git remote get-url origin": "https://github.com/acme/widget.git\n",
    "gh --version": "gh version 2.45.0\n",
    "gh auth status": { ok: false, stdout: "", stderr: "not logged in" },
  });
  const result = githubPreflight({ root: "/repo", run });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].code, "gh-unauthenticated");
});

test("githubPreflight blocks a diverged branch and asks for authorization", () => {
  const run = runnerFrom({
    "git remote get-url origin": "https://github.com/acme/widget.git\n",
    "gh --version": "gh version 2.45.0\n",
    "gh auth status": "logged in\n",
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "gh repo view acme/widget --json nameWithOwner,visibility,isPrivate,defaultBranchRef,hasIssuesEnabled":
      '{"nameWithOwner":"acme/widget","visibility":"PRIVATE","isPrivate":true}\n',
    "git rev-parse --abbrev-ref origin/main": "origin/main\n",
    "git rev-list --left-right --count origin/main...HEAD": "3\t2\n",
    "git diff --unified=0 origin/main...HEAD": "",
    "gh workflow list --repo acme/widget --json name,state,path": '[{"name":"ci","state":"active","path":".github/workflows/ci.yml"}]\n',
    "gh run list --repo acme/widget --limit 5 --json workflowName,status,conclusion,headBranch": "[]\n",
  });
  const result = githubPreflight({ root: "/repo", run });
  assert.equal(result.info.ahead, 2);
  assert.equal(result.info.behind, 3);
  const finding = result.findings.find((f) => f.code === "diverged");
  assert.equal(finding.level, "error");
  assert.match(finding.action, /force-push/i);
});

test("githubPreflight blocks when outgoing commits contain a credential", () => {
  const run = runnerFrom({
    "git remote get-url origin": "https://github.com/acme/widget.git\n",
    "gh --version": "gh version 2.45.0\n",
    "gh auth status": "logged in\n",
    "git rev-parse --abbrev-ref HEAD": "feature\n",
    "gh repo view acme/widget --json nameWithOwner,visibility,isPrivate,defaultBranchRef,hasIssuesEnabled":
      '{"nameWithOwner":"acme/widget","visibility":"PUBLIC","isPrivate":false}\n',
    "git rev-parse --abbrev-ref origin/feature": "origin/feature\n",
    "git rev-list --left-right --count origin/feature...HEAD": "0\t1\n",
    "git diff --unified=0 origin/feature...HEAD": `+const token = "${fake("ghp_", "c".repeat(36))}";\n`,
    "gh workflow list --repo acme/widget --json name,state,path": "[]\n",
  });
  const result = githubPreflight({ root: "/repo", run });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === "outgoing-secret:github-token"));
  assert.ok(result.findings.some((f) => f.code === "public-repo" && f.level === "review"));
  assert.ok(result.findings.some((f) => f.code === "no-ci-workflows"));
});

test("githubPreflight reports failing CI runs as blocking, not incidental", () => {
  const run = runnerFrom({
    "git remote get-url origin": "https://github.com/acme/widget.git\n",
    "gh --version": "gh version 2.45.0\n",
    "gh auth status": "logged in\n",
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "gh workflow list --repo acme/widget --json name,state,path": '[{"name":"ci","state":"active","path":"x"}]\n',
    "gh run list --repo acme/widget --limit 5 --json workflowName,status,conclusion,headBranch":
      '[{"workflowName":"ci","conclusion":"failure"}]\n',
    "git rev-parse --abbrev-ref origin/main": { ok: false, stdout: "", stderr: "" },
  });
  const result = githubPreflight({ root: "/repo", run });
  assert.ok(result.findings.some((f) => f.code === "ci-failing" && f.level === "error"));
});

test("never reports success for a command that was not run", () => {
  const run = runnerFrom({
    "git remote get-url origin": "https://github.com/acme/widget.git\n",
    "gh --version": "gh version 2.45.0\n",
    "gh auth status": "logged in\n",
    "git rev-parse --abbrev-ref HEAD": "main\n",
    "gh repo view acme/widget --json nameWithOwner,visibility,isPrivate,defaultBranchRef,hasIssuesEnabled": {
      ok: false,
      stdout: "",
      stderr: "not found",
    },
    "git rev-parse --abbrev-ref origin/main": { ok: false, stdout: "", stderr: "" },
    "gh workflow list --repo acme/widget --json name,state,path": { ok: false, stdout: "", stderr: "" },
  });
  const result = githubPreflight({ root: "/repo", run });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === "repo-missing"));
  assert.ok(result.findings.some((f) => f.code === "no-upstream"));
  assert.equal(result.published, false);
});

test("summarize and formatFindings order findings by severity", () => {
  const findings = [
    { level: "info", code: "i", message: "info" },
    { level: "error", code: "e", message: "error", action: "do it" },
    { level: "warn", code: "w", message: "warn" },
  ];
  assert.deepEqual(summarize(findings), { error: 1, warn: 1, review: 0, info: 1 });
  const text = formatFindings(findings);
  assert.ok(text.indexOf("ERROR") < text.indexOf("WARN"));
  assert.ok(text.indexOf("WARN") < text.indexOf("INFO"));
  assert.match(text, /→ do it/);
});

test("gitPreflight names the branch of a repository that has no commits yet", () => {
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    // `rev-parse --abbrev-ref HEAD` fails on an unborn branch; the symbolic ref still works.
    "git rev-parse --abbrev-ref HEAD": { ok: false, stdout: "", stderr: "fatal: ambiguous argument 'HEAD'" },
    "git symbolic-ref --short HEAD": "main\n",
    "git rev-parse --verify HEAD": { ok: false, stdout: "", stderr: "unknown revision" },
  });
  const result = gitPreflight({ root: "/repo", run });
  assert.equal(result.info.branch, "main");
  assert.equal(Boolean(result.info.head), false, "no commit exists yet, so there is no HEAD sha");
  assert.ok(result.findings.some((f) => f.code === "no-commits"));
  assert.equal(result.findings.some((f) => f.code === "detached-head"), false);
});

test("gitPreflight still reports a detached HEAD when there is no symbolic ref", () => {
  const run = runnerFrom({
    "git rev-parse --is-inside-work-tree": "true\n",
    "git rev-parse --abbrev-ref HEAD": "HEAD\n",
    "git symbolic-ref --short HEAD": { ok: false, stdout: "", stderr: "fatal: ref HEAD is not a symbolic ref" },
  });
  const result = gitPreflight({ root: "/repo", run });
  assert.ok(result.findings.some((f) => f.code === "detached-head" && f.level === "error"));
});
