// Installation planner and executor.
//
// The planner is pure: it returns the complete list of mutations before anything
// touches disk, which is what makes `--dry-run` an honest preview and what makes
// the plan testable without a filesystem side effect.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AGENTS,
  AGENT_IDS,
  SHARED_LOCATIONS,
  claudeConfigDir,
  resolvePaths,
} from "./agents.mjs";
import { frontmatterIssues, loadSkill, parseFrontmatter } from "./skills.mjs";
import { addEntry, fileHash, renderBlock, upsertBlock } from "./manifest.mjs";
import { DEFAULT_MODE, MODES, policyFor } from "./mode.mjs";
import { atomicWrite, exists, isDirectory, isFile, listImmediateDirs, readTextOrNull, sha256, toPosix } from "./util.mjs";

/** Locations that serve more than one agent, in preference order. */
export const SKILL_LOCATIONS = [
  {
    rel: SHARED_LOCATIONS.claudeSkillsDir.project,
    covers: ["claude", "opencode", "omp"],
    note: "OpenCode and Oh My Pi both read `.claude/skills`.",
  },
  {
    rel: SHARED_LOCATIONS.agentsSkillsDir.project,
    covers: ["codex", "opencode", "omp"],
    note: "Codex, OpenCode, and Oh My Pi all read `.agents/skills`.",
  },
  { rel: ".omp/skills", covers: ["omp"], note: "Oh My Pi native project skills (highest precedence)." },
  { rel: ".opencode/skills", covers: ["opencode"], note: "OpenCode-native project skills." },
];

const USER_SKILL_LOCATIONS = [
  { covers: ["claude"], key: "skillsUser", scope: "user" },
  { covers: ["codex"], key: "skillsUser", scope: "user" },
  { covers: ["opencode"], key: "skillsUser", scope: "user" },
  { covers: ["omp"], key: "skillsUser", scope: "user" },
];

/**
 * Discover authoring skills under `<frameworkRoot>/skills/<category>/<name>/SKILL.md`
 * (and `<frameworkRoot>/skills/<name>/SKILL.md`).
 */
export function discoverSourceSkills(frameworkRoot) {
  const skillsRoot = path.join(frameworkRoot, "skills");
  const found = [];
  for (const entry of listImmediateDirs(skillsRoot)) {
    const dir = path.join(skillsRoot, entry);
    if (isFile(path.join(dir, "SKILL.md"))) {
      found.push({ ...loadSkill(dir, { source: "framework" }), category: "general" });
      continue;
    }
    for (const nested of listImmediateDirs(dir)) {
      const skillDir = path.join(dir, nested);
      if (!isFile(path.join(skillDir, "SKILL.md"))) continue;
      found.push({ ...loadSkill(skillDir, { source: "framework" }), category: entry });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Discover authoring commands under `<frameworkRoot>/commands/**\/*.md`. */
export function discoverSourceCommands(frameworkRoot) {
  const root = path.join(frameworkRoot, "commands");
  const commands = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, prefix === "" ? entry.name : `${prefix}/${entry.name}`);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const raw = readTextOrNull(abs) ?? "";
        const { data, body, hasFrontmatter, raw: frontmatterRaw } = parseFrontmatter(raw);
        const base = entry.name.replace(/\.md$/, "");
        commands.push({
          name: prefix === "" ? base : `${prefix}-${base}`,
          file: abs,
          rel: toPosix(path.relative(root, abs)),
          description: data.description ?? firstLine(body),
          argumentHint: data["argument-hint"] ?? data.argumentHint ?? null,
          frontmatter: data,
          frontmatterIssues: hasFrontmatter ? frontmatterIssues(frontmatterRaw) : ["no YAML frontmatter"],
          body,
          raw,
        });
      }
    }
  };
  walk(root, "");
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

function firstLine(body) {
  const line = body.split("\n").find((l) => l.trim() !== "" && !l.startsWith("#"));
  return (line ?? "").trim().slice(0, 120);
}

