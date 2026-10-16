---
name: bot-development
description: Build and maintain Discord bots with discord.js (JavaScript/TypeScript) or discord.py (Python), covering gateway intents, slash command registration, interaction and component handling, permission checks, input validation, rate limits, sharding, logging, tests, graceful shutdown, and safe token/config handling. Use when creating a Discord bot or adding commands, buttons, select menus, modals, or embeds to one, when fixing registration, permission, or interaction failures, and when deploying or troubleshooting a running bot.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Produce Discord bots that are small to operate and hard to misuse: one canonical way to define a command, one place where configuration and the token are read, one path that turns an exception into a user-visible sentence plus a log line. The platform is event-driven and rate-limited, so correctness depends as much on where code runs (startup versus every reconnect) as on what it does. This skill supplies Discord-specific judgment; it does not replace the chosen library's own documentation.

## When this activates

- Creating a bot repository, entrypoint, or command tree.
- Adding or changing commands, buttons, select menus, modals, or embeds.
- Working on gateway intents, command registration, interaction or installation contexts, sharding, or OAuth2 invite scopes.
- Debugging "the command does not appear", "the application did not respond", 4014/disallowed-intent logins, permission failures, or 429 responses.
- Handling tokens, secrets, or deployment for a bot.

Do not activate for generic HTTP clients, for Discord webhooks used as CI notification sinks, or for non-Discord chat platforms. If the repository has no Discord SDK dependency and no bot entrypoint, this skill is the wrong tool.

## Prerequisites

- A bot application and token from the Discord Developer Portal, plus a private test guild to install it in.
- Node.js with `discord.js` v14+, or Python with `discord.py` 2.x (or a fork such as py-cord, nextcord, disnake). Confirm the version instead of assuming a signature: `node -p "require('discord.js/package.json').version"` or `python -c "import discord; print(discord.__version__)"`.
- Privileged intents enabled in the Developer Portal when they are actually used.
- Voice, moderation, or persistence work needs extras that are often absent: FFmpeg and opus/PyNaCl, plus `@discordjs/voice` in JS. Check before promising the feature.
- Optional: `uaf doctor` for the local toolchain, `uaf search "<topic>"` for prior project decisions.

If a library or tool is missing, state the gap and stop at that boundary; never invent an API to fill it. Prefer `--help`, the installed package's types, and the version-matched documentation.

## Procedure

