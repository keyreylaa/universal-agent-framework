// Agent capability registry.
//
// Every path here is backed by a citation in docs/research/<agent>.md. Where an
// agent's behaviour is not verifiable in this environment (the binary is not
// installed) the field `runtimeVerified` stays false and `uaf compat` reports it.

import path from "node:path";
import os from "node:os";
import { expandHome, isDirectory, isFile } from "./util.mjs";

/** Shared, cross-agent locations. One write can reach several agents. */
export const SHARED_LOCATIONS = {
  agentsMd: {
    project: "AGENTS.md",
    readBy: ["codex", "opencode", "omp"],
    // Claude Code reads AGENTS.md only when no CLAUDE.md exists in cwd or above.
    conditionalReadBy: ["claude"],
  },
  claudeMd: {
    project: "CLAUDE.md",
    readBy: ["claude", "opencode", "omp"],
  },
  claudeSkillsDir: {
    project: ".claude/skills",
    readBy: ["claude", "opencode", "omp"],
  },
  agentsSkillsDir: {
    project: ".agents/skills",
    user: "~/.agents/skills",
    readBy: ["codex", "opencode", "omp"],
  },
};

export function ompAgentDir({ env = process.env, home = os.homedir() } = {}) {
  if (env.PI_CODING_AGENT_DIR) return expandHome(env.PI_CODING_AGENT_DIR);
  const profile = env.OMP_PROFILE || env.PI_PROFILE;
  if (profile && profile !== "default") return path.join(home, ".omp", "profiles", profile, "agent");
  return path.join(home, ".omp", "agent");
}

export function claudeConfigDir({ env = process.env, home = os.homedir() } = {}) {
  return env.CLAUDE_CONFIG_DIR ? expandHome(env.CLAUDE_CONFIG_DIR) : path.join(home, ".claude");
}

export function opencodeConfigDir({ env = process.env, home = os.homedir() } = {}) {
  if (env.OPENCODE_CONFIG_DIR) return expandHome(env.OPENCODE_CONFIG_DIR);
  if (env.XDG_CONFIG_HOME) return path.join(expandHome(env.XDG_CONFIG_HOME), "opencode");
  return path.join(home, ".config", "opencode");
}

export function codexHome({ env = process.env, home = os.homedir() } = {}) {
  return env.CODEX_HOME ? expandHome(env.CODEX_HOME) : path.join(home, ".codex");
}

/**
 * @typedef {object} AgentSpec
 * @property {string} id
 * @property {string} label
 * @property {string[]} bin          binaries that indicate the agent is installed
 * @property {string} research       docs/research file with the supporting citations
 * @property {(ctx: object) => string} userRoot
 * @property {string[]} projectRoots directories that indicate project-level use
 * @property {object} skills
 * @property {object} commands
 * @property {object} context
 * @property {object|null} hooks
 * @property {string[]} notes        caveats that must survive into the docs
 * @property {boolean} runtimeVerified
 */