/** Greedy set cover over candidate skill locations, shared by both scopes. */
export function planSkillTargets({ selectedAgents, candidates }) {
  const remaining = new Set(selectedAgents);
  const targets = [];
  const rank = (c) => [c.covers.filter((a) => remaining.has(a)).length, c.covers.length];
  while (remaining.size > 0) {
    const best = candidates
      .filter((c) => c.covers.some((a) => remaining.has(a)))
      .sort((a, b) => {
        const [a1, a2] = rank(a);
        const [b1, b2] = rank(b);
        return b1 - a1 || b2 - a2;
      })[0];
    if (!best) break;
    const covered = best.covers.filter((a) => remaining.has(a));
    for (const agent of covered) remaining.delete(agent);
    targets.push({ agent: covered[0], dir: best.dir, covers: covered, note: best.note });
  }
  return targets;
}

/** Candidate skill directories for a scope, richest coverage first. */
export function skillCandidates({ scope, pathsById, projectRoot, home = os.homedir() }) {
  if (scope === "user") {
    return [
      { dir: path.join(home, ".agents", "skills"), covers: ["codex", "opencode", "omp"], note: "shared user skills root (Codex, OpenCode, Oh My Pi)" },
      { dir: path.join(claudeConfigDir({ home }), "skills"), covers: ["claude", "opencode"], note: "Claude Code user skills; OpenCode also reads this directory" },
      { dir: pathsById.omp?.skillsUser, covers: ["omp"], note: "Oh My Pi native user skills" },
      { dir: pathsById.opencode?.skillsUser, covers: ["opencode"], note: "OpenCode native user skills" },
    ].filter((c) => c.dir);
  }
  return [
    ...SKILL_LOCATIONS.map((l) => ({ dir: path.resolve(projectRoot, l.rel), covers: l.covers, note: l.note })),
    { dir: pathsById.omp?.skillsProject, covers: ["omp"], note: "Oh My Pi native project skills" },
    { dir: pathsById.opencode?.skillsProject, covers: ["opencode"], note: "OpenCode native project skills" },
  ].filter((c) => c.dir);
}

/**
 * Build the full install plan. No filesystem writes happen here.
 *
 * @param {object} options
 * @param {string} options.frameworkRoot
 * @param {string} options.projectRoot
 * @param {"project"|"user"} options.scope
 * @param {string[]} options.agents
 * @param {boolean} options.withCommands
 * @param {boolean} options.withHooks
 * @param {boolean} options.withContext
 * @param {boolean} options.link
 * @param {string|null} options.mode
 */
