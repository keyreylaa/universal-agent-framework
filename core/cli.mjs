#!/usr/bin/env node
// uaf — command surface for the universal agent framework.
//
// Design rules: read-only by default, machine-readable with --json, destructive
// operations require --yes, and no command ever publishes anything remotely.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { AGENT_IDS, AGENTS, detectAgents, resolvePaths } from "./agents.mjs";
import { discoverSourceCommands, discoverSourceSkills, planInstall, applyPlan, skillCandidates } from "./emit.mjs";
import { buildIndex, indexStats, readIndex, writeIndex, acquireLock, indexPath, memoryDir, upsertNote } from "./index.mjs";
import { searchIndex, formatResults, describeIndex } from "./search.mjs";
import { loadManifest, emptyManifest, saveManifest, manifestPath } from "./manifest.mjs";
import { uninstall, describeManifest } from "./uninstall.mjs";
import { MODES, assessRisk, policyFor, resolveMode, suggestMode, modePreamble, loadConfig } from "./mode.mjs";
import { formatFindings as formatSecretFindings, scanPaths, scanText } from "./secrets.mjs";
import { gitPreflight, githubPreflight, formatFindings as formatPreflightFindings, summarize } from "./preflight.mjs";
import { estimateTokens } from "./skills.mjs";
import { atomicWrite, exists, findProjectRoot, isFile, nowIso, readText, readJsonOrNull, toPosix } from "./util.mjs";

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = readJsonOrNull(path.join(FRAMEWORK_ROOT, "package.json"))?.version ?? "0.0.0";

const EXIT = { OK: 0, FINDINGS: 1, USAGE: 2, BLOCKED: 3 };

