import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { planInstall, planSkillTargets, skillCandidates, discoverSourceSkills, discoverSourceCommands } from "../../core/emit.mjs";
import { detectAgents, resolvePaths, AGENT_IDS } from "../../core/agents.mjs";
import { buildIndex } from "../../core/index.mjs";
import { assessRisk, suggestMode, policyFor, modePreamble, MODES } from "../../core/mode.mjs";
import { tmpdir, writeTree, cleanupAll, FRAMEWORK_ROOT } from "../helpers.mjs";

test.after(cleanupAll);

// Path fixtures for resolvePaths are built with path.resolve/path.join rather than
// hard-coded POSIX strings, so the expectations carry the same separators (and, for
// the project root, the same drive letter) that core/agents.mjs produces on Windows.
const PROJECT_ROOT = path.resolve("/repo");
const HOME_ROOT = "/home/u";

test("every agent resolves a coherent path set", () => {
  for (const id of AGENT_IDS) {
    // `env: {}` keeps the assertion independent of the runner: XDG_CONFIG_HOME,
    // CLAUDE_CONFIG_DIR, CODEX_HOME, and OPENCODE_CONFIG_DIR legitimately relocate
    // these roots, and GitHub runners set XDG_CONFIG_HOME.
    const paths = resolvePaths(id, { projectRoot: PROJECT_ROOT, home: HOME_ROOT, env: {} });
    assert.equal(paths.id, id);
    assert.ok(paths.skillsUser.startsWith(path.join(HOME_ROOT)), `${id} user skills root`);
    assert.ok(paths.skillsProject.startsWith(PROJECT_ROOT), `${id} project skills root`);
    assert.ok(paths.contextUser === null || paths.contextUser.startsWith(path.join(HOME_ROOT)), `${id} user context`);
    assert.ok(Array.isArray(paths.notes));
  }
});

test("Codex has no project command directory, and that is reported rather than invented", () => {
  const paths = resolvePaths("codex", { projectRoot: "/repo" });
  assert.equal(paths.commandsProject, null);
  assert.ok(paths.commandsUser.endsWith(path.join(".codex", "prompts")));
});

test("agent detection reports absence without throwing", () => {
  const agents = detectAgents({ projectRoot: "/definitely/not/here", home: "/definitely/not/here", env: { PATH: "" } });
  assert.equal(agents.length, AGENT_IDS.length);
  assert.ok(agents.every((a) => a.installed === false));
  assert.ok(agents.every((a) => a.signal === "absent"));
});

test("set cover picks two shared skill roots for all four agents", () => {
  const cands = skillCandidates({
    scope: "project",
    projectRoot: PROJECT_ROOT,
    home: HOME_ROOT,
    pathsById: Object.fromEntries(AGENT_IDS.map((id) => [id, resolvePaths(id, { projectRoot: PROJECT_ROOT, home: HOME_ROOT })])),
  });
  const targets = planSkillTargets({ selectedAgents: ["claude", "codex", "opencode", "omp"], candidates: cands });
  const dirs = targets.map((t) => path.relative(PROJECT_ROOT, t.dir));
  assert.deepEqual(dirs.sort(), [path.join(".agents", "skills"), path.join(".claude", "skills")].sort());
  const covered = new Set(targets.flatMap((t) => t.covers));
  assert.equal(covered.size, 4);
});

test("set cover never proposes a location that serves no selected agent", () => {
  const pathsById = Object.fromEntries(AGENT_IDS.map((id) => [id, resolvePaths(id, { projectRoot: PROJECT_ROOT, home: HOME_ROOT })]));
  const cands = skillCandidates({ scope: "project", projectRoot: PROJECT_ROOT, home: HOME_ROOT, pathsById });
  const targets = planSkillTargets({ selectedAgents: ["omp"], candidates: cands });
  assert.equal(targets.length, 1);
  assert.equal(path.relative(PROJECT_ROOT, targets[0].dir), path.join(".claude", "skills"));
  assert.ok(targets[0].covers.includes("omp"));
});

test("user-scope set cover uses the shared home roots", () => {
  const pathsById = Object.fromEntries(AGENT_IDS.map((id) => [id, resolvePaths(id, { projectRoot: PROJECT_ROOT, home: HOME_ROOT })]));
  const cands = skillCandidates({ scope: "user", projectRoot: PROJECT_ROOT, home: HOME_ROOT, pathsById });
  const targets = planSkillTargets({ selectedAgents: ["claude", "codex", "opencode", "omp"], candidates: cands });
  const dirs = targets.map((t) => t.dir).sort();
  // The two shared roots are exactly the Codex and Claude user skill directories.
  assert.deepEqual(
    dirs,
    [pathsById.codex.skillsUser, pathsById.claude.skillsUser].sort(),
  );
});