export async function planInstall(options) {
  const {
    frameworkRoot,
    projectRoot,
    scope,
    agents,
    withCommands = true,
    withHooks = true,
    withContext = true,
    link = false,
    mode = null,
    home,
    env,
  } = options;

  const unknown = agents.filter((a) => !AGENT_IDS.includes(a));
  if (unknown.length > 0) throw new Error(`unknown agent id(s): ${unknown.join(", ")}`);

  const pathsById = Object.fromEntries(agents.map((id) => [id, resolvePaths(id, { projectRoot, home, env })]));

  const actions = [];
  const warnings = [];

  // --- vendored runtime -----------------------------------------------------
  // Commands and hooks must work without a global install, so `install` copies the
  // core CLI into `.uaf/framework/`. Only the runtime is vendored: re-running
  // `install`/`uninstall`/`update` is done from a framework checkout.
  if (scope === "project") {
    const coreDir = path.join(frameworkRoot, "core");
    if (isDirectory(coreDir)) {
      const dest = path.resolve(projectRoot, ".uaf/framework/core");
      actions.push({
        type: "copy",
        agent: "shared",
        source: coreDir,
        target: dest,
        kind: "runtime",
        description: `runtime → ${toPosix(path.relative(projectRoot, dest))} (lets commands run without a global install)`,
      });
      actions.push({
        type: "copy",
        agent: "shared",
        source: path.join(frameworkRoot, "package.json"),
        target: path.resolve(projectRoot, ".uaf/framework/package.json"),
        kind: "runtime",
        description: "runtime manifest → .uaf/framework/package.json",
      });
      const templatesDir = path.join(frameworkRoot, "templates");
      if (isDirectory(templatesDir)) {
        actions.push({
          type: "copy",
          agent: "shared",
          source: templatesDir,
          target: path.resolve(projectRoot, ".uaf/framework/templates"),
          kind: "runtime",
          description: "templates → .uaf/framework/templates",
        });
      }
    } else {
      warnings.push("core/ not found; no runtime was vendored and the workflow commands will not run");
    }
    const gitignoreTemplate = path.join(frameworkRoot, "templates", "uaf-gitignore");
    if (isFile(gitignoreTemplate)) {
      actions.push({
        type: "write-if-absent",
        agent: "shared",
        target: path.resolve(projectRoot, ".uaf/.gitignore"),
        content: readTextOrNull(gitignoreTemplate) ?? "",
        kind: "runtime",
        description: "local-only .uaf ignore rules → .uaf/.gitignore",
      });
    }
  }

  // --- skills ---------------------------------------------------------------
  const sourceSkills = discoverSourceSkills(frameworkRoot);
  const invalid = sourceSkills.filter((s) => !s.ok);
  for (const skill of invalid) warnings.push(`skill ${skill.name}: ${skill.errors.join("; ")}`);
  const validSkills = sourceSkills.filter((s) => s.ok);

  const candidates = skillCandidates({ scope, pathsById, projectRoot, home: home ?? os.homedir() });
  const skillTargets = planSkillTargets({ selectedAgents: agents, candidates });
  const uncovered = agents.filter((a) => !skillTargets.some((t) => t.covers.includes(a)));
  if (uncovered.length > 0) warnings.push(`no skill directory resolved for: ${uncovered.join(", ")}`);

  for (const target of skillTargets) {
    for (const skill of validSkills) {
      const dest = path.join(target.dir, skill.name);
      actions.push({
        type: link ? "link" : "copy",
        agent: target.agent,
        covers: target.covers,
        source: skill.dir,
        target: dest,
        kind: "skill",
        skill: skill.name,
        description: `skill ${skill.name} → ${describeTarget(projectRoot, dest, scope)}${target.covers.length > 1 ? ` (serves ${target.covers.join(", ")})` : ""}`,
      });
    }
  }

  // --- commands -------------------------------------------------------------
  if (withCommands) {
    const sourceCommands = discoverSourceCommands(frameworkRoot);
    for (const command of sourceCommands) {
      for (const issue of command.frontmatterIssues) warnings.push(`command ${command.name}: ${issue}`);
    }
    for (const agentId of agents) {
      const paths = pathsById[agentId];
      const dir = scope === "user" ? paths.commandsUser : paths.commandsProject;
      if (!dir) {
        warnings.push(
          `${agentId}: ${scope}-scope commands are unsupported by this agent (Codex only reads user-scope \`$CODEX_HOME/prompts/\`); its workflow commands are available as skills instead`,
        );
        continue;
      }
      for (const command of sourceCommands) {
        const dest = path.join(dir, `${command.name}.md`);
        actions.push({
          type: "copy",
          agent: agentId,
          source: command.file,
          target: dest,
          kind: "command",
          command: command.name,
          description: `command /${command.name} → ${describeTarget(projectRoot, dest, scope)} (${agentId})`,
        });
      }
    }
  }

  // --- hooks ----------------------------------------------------------------
  if (withHooks && scope === "project") {
    const rules = path.join(frameworkRoot, "hooks", "guard-rules.json");
    if (isFile(rules)) {
      actions.push({
        type: "copy",
        agent: "shared",
        source: rules,
        target: path.resolve(projectRoot, ".uaf/guard-rules.json"),
        kind: "hook-rules",
        description: "shared guard rules → .uaf/guard-rules.json",
      });
    } else {
      warnings.push("hooks/guard-rules.json is missing; no hook guards were planned");
    }
    for (const agentId of agents) {
      const hookActions = planHooksFor(agentId, { frameworkRoot, projectRoot });
      if (hookActions.length === 0) warnings.push(`${agentId}: no hook script available for this agent`);
      actions.push(...hookActions);
    }
  } else if (withHooks && scope === "user") {
    warnings.push("hooks are installed at project scope only; user-scope hook installation is not implemented");
  }

  // --- context --------------------------------------------------------------
  if (withContext) {
    const contextActions = planContext({ agents, projectRoot, scope, pathsById, mode, frameworkRoot });
    actions.push(...contextActions.actions);
    warnings.push(...contextActions.warnings);
  }

  // Several agents can require the same shared file (guard-core.mjs). Keep the
  // first occurrence so the executor never rewrites the same path twice.
  const seen = new Set();
  const deduped = [];
  for (const action of actions) {
    const key = `${action.type}|${action.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(action);
  }

  return { actions: deduped, warnings, skills: validSkills, pathsById, scope, projectRoot, frameworkRoot, mode };
}

function describeTarget(projectRoot, target, scope) {
  return scope === "user" ? target : toPosix(path.relative(projectRoot, target)) || ".";
}

/**
 * Per-agent hook wiring.
 *
 * One `guard-core.mjs` implements the policy for every runtime; each agent gets a
 * thin native entrypoint. Import specifiers are fixed because the install layout
 * is fixed, and each entrypoint comments the path it depends on.
 */
function planHooksFor(agentId, { frameworkRoot, projectRoot }) {
  const hooksSrc = path.join(frameworkRoot, "hooks");
  const actions = [];
  const rel = (p) => toPosix(path.relative(projectRoot, p));
  const core = path.join(hooksSrc, "guard-core.mjs");
  const stdinGuard = path.join(hooksSrc, "stdin-guard.mjs");

  const copyAction = (source, target, description, kind = "hook") => ({
    type: "copy",
    agent: agentId,
    source,
    target,
    kind,
    description,
  });

  if (agentId === "claude" || agentId === "codex") {
    if (!isFile(stdinGuard) || !isFile(core)) return actions;
    const coreDest = path.resolve(projectRoot, ".uaf/hooks/guard-core.mjs");
    const guardDest = path.resolve(projectRoot, `.uaf/hooks/${agentId}-guard.mjs`);
    actions.push(copyAction(core, coreDest, `guard policy → ${rel(coreDest)}`));
    actions.push(copyAction(stdinGuard, guardDest, `hook entrypoint → ${rel(guardDest)}`));
  }

  if (agentId === "omp") {
    const src = path.join(hooksSrc, "omp-guard.ts");
    if (!isFile(src)) return actions;
    const coreDest = path.resolve(projectRoot, ".uaf/hooks/guard-core.mjs");
    actions.push(copyAction(core, coreDest, `guard policy → ${rel(coreDest)}`));
    const dest = path.resolve(projectRoot, ".omp/hooks/pre/uaf-guard.ts");
    actions.push(copyAction(src, dest, `hook entrypoint → ${rel(dest)} (Oh My Pi discovers \`hooks/pre/*.ts\`)`));
  }

  if (agentId === "opencode") {
    const src = path.join(hooksSrc, "opencode-guard.ts");
    if (!isFile(src)) return actions;
    const coreDest = path.resolve(projectRoot, ".uaf/hooks/guard-core.mjs");
    actions.push(copyAction(core, coreDest, `guard policy → ${rel(coreDest)}`));
    const dest = path.resolve(projectRoot, ".opencode/plugin/uaf-guard.ts");
    actions.push(copyAction(src, dest, `hook entrypoint → ${rel(dest)} (OpenCode auto-loads \`.opencode/plugin/*.ts\`)`));
  }

  if (agentId === "claude") {
    actions.push({
      type: "json-array-append",
      agent: "claude",
      target: path.resolve(projectRoot, ".claude/settings.json"),
      pointer: ["hooks", "PreToolUse"],
      value: { matcher: "Bash", hooks: [{ type: "command", command: `node ${rel(path.resolve(projectRoot, ".uaf/hooks/claude-guard.mjs"))}`, timeout: 10 }] },
      kind: "hook-registration",
      description: "register PreToolUse guard in .claude/settings.json",
    });
  }

  if (agentId === "codex") {
    actions.push({
      type: "write-if-absent",
      agent: "codex",
      target: path.resolve(projectRoot, ".codex/hooks.json"),
      content: `${JSON.stringify(
        {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: `node ${rel(path.resolve(projectRoot, ".uaf/hooks/codex-guard.mjs"))}`, timeout: 10 }],
            },
          ],
        },
        null,
        2,
      )}\n`,
      kind: "hook-registration",
      description: "declare PreToolUse guard in .codex/hooks.json (needs `features.hooks`, and a one-time /hooks trust review)",
    });
  }

  return actions;
}