/** @type {Record<string, AgentSpec>} */
export const AGENTS = {
  claude: {
    id: "claude",
    label: "Claude Code",
    bin: ["claude"],
    research: "docs/research/claude-code.md",
    userRoot: (ctx) => claudeConfigDir(ctx),
    projectRoots: [".claude"],
    skills: {
      user: (ctx) => path.join(claudeConfigDir(ctx), "skills"),
      project: ".claude/skills",
      layout: "<name>/SKILL.md",
      recursive: false,
      verified: "docs/research/claude-code.md §1 — `.claude/skills/<name>/SKILL.md`; symlinked skill folders are followed and de-duplicated.",
    },
    commands: {
      user: (ctx) => path.join(claudeConfigDir(ctx), "commands"),
      project: ".claude/commands",
      format: "markdown-frontmatter",
      verified: "docs/research/claude-code.md §3 — `.claude/commands/*.md`; subdirectories namespace as `dir:name`.",
    },
    context: {
      user: (ctx) => path.join(claudeConfigDir(ctx), "CLAUDE.md"),
      project: "CLAUDE.md",
      alternates: [".claude/CLAUDE.md"],
      verified: "docs/research/claude-code.md §7 — CLAUDE.md load order; AGENTS.md is read only when no CLAUDE.md exists.",
    },
    rules: { project: ".claude/rules", support: "paths-glob-frontmatter" },
    hooks: {
      kind: "claude-settings-json",
      settings: [".claude/settings.json", ".claude/settings.local.json"],
      events: ["PreToolUse", "PostToolUse", "SessionStart", "SessionEnd", "UserPromptSubmit", "Stop"],
      blockingExitCode: 2,
      verified: "docs/research/claude-code.md §5 — hooks live under the `hooks` key of a settings file; exit code 2 blocks PreToolUse.",
    },
    permissions: {
      file: [".claude/settings.json", ".claude/settings.local.json"],
      keys: ["permissions.allow", "permissions.ask", "permissions.deny", "permissions.defaultMode"],
    },
    notes: [
      "Project settings.json is strict JSON: a comment or trailing comma is a settings error.",
      "`permissions.deny` also hides matching files from Read/search.",
    ],
    runtimeVerified: false,
  },

  codex: {
    id: "codex",
    label: "OpenAI Codex CLI",
    bin: ["codex"],
    research: "docs/research/codex.md",
    userRoot: (ctx) => codexHome(ctx),
    projectRoots: [".codex", ".agents"],
    skills: {
      user: (ctx) => path.join(ctx.home, ".agents", "skills"),
      project: ".agents/skills",
      layout: "<name>/SKILL.md",
      recursive: false,
      verified:
        "docs/research/codex.md §4 — discovery table: `$CWD/.agents/skills`, parents up to the repo root, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`. `.codex/skills` is NOT a documented path.",
    },
    commands: {
      user: (ctx) => path.join(codexHome(ctx), "prompts"),
      project: null,
      format: "markdown-frontmatter",
      verified:
        "docs/research/codex.md §3 — only `$CODEX_HOME/prompts/*.md`, top-level files only, documented as deprecated in favour of skills; no project-level prompt directory exists.",
    },
    context: {
      user: (ctx) => path.join(codexHome(ctx), "AGENTS.md"),
      project: "AGENTS.md",
      alternates: [],
      verified: "docs/research/codex.md §1 — global `$CODEX_HOME/AGENTS.override.md` or `AGENTS.md`; project walk root→cwd.",
    },
    rules: { project: null, support: "none" },
    hooks: {
      kind: "codex-hooks-json",
      file: ".codex/hooks.json",
      settings: [".codex/config.toml"],
      events: ["PreToolUse", "PermissionRequest", "PostToolUse", "UserPromptSubmit", "SessionStart", "SessionEnd", "Stop"],
      blockingExitCode: null,
      verified:
        "docs/research/codex.md §7 — `hooks.json` or inline `[hooks]` next to active config layers; handler `type: \"command\"`; requires `features.hooks` and per-hash trust review via `/hooks`.",
    },
    permissions: {
      file: [".codex/config.toml"],
      keys: ["approval_policy", "sandbox_mode", "sandbox_workspace_write", "projects.<path>.trust_level"],
    },
    notes: [
      "Codex command files are user-scope prompts only (`$CODEX_HOME/prompts/`), so project-scope commands are installed for the other agents and reported as unsupported for Codex.",
      "Non-managed hooks must be reviewed and trusted per definition hash before Codex runs them.",
      "`codex exec` defaults to a read-only sandbox; `--full-auto` no longer exists.",
    ],
    runtimeVerified: false,
  },

  opencode: {
    id: "opencode",
    label: "OpenCode",
    bin: ["opencode"],
    research: "docs/research/opencode.md",
    userRoot: (ctx) => opencodeConfigDir(ctx),
    projectRoots: [".opencode"],
    skills: {
      user: (ctx) => path.join(opencodeConfigDir(ctx), "skills"),
      project: ".opencode/skills",
      layout: "<name>/SKILL.md",
      recursive: false,
      verified: "docs/research/opencode.md §3 — `.opencode/skills/<name>/SKILL.md`; also reads `.claude/skills/` and `.agents/skills/`.",
    },
    commands: {
      user: (ctx) => path.join(opencodeConfigDir(ctx), "command"),
      project: ".opencode/command",
      aliases: [".opencode/commands"],
      format: "markdown-frontmatter",
      verified: "docs/research/opencode.md §5 — loader scans `{command,commands}/**/*.md`; frontmatter `description`, `agent`, `model`, `subtask`.",
    },
    context: {
      user: (ctx) => path.join(opencodeConfigDir(ctx), "AGENTS.md"),
      project: "AGENTS.md",
      alternates: [],
      verified: "docs/research/opencode.md §2 — project `AGENTS.md` and global `~/.config/opencode/AGENTS.md`; `AGENTS.md` beats `CLAUDE.md`.",
    },
    rules: { project: null, support: "instructions-glob-array" },
    hooks: {
      kind: "opencode-plugin",
      dir: ".opencode/plugin",
      aliases: [".opencode/plugins"],
      events: ["tool.hook:execute.before", "tool.hook:execute.after", "shell.hook:create.before", "session.hook:prompt", "permission.hook:evaluate", "event.subscribe"],
      blockingExitCode: null,
      verified: "docs/research/opencode.md §4 — no declarative hooks; an OpenCode 2 plugin default-exports `{ id, setup }` and registers hooks on a domain (`ctx.tool.hook(\"execute.before\", …)`), not by returning a v1 hook object.",
    },
    permissions: {
      file: ["opencode.json"],
      keys: ["permission.bash", "permission.edit", "permission.webfetch", "permission.skill"],
    },
    notes: [
      "OpenCode v1 reads `.claude/skills/` natively, so a Claude-targeted skill install also reaches OpenCode.",
      "V2 still accepts the v1 config layout, but not the v1 plugin implementation: the entrypoint must default-export `{ id, setup }` or the loader refuses it with `Plugin must export a default definition with an id and an effect or setup function`.",
    ],
    runtimeVerified: false,
  },

  omp: {
    id: "omp",
    label: "Oh My Pi",
    bin: ["omp"],
    research: "omp://skills.md, omp://context-files.md, omp://hooks.md, omp://slash-command-internals.md",
    userRoot: (ctx) => ompAgentDir(ctx),
    projectRoots: [".omp"],
    skills: {
      user: (ctx) => path.join(ompAgentDir(ctx), "skills"),
      project: ".omp/skills",
      layout: "<name>/SKILL.md",
      recursive: false,
      verified: "omp://skills.md — native provider, non-recursive `<root>/<name>/SKILL.md`.",
    },
    commands: {
      user: (ctx) => path.join(ompAgentDir(ctx), "commands"),
      project: ".omp/commands",
      format: "markdown-frontmatter",
      verified: "omp://slash-command-internals.md — native provider: `<cwd>/.omp/commands/*.md` and `<agentDir>/commands/*.md`.",
    },
    context: {
      user: (ctx) => path.join(ompAgentDir(ctx), "AGENTS.md"),
      project: ".omp/AGENTS.md",
      alternates: ["AGENTS.md", "CLAUDE.md"],
      verified: "omp://context-files.md — native `.omp/AGENTS.md` outranks every other convention; standalone `AGENTS.md` and `CLAUDE.md` are also read.",
    },
    rules: { project: ".omp/RULES.md", support: "always-apply-sticky" },
    hooks: {
      kind: "omp-extension",
      dir: (ctx) => path.join(ompAgentDir(ctx), "hooks/pre"),
      projectDir: ".omp/hooks/pre",
      events: ["session_start", "tool_call", "tool_result", "turn_end", "session_shutdown", "before_agent_start"],
      blockingExitCode: null,
      verified: "omp://hooks.md — native discovery is `<root>/hooks/{pre,post}/*.{ts,js}`; a file directly in `hooks/` is not found.",
    },
    permissions: { file: [".omp/config.yml", "~/.omp/agent/config.yml"], keys: ["tools.approvalMode", "disabledProviders", "disabledExtensions"] },
    notes: [
      "Writing `.omp/AGENTS.md` shadows a repository-root `AGENTS.md` at the same depth; the installer therefore prefers the standalone `AGENTS.md`.",
      "`RULES.md` is always-apply and rides in every request; keep it short.",
      "Extension `tool_call` handlers are fail-closed: a thrown error blocks the tool.",
    ],
    runtimeVerified: true,
  },
};