test("the framework's own skills and commands all validate", () => {
  const skills = discoverSourceSkills(FRAMEWORK_ROOT);
  assert.ok(skills.length >= 10, `expected a substantive skill set, found ${skills.length}`);
  for (const skill of skills) {
    assert.equal(skill.ok, true, `${skill.name}: ${skill.errors.join("; ")}`);
  }
  const names = skills.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, "skill names must be globally unique once flattened");

  const commands = discoverSourceCommands(FRAMEWORK_ROOT);
  assert.ok(commands.length >= 8);
  for (const command of commands) {
    assert.ok(command.description && command.description.length > 0, `${command.name} needs a description`);
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(command.name), `command name ${command.name} must be portable`);
    // The agents parse this frontmatter with strict YAML; an ambiguous value would
    // be dropped silently at runtime, which is how the original bug escaped.
    assert.deepEqual(command.frontmatterIssues, [], `${command.name}: ${command.frontmatterIssues?.join("; ")}`);
  }
});

test("discoverSourceCommands flattens nested directories into portable names", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, "commands", "group"), { recursive: true });
  fs.writeFileSync(path.join(dir, "commands", "top.md"), "---\ndescription: Top level\n---\nbody\n");
  fs.writeFileSync(path.join(dir, "commands", "group", "inner.md"), "---\ndescription: Nested\n---\nbody\n");
  const commands = discoverSourceCommands(dir).map((c) => c.name).sort();
  assert.deepEqual(commands, ["group-inner", "top"]);
});

test("planInstall is pure: it produces actions without touching disk", async () => {
  const projectRoot = tmpdir();
  const home = tmpdir();
  const plan = await planInstall({
    frameworkRoot: FRAMEWORK_ROOT,
    projectRoot,
    home,
    env: { PATH: "" },
    scope: "project",
    agents: ["claude", "omp"],
  });
  assert.ok(plan.actions.length > 0);
  assert.deepEqual(fs.readdirSync(projectRoot), [], "planning must not create files");
  const types = new Set(plan.actions.map((a) => a.type));
  assert.ok(types.has("copy"));
  assert.ok(types.has("block"));
});

test("planInstall reports Codex project-scope commands as unsupported instead of writing them", async () => {
  const projectRoot = tmpdir();
  const plan = await planInstall({
    frameworkRoot: FRAMEWORK_ROOT,
    projectRoot,
    home: tmpdir(),
    env: { PATH: "" },
    scope: "project",
    agents: ["codex"],
  });
  const commandActions = plan.actions.filter((a) => a.kind === "command");
  assert.deepEqual(commandActions, []);
  assert.ok(plan.warnings.some((w) => /codex: project-scope commands are unsupported/.test(w)));
});

test("planInstall writes the context block into CLAUDE.md when Claude is selected and CLAUDE.md exists", async () => {
  const projectRoot = tmpdir();
  writeTree(projectRoot, { "CLAUDE.md": "# existing\n" });
  const plan = await planInstall({
    frameworkRoot: FRAMEWORK_ROOT,
    projectRoot,
    home: tmpdir(),
    env: { PATH: "" },
    scope: "project",
    agents: ["claude"],
  });
  // Claude is the only selected agent and a CLAUDE.md already exists, so writing
  // AGENTS.md as well would add a second, unread copy for no benefit.
  const blocks = plan.actions.filter((a) => a.type === "block").map((a) => a.target);
  assert.deepEqual(blocks, [path.join(projectRoot, "CLAUDE.md")]);
});

test("planInstall substitutes the operating mode into the context block", async () => {
  const projectRoot = tmpdir();
  const plan = await planInstall({
    frameworkRoot: FRAMEWORK_ROOT,
    projectRoot,
    home: tmpdir(),
    env: { PATH: "" },
    scope: "project",
    agents: ["omp"],
    mode: "ultra",
  });
  const block = plan.actions.find((a) => a.type === "block");
  assert.match(block.body, /\*\*ultra\*\*/);
  assert.doesNotMatch(block.body, /\{\{mode\}\}/);
});

test("planInstall rejects an unknown agent id", async () => {
  await assert.rejects(
    () =>
      planInstall({
        frameworkRoot: FRAMEWORK_ROOT,
        projectRoot: tmpdir(),
        home: tmpdir(),
        env: { PATH: "" },
        scope: "project",
        agents: ["nope"],
      }),
    /unknown agent id/,
  );
});

test("modes expose complete, distinct policies", () => {
  const policies = MODES.map(policyFor);
  assert.equal(policies.length, 3);
  assert.equal(new Set(policies.map((p) => p.contextBudgetTokens)).size, 3);
  assert.equal(policies[0].requirePlan, false);
  assert.equal(policies[2].requirePlan, true);
  assert.equal(policies[2].dependencyAudit, true);
  assert.equal(policyFor("nonsense").name, "full", "an unknown mode falls back to full");
});