function planContext({ agents, projectRoot, scope, pathsById, mode, frameworkRoot }) {
  const actions = [];
  const warnings = [];
  const templateFile = path.join(frameworkRoot, "templates", "context-block.md");
  if (!isFile(templateFile)) {
    warnings.push("templates/context-block.md is missing; no context block was planned");
    return { actions, warnings };
  }
  const template = readTextOrNull(templateFile) ?? "";
  const resolvedMode = MODES.includes(mode) ? mode : DEFAULT_MODE;
  const body = template.replaceAll("{{mode}}", resolvedMode).replaceAll("{{modeSummary}}", policyFor(resolvedMode).summary);
  const selected = new Set(agents);

  if (scope === "user") {
    for (const agentId of agents) {
      const target = pathsById[agentId].contextUser;
      if (!target) {
        warnings.push(`${agentId}: no user context file is defined`);
        continue;
      }
      actions.push({
        type: "block",
        agent: agentId,
        target,
        body,
        kind: "context",
        description: `context block → ${target}`,
      });
    }
    return { actions, warnings };
  }

  // Project scope: find the files each selected agent actually reads.
  const claudeMdCandidates = ["CLAUDE.md", ".claude/CLAUDE.md"].map((rel) => path.resolve(projectRoot, rel)).filter(isFile);
  const agentsMd = path.resolve(projectRoot, "AGENTS.md");
  const needsClaudeMd = selected.has("claude") && claudeMdCandidates.length > 0;

  if (selected.has("codex") || selected.has("opencode") || selected.has("omp") || (selected.has("claude") && !needsClaudeMd)) {
    actions.push({
      type: "block",
      agent: [...selected].find((a) => a !== "claude") ?? "claude",
      covers: [...selected],
      target: agentsMd,
      body,
      kind: "context",
      created: !isFile(agentsMd),
      description: `${isFile(agentsMd) ? "append context block to" : "create"} AGENTS.md (read by codex, opencode, oh-my-pi${needsClaudeMd ? "" : ", claude"})`,
    });
  }
  if (needsClaudeMd) {
    const target = claudeMdCandidates[0];
    actions.push({
      type: "block",
      agent: "claude",
      target,
      body,
      kind: "context",
      created: false,
      description: `append context block to ${toPosix(path.relative(projectRoot, target))} (Claude Code ignores AGENTS.md while CLAUDE.md exists)`,
    });
  }
  if (selected.has("omp")) {
    warnings.push(
      "oh-my-pi: the framework writes the standalone AGENTS.md deliberately; writing .omp/AGENTS.md would shadow a repository AGENTS.md at the same depth.",
    );
  }
  return { actions, warnings };
}