export const AGENT_IDS = Object.keys(AGENTS);

/** Resolve an agent's concrete paths for one scope. */
export function resolvePaths(agentId, { projectRoot, home = os.homedir(), env = process.env }) {
  const spec = AGENTS[agentId];
  if (!spec) throw new Error(`unknown agent: ${agentId}`);
  const ctx = { home, env };
  const resolveOne = (value, fallback) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "function") return value(ctx);
    return path.resolve(projectRoot, value);
  };
  const projectPath = (value) => (value === null || value === undefined ? null : path.resolve(projectRoot, value));
  return {
    id: agentId,
    label: spec.label,
    userRoot: spec.userRoot(ctx),
    skillsUser: resolveOne(spec.skills.user, path.join(spec.userRoot(ctx), "skills")),
    skillsProject: projectPath(spec.skills.project),
    commandsUser: resolveOne(spec.commands.user, path.join(spec.userRoot(ctx), "commands")),
    commandsProject: projectPath(spec.commands.project),
    contextUser: resolveOne(spec.context.user, null),
    contextProject: projectPath(spec.context.project),
    hooksUser: spec.hooks?.dir ? resolveOne(spec.hooks.dir, null) : null,
    hooksProject: spec.hooks?.projectDir ? projectPath(spec.hooks.projectDir) : null,
    research: spec.research,
    runtimeVerified: spec.runtimeVerified,
    notes: spec.notes,
  };
}