test("mode preamble stays small enough to ship on every request", () => {
  for (const mode of MODES) {
    const preamble = modePreamble(mode, { projectName: "example" });
    assert.ok(preamble.length < 1200, `${mode} preamble is ${preamble.length} chars`);
    assert.match(preamble, /Never print, commit, or copy credentials/);
  }
});

test("risk assessment raises depth for auth, migrations, CI, and infrastructure changes", () => {
  const low = assessRisk(["src/components/button.tsx", "tests/button.test.tsx"]);
  assert.equal(low.level, "low");

  const high = assessRisk([
    "src/auth/login.ts",
    "src/payments/checkout.ts",
    "db/migrations/0007_add_index.sql",
    "package.json",
    ".github/workflows/deploy.yml",
    "infra/main.tf",
  ]);
  assert.equal(high.level, "high");
  assert.ok(high.score >= 6);
  assert.ok(high.reasons.includes("auth or permission code"));
  assert.ok(high.reasons.includes("data migration"));
});

test("risk assessment lowers for test-only changes and flags a missing test setup", () => {
  const index = buildIndex(tmpdir()).index;
  const risk = assessRisk(["src/a.ts", "tests/a.test.ts"], index);
  assert.ok(risk.reasons.includes("no test tooling detected"));
});

test("a tiny low-risk change suggests lite; high risk suggests ultra; explicit selection wins", () => {
  const low = assessRisk(["src/a.ts"]);
  assert.equal(suggestMode({ risk: low, fileCount: 1 }).mode, "lite");
  const high = assessRisk(["src/auth/token.ts", "db/migrations/m.sql", "package.json"]);
  assert.equal(suggestMode({ risk: high, fileCount: 3 }).mode, "ultra");
  assert.equal(suggestMode({ requested: "lite", risk: high, fileCount: 99 }).mode, "lite");
});

test("installing into a sandbox home never writes outside the sandbox", async () => {
  const projectRoot = tmpdir();
  const home = tmpdir();
  const before = os.homedir();
  const plan = await planInstall({
    frameworkRoot: FRAMEWORK_ROOT,
    projectRoot,
    home,
    env: { PATH: "", HOME: home },
    scope: "project",
    agents: AGENT_IDS,
  });
  for (const action of plan.actions) {
    assert.ok(
      action.target.startsWith(projectRoot) || action.target.startsWith(home),
      `${action.target} escapes the sandbox (real home is ${before})`,
    );
  }
});

test("documented environment overrides relocate the user roots", () => {
  // An override is returned as given (it is an absolute path, so nothing is joined
  // onto the home directory) except XDG_CONFIG_HOME, which is a base directory that
  // OpenCode's own subdirectory is joined onto.
  const cases = [
    { id: "claude", env: { CLAUDE_CONFIG_DIR: "/cl" }, root: "/cl" },
    { id: "opencode", env: { XDG_CONFIG_HOME: "/xdg" }, root: path.join("/xdg", "opencode") },
    { id: "opencode", env: { OPENCODE_CONFIG_DIR: "/oc" }, root: "/oc" },
    { id: "omp", env: { PI_CODING_AGENT_DIR: "/omp" }, root: "/omp" },
    // Codex is the exception on purpose: CODEX_HOME holds config, auth, and prompts,
    // while its documented user skill location is $HOME/.agents/skills.
    { id: "codex", env: { CODEX_HOME: "/cx" }, root: "/cx", skills: path.join(HOME_ROOT, ".agents", "skills") },
  ];
  for (const { id, env, root, skills = path.join(root, "skills") } of cases) {
    const paths = resolvePaths(id, { projectRoot: PROJECT_ROOT, home: HOME_ROOT, env });
    assert.equal(paths.userRoot, root, `${id} userRoot`);
    assert.equal(paths.skillsUser, skills, `${id} skillsUser`);
    if (id === "codex") assert.equal(paths.commandsUser, path.join(root, "prompts"), "codex commandsUser");
  }
});

test("a named profile selects its own agent directory and env wins over home", () => {
  const profiled = resolvePaths("omp", { projectRoot: PROJECT_ROOT, home: HOME_ROOT, env: { OMP_PROFILE: "work" } });
  assert.equal(profiled.userRoot, path.join(HOME_ROOT, ".omp", "profiles", "work", "agent"));

  // An explicit agent dir is stronger than a profile, matching the documented order.
  // The override is used verbatim, so the expectation is the literal, not a join.
  const explicit = resolvePaths("omp", {
    projectRoot: PROJECT_ROOT,
    home: HOME_ROOT,
    env: { OMP_PROFILE: "work", PI_CODING_AGENT_DIR: "/custom" },
  });
  assert.equal(explicit.userRoot, "/custom");
});