1. **Fix the layout first.** JS/TS: `src/index.ts`, `src/commands/<name>.ts` exporting `data` plus `execute`, `src/events/<event>.ts`, `src/lib/{config,logger,errors}.ts`, `tests/`. Python: `bot.py`, one `commands.Cog` per feature area under `cogs/`, `config.py`, `tests/`. One command per module keeps diffs and context use small.
2. **Choose the library deliberately.** discord.js when the project is TypeScript, already Node-based, or needs first-class sharding and voice packaging; discord.py when the team is Python-first. Both are maintained. Migrating later is expensive because command trees, views, and error surfaces differ, so decide once and record it with `uaf remember`.
3. **Request only the intents you use.** A command-only bot typically needs just guilds. Message-content and member intents are privileged: enabled per application in the portal, reviewed past the large-bot threshold, and never needed for slash-command bots. Unnecessary privileged intents are the top cause of login rejection.
4. **Centralize configuration and validate at startup.** Read the token from an environment variable (`.env` locally, secret manager in deployment), validate required keys once, and fail fast naming the missing key (Example 5). Never hardcode, commit, log, or pass the token on argv; `debug`-level REST logging is forbidden in production because request headers carry the authorization value.
5. **Register commands once, at startup.** Guild scope while iterating (visible immediately), global scope for release (expect propagation delay). Make it idempotent by hashing serialized command payloads and skipping the call when nothing changed. Never register from an event handler.
6. **Validate, then authorize, before any side effect.** Bound every option (integer ranges, string length, resolved snowflake), reject self- and bot-targeting where it is meaningless, then check the caller's permissions. `setDefaultMemberPermissions` / `default_member_permissions` controls visibility only and admins can override it, so re-check at runtime. When acting on another member or role, compare role positions: Discord requires the bot's highest role above the target's, and the actor to outrank the target.
7. **Acknowledge every interaction within three seconds.** Defer when work will exceed that, then edit or follow up. Respond exactly once per interaction: pick one branch (`deferred` / `replied` / fresh) and log any second attempt.
8. **Bound components and modals.** Every `customId` encodes scope (for example the owner's user id) and is handled by a collector or view with an explicit timeout and a filter on both the id and the interacting user. On timeout, edit to a terminal state rather than leaving a live prompt.
9. **Route all REST through the library.** It queues per-route buckets and honors `retry_after` on 429. Manual `fetch` loops against `discord.com/api` and parallel fan-outs are the usual source of global rate-limit bans.
10. **Handle errors at one boundary.** Wrap command and component execution in a single handler that logs structured detail (command, guild, user, error) and replies with a generic, actionable sentence. Never surface stack traces, SQL, or internal ids.
11. **Shard only when required, and let the library do it.** Discord requires sharding once a bot exceeds the gateway's per-connection guild limit. Use `ShardingManager` or the auto-sharded client, not a hand-rolled shard loop, and log per-shard state.
12. **Start up and shut down cleanly.** Login, wait for ready, start schedulers, log one ready line. On `SIGINT`/`SIGTERM`, stop schedulers, close the client, flush persistence, and force exit after a timeout.
13. **Test critical command behavior.** Extract permission and validation logic into pure functions and test them with plain-object fixtures; assert on command payload shape (`data.toJSON()`) rather than library internals. Run the project's own test, lint, and type commands.
14. **Keep presentation plain.** Name, description, and tags should say what the bot does. Avatar and banner: one legible mark, correct crop, nothing relying on text smaller than the 128px icon render. Embeds carry a short title and only the fields needed; confirmations are one clear sentence; errors say what failed and what to try next. No emoji walls, no fake "status: ONLINE" indicators, no animated multi-edit loading sequences.
15. **Mind the platform lifecycle.** Verify API versions, deprecations, installation contexts, and interaction contexts against the current developer changelog and the installed library before asserting them; these move on Discord's schedule. Record durable choices with `uaf remember`.

## Verification

- Run the project's own commands: `npm test` / `pytest` plus the configured lint and type checks (`tsc --noEmit`, `eslint`, `ruff`). Do not substitute a manual read for these.
- Inspect the serialized command payload locally, without network calls: names, options, and default permissions.
- Smoke test in the private guild: invite with the intended scopes, run each new command as a permitted and a non-permitted user, let a component time out, and force one failure to exercise the error path.
- Confirm the token appears in no log line, error payload, or process argument list.
- Run the startup path twice and confirm the second run performs no registration write.

## Failure behavior

- `Invalid token` / 401: the environment variable is absent or stale; report the variable name, never its value.
- `Used disallowed intents` / close code 4014: enable the intent in the portal, or remove it if it is unnecessary.
- Command missing in a guild: usually wrong registration scope or propagation delay; check the dev-guild id and re-register.
- `The application did not respond`: the handler exceeded the three-second window; defer earlier. `Interaction has already been acknowledged`: two response paths ran; consolidate them instead of wrapping sends in try/catch.
- Collector never fires: the compared `customId` does not byte-match the one sent, or the filter rejects the user. Log both.
- 403 on registration: the invite lacked the applications-commands scope, or the token belongs to another application.
- Repeated 429: REST bypassing the library, or a scheduler whose period is too short; route through the library and space the work.
- Ambiguous requirement (which permission tier, which scope): ask; never guess a wider permission and ship it.

## Anti-patterns

**A. Registering commands inside an event handler (runs on every reconnect).**

```js
// Poor: fires on every READY, i.e. every reconnect and every shard.
client.on(Events.ClientReady, async () => {
  await client.application.commands.set(commandData); // replaces the whole global set
});
```

```js
// Improved: register once at startup, only when the payload changed.
await registerCommands(client, commandData); // not called from an event
client.on(Events.ClientReady, (c) => logger.info({ tag: c.user.tag }, "ready"));
```

A bulk `set` replaces the entire command set, so doing it per reconnect churns the API and can wipe commands while the list is still loading. Registration is a startup concern.

**B. Answering an error with the exception itself.**

```js
// Poor: leaks internals, and double-replies when the command already responded.
try { await execute(interaction); }
catch (err) { await interaction.reply(`Error: ${err.message}\n${err.stack}`); }
```

```js
// Improved: full detail to the log, a safe sentence to the user, one reply path.
try { await execute(interaction); }
catch (err) {
  logger.error({ err, command: interaction.commandName, guild: interaction.guildId }, "command failed");
  await respondSafely(interaction, "That command failed. It has been logged; try again shortly.");
}
```

**C. Decorative output instead of information.**

```js
// Poor: emoji wall, fake status, and a "loading" bar that edits the message 20 times.
await interaction.reply("✅✅ **SUCCESS!!!** 🎉\n🟢 status: ONLINE ✅");
```

```js
// Improved: one fact, one sentence, no decoration and no fake liveness.
await interaction.reply({ content: "Deleted 42 messages.", ephemeral: true });
```

## Examples

Component APIs, the ephemeral option, and registration helpers have shifted between minor releases. Treat these as shape guidance and verify names and options against the installed version's own documentation.

**1. Simple command.**

```ts
// src/commands/ping.ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
export const data = new SlashCommandBuilder().setName("ping").setDescription("Report bot latency.");
export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.reply({ content: `Pong: ${Math.round(interaction.client.ws.ping)}ms`, ephemeral: true });
}
```
```py
# cogs/ping.py — discord.py 2.x
import discord
from discord import app_commands
@app_commands.command(name="ping", description="Report bot latency.")
async def ping(interaction: discord.Interaction):
    await interaction.response.send_message(f"Pong: {round(interaction.client.latency * 1000)}ms", ephemeral=True)
```

**2. Slash command with input validation and a permission check.** Visibility control is not authorization, so check again at runtime.

```ts
export const data = new SlashCommandBuilder()
  .setName("purge").setDescription("Delete recent messages in this channel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((o) => o.setName("count").setDescription("1 to 100").setMinValue(1).setMaxValue(100).setRequired(true));
export async function execute(interaction: ChatInputCommandInteraction) {
  if (!canPurge(interaction.memberPermissions)) return interaction.reply({ content: "You need Manage Messages here.", ephemeral: true });
  if (!interaction.channel?.isTextBased() || !interaction.channel.bulkDelete)
    return interaction.reply({ content: "This channel does not support bulk deletion.", ephemeral: true });
  const count = interaction.options.getInteger("count", true); // already bounded by min/max
  await interaction.deferReply({ ephemeral: true });
  const deleted = await interaction.channel.bulkDelete(count, true);
  await interaction.editReply(`Deleted ${deleted.size} messages.`);
}
```
```py
@bot.tree.command(name="purge", description="Delete recent messages in this channel.")
@app_commands.describe(count="How many messages, 1 to 100.")
@app_commands.checks.has_permissions(manage_messages=True)
async def purge(interaction: discord.Interaction, count: app_commands.Range[int, 1, 100]):
    if not interaction.channel.permissions_for(interaction.guild.me).manage_messages:
        await interaction.response.send_message("I cannot manage messages here.", ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True)
    deleted = await interaction.channel.purge(limit=count)
    await interaction.followup.send(f"Deleted {len(deleted)} messages.")
```

Register app-command check failures in the tree's error handler so a denied user gets a sentence instead of silence.

**3. Button with a collector and timeout.**

```ts
await interaction.reply({ content: "Delete the tagged messages?", components: [row], ephemeral: true });
const reply = await interaction.fetchReply();
const collector = reply.createMessageComponentCollector({
  time: 30_000, max: 1,
  filter: (i) => i.user.id === interaction.user.id && i.customId === `confirm:${interaction.user.id}`,
});
collector.on("collect", async (i) => { await doDelete(); await i.update({ content: "Deleted.", components: [] }); });
collector.on("end", async (collected, reason) => {
  if (collected.size === 0 && reason === "time")
    await interaction.editReply({ content: "Timed out; nothing was deleted.", components: [] });
});
```
```py
view = ConfirmView(timeout=30)  # holds the buttons; on_timeout edits view.message to a terminal state
await interaction.response.send_message("Delete the tagged messages?", view=view, ephemeral=True)
```

**4. Error handling that reports without leaking internals.**

```ts
const SAFE = "That command failed. It has been logged; try again shortly.";
async function respondSafely(interaction: RepliableInteraction, message: string) {
  if (interaction.deferred) return interaction.editReply(message);
  if (interaction.replied) return interaction.followup.send(message, { ephemeral: true });
  return interaction.reply({ content: message, ephemeral: true });
}
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try { await commands.get(interaction.commandName)?.execute(interaction); }
  catch (err) {
    logger.error({ err, command: interaction.commandName, guild: interaction.guildId }, "command failed");
    await respondSafely(interaction, SAFE);
  }
});
```

**5. Safe configuration and token loading.**

```ts
// src/lib/config.ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
export const config = { token: required("DISCORD_TOKEN"), clientId: required("DISCORD_CLIENT_ID"), devGuildId: process.env.DEV_GUILD_ID || null };
```

`.env` stays gitignored; production reads from the platform's secret store; the logger redacts the authorization header; the token is never a CLI argument, because other users on the host can read process arguments.

**6. Test for a command's permission logic using a fixture.**

```ts
// src/lib/permissions.ts
export const canPurge = (perms: { has(flag: bigint): boolean }) => perms.has(PermissionFlagsBits.ManageMessages);
// tests/permissions.test.ts
const perms = (manageMessages: boolean) => ({ has: (_flag: bigint) => manageMessages });
it("denies without Manage Messages", () => expect(canPurge(perms(false))).toBe(false));
it("allows with Manage Messages", () => expect(canPurge(perms(true))).toBe(true));
```
```py
# tests/test_permissions.py
def test_denies_without_manage_messages():
    interaction = SimpleNamespace(permissions=SimpleNamespace(manage_messages=False))
    assert not can_purge(interaction)
```

The permission logic is a pure function over a small fixture, so the test needs no gateway connection, mocked client, or network.

**7. Deployment and troubleshooting note.**

Ship the token through the platform's secret store, never an image layer or committed file. After deploy, confirm one ready log line with the bot tag, shard id (when sharded), intent set, and registered command count. Then check in order: (a) commands missing in the test guild — wrong scope or propagation delay; (b) login 4014 — intent not enabled; (c) "application did not respond" — acknowledgement exceeded three seconds; (d) sporadic 429s — REST bypassing the library; (e) recurring shard disconnect reason codes — read the gateway close code before restarting.

## Security

- The token is a full credential: never committed, logged, passed on argv, or placed in an error payload. Rotate it in the portal if it may have leaked.
- Authorization is a runtime check, not a metadata field; admins can change default permissions and channel overwrites, so re-verify before destructive actions.
- Verify role hierarchy before moderation actions — a role edit Discord silently ignored is a real failure that looks like success.
- Treat `customId` as untrusted input: parse a fixed format, reject unexpected shapes, never interpolate it into a query or path.
- Keep secret or user-specific output ephemeral; a public reply leaks into the channel and its archives.
- Constrain mentions on any command that echoes user input, and never let `@everyone`/here propagate by default.
- Request minimal OAuth2 scopes at invite time (`bot` plus `applications.commands`; nothing more) and gate admin-tier commands behind an allowlisted guild or owner id.
- Redact the authorization header and full interaction payloads from logs: log ids, not content.

## Token notes

- Load only the command module or cog you are changing; never paste the whole command tree into context.
- Keep the command payload in one exported `data` object so schema questions are answered locally rather than by reading the registration call site.
- Use `uaf search "<topic>"` before re-deriving a convention and `uaf remember` after deciding one, so later sessions do not re-read the codebase.
- Do not dump raw gateway event JSON into the transcript; log the id and type and read a specific field only when needed.
- Check `uaf mode get` first: `lite` for a one-command tweak, `ultra` for anything touching permissions, sharding, token handling, or release deploys.

## Known limitations

- Nothing here observes the live gateway; registration propagation, intent review, and shard behavior are verified only against a real application.
- discord.js minors and discord.py 2.x plus its forks differ in exactly the areas this skill touches (views, collectors, app-command trees, ephemeral flags). Snippets are shape guidance, not signatures.
- Sharding thresholds, privileged intents, API versions, and deprecations change on Discord's schedule; verify against the developer changelog rather than this file.
- Voice is not covered in depth: it needs native dependencies and separately versioned packages.
- Automated tests cannot cover gateway permissions or Discord-side role hierarchy; those need a manual smoke test in a private guild.