/**
 * Execute a plan. Every mutation is recorded in the manifest so uninstall can
 * reverse exactly these steps.
 */
export function applyPlan(plan, { manifest, onEvent = () => {} } = {}) {
  const results = [];
  const createdDirs = new Set();

  for (const action of plan.actions) {
    switch (action.type) {
      case "copy": {
        const existed = exists(action.target);
        const previousHash = existed ? directoryHash(action.target) : null;
        copyDirOrFile(action.source, action.target);
        const hash = directoryHash(action.target);
        addEntry(manifest, {
          type: "copy",
          agent: action.agent,
          target: action.target,
          source: action.source,
          kind: action.kind,
          skill: action.skill ?? null,
          command: action.command ?? null,
          hash,
          previousHash,
          replaced: existed,
        });
        onEvent({ ...action, status: existed ? "replaced" : "created" });
        results.push({ ...action, status: existed ? "replaced" : "created" });
        break;
      }
      case "link": {
        const existed = exists(action.target);
        if (existed && !fs.lstatSync(action.target).isSymbolicLink()) {
          onEvent({ ...action, status: "skipped", reason: "target exists and is not a symlink" });
          results.push({ ...action, status: "skipped", reason: "target exists and is not a symlink" });
          break;
        }
        fs.mkdirSync(path.dirname(action.target), { recursive: true });
        try {
          fs.rmSync(action.target, { force: false });
        } catch {
          /* nothing to remove */
        }
        fs.symlinkSync(action.source, action.target, "dir");
        addEntry(manifest, { type: "link", agent: action.agent, target: action.target, source: action.source, kind: action.kind, skill: action.skill ?? null });
        onEvent({ ...action, status: "linked" });
        results.push({ ...action, status: "linked" });
        break;
      }
      case "block": {
        const existing = readTextOrNull(action.target) ?? "";
        const before = fileHash(action.target);
        // Existence must be sampled before the write, or `created` is always false
        // and uninstall would leave an otherwise-empty file behind.
        const existedBefore = exists(action.target);
        const updated = upsertBlock(existing, action.body);
        atomicWrite(action.target, updated);
        addEntry(manifest, {
          type: "block",
          agent: action.agent,
          target: action.target,
          kind: action.kind,
          created: action.created ?? !existedBefore,
          hash: sha256(updated),
          blockHash: sha256(renderBlock(action.body)),
          previousHash: before,
        });
        onEvent({ ...action, status: existing === "" ? "created" : "updated" });
        results.push({ ...action, status: existing === "" ? "created" : "updated" });
        break;
      }
      case "json-array-append": {
        const current = readTextOrNull(action.target);
        const parsed = current === null ? {} : safeJson(current, action.target);
        if (parsed === null) {
          const reason = `${toPosix(action.target)} is not valid JSON; left untouched (Claude Code rejects comments and trailing commas)`;
          onEvent({ ...action, status: "skipped", reason });
          results.push({ ...action, status: "skipped", reason });
          break;
        }
        const before = current === null ? null : sha256(current);
        const node = ensurePointer(parsed, action.pointer);
        const already = node.some((item) => JSON.stringify(item) === JSON.stringify(action.value));
        if (!already) node.push(action.value);
        atomicWrite(action.target, `${JSON.stringify(parsed, null, 2)}\n`);
        addEntry(manifest, {
          type: "json-array-append",
          agent: action.agent,
          target: action.target,
          pointer: action.pointer,
          value: action.value,
          kind: action.kind,
          created: current === null,
          previousHash: before,
        });
        onEvent({ ...action, status: already ? "already-present" : current === null ? "created" : "updated" });
        results.push({ ...action, status: already ? "already-present" : current === null ? "created" : "updated" });
        break;
      }
      case "write-if-absent": {
        if (exists(action.target)) {
          const reason = `${toPosix(path.relative(plan.projectRoot, action.target))} already exists; left untouched so an existing hook configuration is not overwritten`;
          onEvent({ ...action, status: "skipped", reason });
          results.push({ ...action, status: "skipped", reason });
          break;
        }
        atomicWrite(action.target, action.content);
        addEntry(manifest, { type: "write-if-absent", agent: action.agent, target: action.target, kind: action.kind, created: true, hash: sha256(action.content) });
        onEvent({ ...action, status: "created" });
        results.push({ ...action, status: "created" });
        break;
      }
      case "note":
        results.push({ ...action, status: "noted" });
        break;
      default:
        results.push({ ...action, status: "unknown-action" });
    }
  }
  for (const dir of createdDirs) onEvent({ type: "mkdir", target: dir, status: "created" });
  return results;
}

function safeJson(text, file) {
  try {
    const value = JSON.parse(text.trim() === "" ? "{}" : text);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

function ensurePointer(root, pointer) {
  let node = root;
  for (let i = 0; i < pointer.length; i += 1) {
    const key = pointer[i];
    const last = i === pointer.length - 1;
    if (last) {
      if (!Array.isArray(node[key])) node[key] = [];
      return node[key];
    }
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key];
  }
  return [];
}

export function copyDirOrFile(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyDirOrFile(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

/** Stable hash of a file or of every file under a directory. */
export function directoryHash(target) {
  if (!exists(target)) return null;
  const stat = fs.statSync(target);
  if (stat.isFile()) return sha256(fs.readFileSync(target));
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