/**
 * Detect which agents are present. A binary on PATH, an existing user config
 * directory, or an existing project directory all count as a hit; a fresh install
 * into a plain project therefore still offers all four as explicit choices.
 */
export function detectAgents({ projectRoot = process.cwd(), home = os.homedir(), env = process.env, which = null } = {}) {
  return AGENT_IDS.map((id) => {
    const spec = AGENTS[id];
    const paths = resolvePaths(id, { projectRoot, home, env });
    const binary = spec.bin.find((bin) => (which ? which(bin) : onPath(bin, env)));
    const userDir = isDirectory(paths.userRoot);
    const projectDir = spec.projectRoots.some((rel) => isDirectory(path.join(projectRoot, rel)));
    const installed = Boolean(binary) || userDir;
    return {
      id,
      label: spec.label,
      binary: binary ?? null,
      binaryPath: binary ? (which ? which(binary) : resolveOnPath(binary, env)) : null,
      userDir,
      projectDir,
      installed,
      signal: binary ? `binary:${binary}` : userDir ? `config:${paths.userRoot}` : projectDir ? `project:${spec.projectRoots[0]}` : "absent",
      paths,
      notes: spec.notes,
      runtimeVerified: spec.runtimeVerified,
      verification: installed ? "detected on this machine" : "not installed; adapter paths are document-derived only",
    };
  });
}

function pathEntries(env) {
  return (env.PATH ?? "").split(path.delimiter).filter(Boolean);
}

function onPath(bin, env) {
  return resolveOnPath(bin, env) !== null;
}

function resolveOnPath(bin, env) {
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat", ".ps1"] : [""];
  for (const dir of pathEntries(env)) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}