// --- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
        continue;
      }
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else if (token.startsWith("-") && token.length > 1) {
      const key = token.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

const out = (text) => process.stdout.write(`${text}\n`);
const outJson = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function parseList(value) {
  if (value === undefined || value === true) return null;
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function fail(message, code = EXIT.USAGE) {
  process.stderr.write(`uaf: ${message}\n`);
  return code;
}

/**
 * Confirmation gate. Non-interactive runs must pass --yes explicitly: a piped
 * invocation has no human to read the plan, and these commands rewrite config.
 */
async function confirm(flags, question) {
  if (flags.yes === true) return true;
  if (!process.stdin.isTTY) {
    process.stderr.write(`uaf: refusing to proceed without confirmation; re-run with --yes\n`);
    return false;
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

// --- commands ---------------------------------------------------------------

const HELP = `uaf ${VERSION} — shared skills, memory, and safety workflows for coding agents

Usage: uaf <command> [options]

Setup
  install      Install skills, commands, hooks, and context into agent config dirs
                 --agents <ids>      claude,codex,opencode,omp (default: detected)
                 --scope <scope>     project (default) | user
                 --dry-run           print the plan without touching disk
                 --link              symlink skills instead of copying
                 --no-hooks | --no-commands | --no-context
                 --mode <mode>       lite | full | ultra
                 --yes               apply without an interactive confirmation
  uninstall    Remove exactly what install created
                 --scope <scope>     project (default) | user
                 --purge             also delete .uaf/index.json and .uaf/memory
  status       Show the install manifest and detect drift
  doctor       Diagnose the environment, agent detection, and installed state
  compat       Print the cross-agent capability matrix

Work
  index        Build or refresh the project index        [--force]
  search       Search the index                uaf search <query> [--limit N]
  remember     Record a project note            uaf remember "text" [--id k]
  notes        List recorded notes
  prompt       Print the always-on context/mode block   [--mode <mode>]
  skills       List authored skills with sizes and token estimates

Safety
  secrets      Scan files or the current diff for credentials
  git          Git preflight                     [--commit] (pre-commit checks)
  gh           GitHub preflight (repo, CI, divergence, outgoing secrets)
  mode         get | set <mode> | suggest

Global: --json for machine-readable output. Exit codes: 0 ok, 1 findings, 2 usage, 3 blocked.
`;

async function cmdDoctor(flags) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const scopeRoot = flags.scopeRoot ? path.resolve(flags.scopeRoot) : projectRoot;
  const agents = detectAgents({ projectRoot });
  const manifest = describeManifest(scopeRoot);
  const mode = resolveMode({ requested: typeof flags.mode === "string" ? flags.mode : null, root: projectRoot });
  const index = readIndex(projectRoot);
  const config = loadConfig(projectRoot);

  const report = {
    framework: { version: VERSION, root: FRAMEWORK_ROOT },
    runtime: { node: process.version, platform: `${process.platform}/${process.arch}`, cwd: process.cwd(), projectRoot },
    agents: agents.map((a) => ({
      id: a.id,
      label: a.label,
      installed: a.installed,
      signal: a.signal,
      userRoot: a.paths.userRoot,
      skillsProject: a.paths.skillsProject,
      commandsProject: a.paths.commandsProject,
      runtimeVerified: a.runtimeVerified,
    })),
    detected: agents.filter((a) => a.installed).map((a) => a.id),
    manifest,
    mode: { resolved: mode.mode, origin: mode.origin, policy: policyFor(mode.mode) },
    config: { project: config.sources.project, user: config.sources.user },
    index: index ? { generatedAt: index.generatedAt, version: index.version, ...indexStats(index), path: toPosix(path.relative(projectRoot, indexPath(projectRoot))) } : null,
    checks: [],
  };

  if (manifest.exists && manifest.drift.length > 0) {
    report.checks.push({ level: "warn", message: `${manifest.drift.length} installed artifact(s) changed since install; run \`uaf status\` for the list.` });
  }
  if (report.detected.length === 0) {
    report.checks.push({
      level: "warn",
      message: "No target agent detected. Install with an explicit `--agents` list; adapter paths are document-derived and unverified until the agent is present.",
    });
  }
  for (const agent of agents) {
    if (agent.installed && !agent.runtimeVerified) {
      report.checks.push({
        level: "info",
        message: `${agent.label} detected but its adapter paths are document-derived only (see ${AGENTS[agent.id].research}).`,
      });
    }
  }

  if (flags.json) {
    outJson(report);
  } else {
    out(`uaf ${VERSION}  node ${process.version}  ${process.platform}/${process.arch}`);
    out(`framework:   ${FRAMEWORK_ROOT}`);
    out(`project:     ${projectRoot}`);
    out(`mode:        ${mode.mode} (${mode.origin})`);
    out("");
    out("agents:");
    for (const agent of report.agents) {
      out(`  ${agent.installed ? "●" : "○"} ${agent.id.padEnd(9)} ${agent.installed ? agent.signal : "not detected"}${agent.runtimeVerified ? " [verified]" : " [paths from docs]"}`);
    }
    out("");
    out(`install manifest: ${manifest.exists ? `${manifest.entries} entries, ${manifest.agents.join(", ")}, updated ${manifest.updatedAt}` : "none"}`);
    out(`project index:    ${report.index ? `${report.index.files} files, generated ${report.index.generatedAt}` : "not built (`uaf index`)"}`);
    for (const check of report.checks) out(`\n[${check.level}] ${check.message}`);
  }
  return EXIT.OK;
}

async function cmdCompat(flags) {
  const rows = AGENT_IDS.map((id) => {
    const spec = AGENTS[id];
    const paths = resolvePaths(id, { projectRoot: process.cwd() });
    return {
      id,
      label: spec.label,
      runtimeVerified: spec.runtimeVerified,
      research: spec.research,
      skills: { project: spec.skills.project, user: spec.skills.user({ home: os.homedir() }), citation: spec.skills.verified },
      commands: { project: spec.commands.project, user: spec.commands.user({ home: os.homedir() }), citation: spec.commands.verified },
      context: { project: spec.context.project, user: spec.context.user({ home: os.homedir() }), citation: spec.context.verified },
      hooks: spec.hooks ? { kind: spec.hooks.kind, events: spec.hooks.events, citation: spec.hooks.verified } : null,
      rules: spec.rules,
      permissions: spec.permissions,
      notes: spec.notes,
      resolved: paths,
    };
  });
  if (flags.json) {
    outJson(rows);
    return EXIT.OK;
  }
  out("agent      skills(project)      commands(project)     context(project)  hooks");
  out("---------  -------------------  --------------------  ----------------  -------------------------");
  for (const row of rows) {
    out(
      `${row.id.padEnd(9)}  ${(row.skills.project ?? "—").padEnd(19)}  ${(row.commands.project ?? "unsupported").padEnd(20)}  ${(row.context.project ?? "—").padEnd(16)}  ${row.hooks?.kind ?? "none"}`,
    );
  }
  out("");
  out("Shared locations (one write reaches several agents):");
  out("  .claude/skills  → claude, opencode, oh-my-pi");
  out("  .agents/skills  → codex, opencode, oh-my-pi");
  out("  AGENTS.md       → codex, opencode, oh-my-pi (claude only when no CLAUDE.md exists)");
  out("  CLAUDE.md       → claude, opencode, oh-my-pi");
  out("");
  out("Status: only oh-my-pi is installed in this environment, so its adapter is runtime-verified.");
  out("The other three adapters are derived from official documentation; see docs/research/.");
  return EXIT.OK;
}

async function cmdInstall(flags) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const scope = flags.scope === "user" ? "user" : "project";
  const scopeRoot = scope === "user" ? os.homedir() : projectRoot;

  if (scope === "project" && projectRoot === FRAMEWORK_ROOT && flags.self !== true) {
    return fail(
      [
        "refusing to install into the framework's own checkout.",
        "Run the installer from the project you want to configure, or pass --cwd <dir>.",
        "Pass --self to install here deliberately (useful when developing the framework).",
      ].join(" "),
    );
  }

  const detected = detectAgents({ projectRoot });
  const requested = parseList(flags.agents);
  const configuredAgents = loadConfig(projectRoot).agents;
  const agents = requested ?? detected.filter((a) => a.installed).map((a) => a.id);
  const resolvedAgents = agents.length > 0 ? agents : (configuredAgents ?? []);
  if (resolvedAgents.length === 0) {
    return fail(
      "no agents selected. Pass --agents claude,codex,opencode,omp, set `agents` in .uaf/config.json, or install a supported agent first.",
    );
  }
  for (const id of resolvedAgents) if (!AGENT_IDS.includes(id)) return fail(`unknown agent '${id}'. Known: ${AGENT_IDS.join(", ")}`);

  const plan = await planInstall({
    frameworkRoot: FRAMEWORK_ROOT,
    projectRoot,
    scope,
    agents: resolvedAgents,
    withCommands: flags["no-commands"] !== true,
    withHooks: flags["no-hooks"] !== true,
    withContext: flags["no-context"] !== true,
    link: flags.link === true,
    mode: typeof flags.mode === "string" ? flags.mode : null,
  });

  const skillBytes = plan.skills.reduce((sum, s) => sum + s.bytes, 0);
  const listingTokens = plan.skills.reduce((sum, s) => sum + estimateTokens(`${s.name} ${s.description}`), 0);
  const preview = {
    scope,
    scopeRoot,
    projectRoot,
    agents: resolvedAgents,
    detected: detected.filter((a) => a.installed).map((a) => a.id),
    skills: plan.skills.map((s) => ({ name: s.name, category: s.category, bytes: s.bytes, description: s.description })),
    actions: plan.actions.map((a) => ({ type: a.type, target: a.target, description: a.description, agent: a.agent })),
    warnings: plan.warnings,
    budget: { skillBytes, skillListingTokensEstimate: listingTokens, target: "lite: <1500 tok context, full: <4000, ultra: <8000" },
  };

  if (flags["dry-run"]) {
    if (flags.json) outJson(preview);
    else renderPlan(preview);
    return EXIT.OK;
  }

  if (flags.yes !== true) {
    if (!flags.json) renderPlan(preview);
    if (!(await confirm(flags, `Apply ${plan.actions.length} action(s) to ${scopeRoot}?`))) return EXIT.USAGE;
  }

  const manifest = loadManifest(scopeRoot);
  manifest.scope = scope;
  manifest.frameworkVersion = VERSION;
  const applied = applyPlan(plan, { manifest });
  saveManifest(manifest);

  const summary = applied.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  if (flags.json) {
    outJson({ applied: applied.length, byStatus: summary, manifest: manifestPath(scopeRoot), warnings: plan.warnings, actions: applied });
  } else {
    out(`installed ${applied.length} artifact(s) into ${scopeRoot}`);
    out(`  ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    out(`  manifest: ${toPosix(path.relative(scopeRoot, manifestPath(scopeRoot)))}`);
    if (plan.warnings.length > 0) {
      out("");
      out("warnings:");
      for (const warning of plan.warnings) out(`  - ${warning}`);
    }
    out("");
    out("next: restart the agent session so it re-scans skills, then run `uaf doctor`.");
  }
  return EXIT.OK;
}

function renderPlan(preview) {
  out(`scope: ${preview.scope}   root: ${preview.scopeRoot}`);
  out(`agents: ${preview.agents.join(", ")}`);
  out("");
  out("actions:");
  for (const action of preview.actions) out(`  ${action.type.padEnd(18)} ${action.description}`);
  out("");
  out(`skills: ${preview.skills.length} (${(preview.budget.skillBytes / 1024).toFixed(1)} KiB on disk, ~${preview.budget.skillListingTokensEstimate} tok of always-on listing)`);
  if (preview.warnings.length > 0) {
    out("");
    out("warnings:");
    for (const warning of preview.warnings) out(`  - ${warning}`);
  }
}

async function cmdUninstall(flags) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const scope = flags.scope === "user" ? "user" : "project";
  const scopeRoot = scope === "user" ? os.homedir() : projectRoot;

  const before = describeManifest(scopeRoot);
  if (!before.exists) {
    if (flags.json) outJson({ removed: [], preserved: [], prunedDirs: [], note: `no manifest at ${scopeRoot}` });
    else out(`nothing to uninstall: no manifest at ${scopeRoot}`);
    return EXIT.OK;
  }
  if (!flags.json) {
    out(`scope:  ${scopeRoot}`);
    out(`owns:   ${before.entries} artifact(s) across ${before.agents.join(", ") || "no agents"}`);
    out(`effect: remove framework-owned files, the vendored runtime, and the managed context block.`);
    out(`        hand-modified files are preserved; ${flags.purge === true ? "index and memory WILL be deleted" : "index and memory are kept"}.`);
  }
  if (!(await confirm(flags, `Uninstall from ${scopeRoot}?`))) return EXIT.USAGE;

  const result = uninstall({ scopeRoot, purgeProjectState: flags.purge === true });
  if (flags.json) {
    outJson({
      removed: result.removed.map((e) => ({ type: e.type, target: e.target, status: e.status ?? "removed" })),
      preserved: result.preserved.map((e) => ({ type: e.type, target: e.target, reason: e.reason })),
      prunedDirs: result.pruned,
    });
  } else {
    out(`uninstalled from ${scopeRoot}`);
    out(`  removed:   ${result.removed.length}`);
    out(`  preserved: ${result.preserved.length}`);
    for (const entry of result.preserved) out(`    kept ${toPosix(entry.target)} — ${entry.reason}`);
    if (result.pruned.length > 0) out(`  pruned empty dirs: ${result.pruned.length}`);
    if (flags.purge !== true && (exists(path.join(scopeRoot, ".uaf", "index.json")) || exists(path.join(scopeRoot, ".uaf", "memory")))) {
      out("  kept .uaf/index.json and .uaf/memory (pass --purge to delete them)");
    }
  }
  return EXIT.OK;
}

async function cmdStatus(flags) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const scopeRoot = flags.scope === "user" ? os.homedir() : projectRoot;
  const manifest = describeManifest(scopeRoot);
  if (flags.json) {
    outJson(manifest);
    return manifest.drift.length > 0 ? EXIT.FINDINGS : EXIT.OK;
  }
  if (!manifest.exists) {
    out(`no install manifest at ${scopeRoot} — nothing is installed here`);
    return EXIT.OK;
  }
  out(`manifest: ${scopeRoot}`);
  out(`  framework: ${manifest.frameworkVersion}`);
  out(`  installed: ${manifest.createdAt}   updated: ${manifest.updatedAt}`);
  out(`  agents:    ${manifest.agents.join(", ")}`);
  out(`  entries:   ${manifest.entries}`);
  if (manifest.drift.length === 0) {
    out("  drift:     none");
  } else {
    out("  drift:");
    for (const entry of manifest.drift) out(`    ${entry.state.padEnd(9)} ${toPosix(entry.target)}`);
  }
  return manifest.drift.length > 0 ? EXIT.FINDINGS : EXIT.OK;
}

async function cmdIndex(flags) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const lock = acquireLock(projectRoot);
  if (lock.stale) out("note: a previous indexing run did not finish; rebuilding from the last consistent snapshot");
  try {
    const previous = readIndex(projectRoot);
    const config = loadConfig(projectRoot);
    const { index, stats, warnings } = buildIndex(projectRoot, {
      previous,
      force: flags.force === true,
      extraExcludes: config.index.exclude ?? [],
    });
    index.mode = resolveMode({ requested: typeof flags.mode === "string" ? flags.mode : null, root: projectRoot }).mode;
    writeIndex(projectRoot, index);
    const file = indexPath(projectRoot);
    if (flags.json) {
      outJson({ path: file, stats, summary: indexStats(index), tooling: index.tooling, warnings });
    } else {
      out(`indexed ${stats.indexed}/${stats.scanned} files in ${stats.durationMs}ms`);
      out(`  reused=${stats.reused} rehashed=${stats.rehashed} added=${stats.added} changed=${stats.changed} removed=${stats.removed}`);
      out(`  skipped: secret=${stats.skippedSecret} binary=${stats.skippedBinary} large=${stats.skippedLarge}`);
      out(`  index:   ${toPosix(path.relative(process.cwd(), file))}`);
      out("");
      out(describeIndex(index));
      for (const warning of warnings) out(`  warn: ${warning}`);
    }
  } finally {
    lock.release();
  }
  return EXIT.OK;
}

async function cmdSearch(flags, positional) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const query = positional.join(" ").trim();
  if (query === "") return fail("usage: uaf search <query>");
  const index = readIndex(projectRoot);
  if (!index) return fail("no index found; run `uaf index` first", EXIT.FINDINGS);
  const results = searchIndex(index, query, {
    limit: Number(flags.limit ?? 20),
    kind: typeof flags.kind === "string" ? flags.kind : null,
    language: typeof flags.language === "string" ? flags.language : null,
  });
  if (flags.json) {
    outJson({ query, count: results.length, results });
  } else if (results.length === 0) {
    out(`no matches for "${query}" (${indexStats(index).files} files indexed)`);
  } else {
    out(formatResults(results, { maxChars: Number(flags.chars ?? 4000) }) || "(results exceeded the char budget)");
    out("");
    out(`${results.length} match(es) from ${indexStats(index).files} indexed files`);
  }
  return EXIT.OK;
}

async function cmdRemember(flags, positional) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const text = positional.join(" ").trim();
  if (text === "") return fail('usage: uaf remember "note text" [--id key]');
  const hits = scanText(text).filter((f) => f.severity === "high");
  if (hits.length > 0) {
    return fail(`refusing to store a note containing credential material (${hits.map((h) => h.id).join(", ")})`, EXIT.BLOCKED);
  }
  const index = readIndex(projectRoot) ?? { files: [], notes: [], generatedAt: nowIso(), version: 0 };
  const id = typeof flags.id === "string" ? flags.id : `note-${Date.now().toString(36)}`;
  const kind = ["decision", "convention", "bug", "constraint", "preference", "question"].includes(flags.kind) ? flags.kind : "note";
  upsertNote(index, { id, kind, text, source: "user-approved" });
  fs.mkdirSync(memoryDir(projectRoot), { recursive: true });
  atomicWrite(path.join(memoryDir(projectRoot), "NOTES.json"), `${JSON.stringify(index.notes, null, 2)}\n`);
  writeIndex(projectRoot, index);
  if (flags.json) outJson({ id, kind, text, notes: index.notes.length });
  else out(`remembered ${id} [${kind}]: ${text}`);
  return EXIT.OK;
}

async function cmdNotes(flags) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const index = readIndex(projectRoot);
  const notes = index?.notes ?? [];
  if (flags.json) {
    outJson(notes);
    return EXIT.OK;
  }
  if (notes.length === 0) {
    out("no project notes recorded");
    return EXIT.OK;
  }
  for (const note of notes) out(`${note.id} [${note.kind}] ${note.text}`);
  return EXIT.OK;
}

async function cmdPrompt(flags) {
  const mode = resolveMode({ requested: typeof flags.mode === "string" ? flags.mode : null, root: process.cwd() });
  const templateFile = path.join(FRAMEWORK_ROOT, "templates", "context-block.md");
  const template = isFile(templateFile) ? readText(templateFile) : "";
  const block = template.replaceAll("{{mode}}", mode.mode).replaceAll("{{modeSummary}}", policyFor(mode.mode).summary);
  const body = `${modePreamble(mode.mode, { projectName: flags.project })}\n\n${block}`;
  if (flags.json) {
    outJson({ mode: mode.mode, origin: mode.origin, tokens: estimateTokens(body), block: body });
    return EXIT.OK;
  }
  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
  return EXIT.OK;
}

async function cmdSkills(flags) {
  const skills = discoverSourceSkills(FRAMEWORK_ROOT);
  const commands = discoverSourceCommands(FRAMEWORK_ROOT);
  const rows = skills.map((s) => ({
    name: s.name,
    category: s.category,
    valid: s.ok,
    errors: s.errors,
    warnings: s.warnings,
    bytes: s.bytes,
    lines: s.lines,
    description: s.description,
    listingTokens: estimateTokens(`${s.name} ${s.description}`),
    files: countFiles(s.dir),
  }));
  const listingTokens = rows.reduce((sum, r) => sum + r.listingTokens, 0);
  const commandRows = commands.map((c) => ({ name: c.name, description: c.description, issues: c.frontmatterIssues }));
  const brokenCommands = commandRows.filter((c) => c.issues.length > 0);
  const ok = rows.every((r) => r.valid) && brokenCommands.length === 0;
  if (flags.json) {
    outJson({ skills: rows, commands: commandRows, listingTokens, ok });
    return ok ? EXIT.OK : EXIT.FINDINGS;
  }
  out(`${rows.length} skills, ${commands.length} commands`);
  out(`always-on listing cost: ~${listingTokens} tokens (name + description only)`);
  out("");
  for (const row of rows) {
    out(`  ${row.valid ? "✓" : "✗"} ${row.name.padEnd(26)} ${String(row.lines).padStart(4)} lines  ${String(row.files).padStart(2)} files  ~${row.listingTokens} tok`);
    if (!row.valid) for (const error of row.errors) out(`      error: ${error}`);
  }
  out("");
  out("commands:");
  for (const command of commandRows) {
    out(`  ${command.issues.length === 0 ? "✓" : "✗"} /${command.name.padEnd(22)} ${command.description ?? ""}`);
    for (const issue of command.issues) out(`      error: ${issue}`);
  }
  return ok ? EXIT.OK : EXIT.FINDINGS;
}

function countFiles(dir) {
  let count = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else count += 1;
    }
  };
  walk(dir);
  return count;
}

async function cmdSecrets(flags, positional) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const targets = positional.length > 0 ? positional : [projectRoot];
  const result = scanPaths(targets, { ignoreSecrets: false });
  const blocking = result.findings.filter((f) => f.severity === "high").length;
  if (flags.json) {
    outJson({ scanned: result.scanned, skipped: result.skipped, findings: result.findings });
  } else {
    out(`scanned ${result.scanned} file(s), skipped ${result.skipped}`);
    if (result.findings.length === 0) {
      out("no credential patterns matched. This does not prove the code is free of secrets.");
    } else {
      out(formatSecretFindings(result.findings, process.cwd()));
      out("");
      out(`${blocking} blocking, ${result.findings.length - blocking} to review. A clean scan is not proof of security; rotate anything exposed.`);
    }
  }
  return blocking > 0 ? EXIT.FINDINGS : EXIT.OK;
}

async function cmdGit(flags) {
  const root = path.resolve(flags.cwd ?? process.cwd());
  const result = gitPreflight({ root, commitCheck: flags.commit === true });
  if (flags.json) {
    outJson({ ok: result.ok, summary: summarize(result.findings), findings: result.findings, info: result.info });
  } else {
    out(`git preflight — ${result.info.topLevel ?? root}`);
    out(`  branch: ${result.info.branch ?? "?"}   head: ${result.info.head ?? "(none)"}`);
    if (result.info.status) {
      out(`  staged: ${result.info.status.staged.length}   unstaged: ${result.info.status.unstaged.length}   untracked: ${result.info.status.untracked.length}`);
    }
    out("");
    out(formatPreflightFindings(result.findings));
    out("");
    out(result.ok ? "OK to proceed with the commit." : "BLOCKED: resolve the errors above before committing.");
  }
  return result.ok ? EXIT.OK : EXIT.FINDINGS;
}

async function cmdGh(flags) {
  const root = path.resolve(flags.cwd ?? process.cwd());
  const result = githubPreflight({ root, remote: typeof flags.remote === "string" ? flags.remote : "origin" });
  if (flags.json) {
    outJson({ ok: result.ok, degraded: result.degraded === true, summary: summarize(result.findings), findings: result.findings, info: result.info });
  } else {
    out(`github preflight — remote ${result.info.remoteUrl ?? "(none)"}`);
    if (result.info.owner) out(`  repository: ${result.info.owner}/${result.info.repo}${result.info.ahead !== undefined ? `   ahead: ${result.info.ahead}   behind: ${result.info.behind}` : ""}`);
    out("");
    out(formatPreflightFindings(result.findings));
    out("");
    out(result.published ? "" : "Nothing was pushed. Verify the destination with the user before publishing.");
  }
  return result.ok ? EXIT.OK : EXIT.FINDINGS;
}

async function cmdMode(flags, positional) {
  const projectRoot = path.resolve(flags.cwd ?? process.cwd());
  const action = positional[0] ?? "get";
  if (action === "get") {
    const mode = resolveMode({ requested: typeof flags.set === "string" ? flags.set : null, root: projectRoot });
    if (flags.json) outJson({ mode: mode.mode, origin: mode.origin, policy: policyFor(mode.mode) });
    else out(`${mode.mode} (${mode.origin})`);
    return EXIT.OK;
  }
  if (action === "set") {
    const value = positional[1] ?? flags.value;
    if (!MODES.includes(value)) return fail(`mode must be one of: ${MODES.join(", ")}`);
    if (flags.scope === "user") {
      const file = path.join(os.homedir(), ".uaf", "config.json");
      const config = readJsonOrNull(file) ?? {};
      config.mode = value;
      atomicWrite(file, `${JSON.stringify(config, null, 2)}\n`);
      out(`set user mode to ${value} (${file})`);
    } else {
      const file = path.join(projectRoot, ".uaf", "config.json");
      const config = readJsonOrNull(file) ?? {};
      config.mode = value;
      atomicWrite(file, `${JSON.stringify(config, null, 2)}\n`);
      out(`set project mode to ${value} (${toPosix(path.relative(projectRoot, file))})`);
    }
    return EXIT.OK;
  }
  if (action === "suggest") {
    const index = readIndex(projectRoot);
    const files = parseList(flags.files) ?? index?.files?.slice(0, 40).map((f) => f.path) ?? [];
    const risk = assessRisk(files, index);
    const suggestion = suggestMode({ requested: typeof flags.requested === "string" ? flags.requested : null, risk, fileCount: files.length });
    if (flags.json) outJson({ ...suggestion, risk });
    else out(`suggested mode: ${suggestion.mode} (${suggestion.reason})\nrisk: ${risk.level} score=${risk.score}${risk.reasons.length ? ` — ${risk.reasons.join(", ")}` : ""}`);
    return EXIT.OK;
  }
  return fail(`unknown mode action '${action}'. Use get | set <mode> | suggest`);
}

// --- dispatch ---------------------------------------------------------------

const COMMANDS = {
  doctor: cmdDoctor,
  compat: cmdCompat,
  install: cmdInstall,
  uninstall: cmdUninstall,
  status: cmdStatus,
  index: cmdIndex,
  search: cmdSearch,
  remember: cmdRemember,
  notes: cmdNotes,
  prompt: cmdPrompt,
  skills: cmdSkills,
  secrets: cmdSecrets,
  git: cmdGit,
  gh: cmdGh,
  mode: cmdMode,
};

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);
  const command = positional.shift() ?? (flags.version ? "version" : "help");

  if (command === "help" || flags.help) {
    out(HELP);
    return EXIT.OK;
  }
  if (command === "version" || flags.version) {
    out(VERSION);
    return EXIT.OK;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`uaf: unknown command '${command}'\n\n${HELP}`);
    return EXIT.USAGE;
  }
  try {
    return await handler(flags, positional);
  } catch (error) {
    process.stderr.write(`uaf: ${command} failed: ${error.message}\n`);
    if (process.env.UAF_DEBUG) process.stderr.write(`${error.stack}\n`);
    return EXIT.FINDINGS;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`uaf: fatal: ${error?.stack ?? error}\n`);
    process.exit(EXIT.FINDINGS);
  },
);
