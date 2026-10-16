import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { loadSkill, parseFrontmatter, serializeFrontmatter, estimateTokens, frontmatterIssues } from "../../core/skills.mjs";
import { renderBlock, upsertBlock, removeBlock, hasBlock, addEntry, emptyManifest } from "../../core/manifest.mjs";
import { tmpdir, writeTree, cleanupAll } from "../helpers.mjs";

test.after(cleanupAll);

test("parseFrontmatter reads scalars, inline lists, block lists, and folded blocks", () => {
  const { data, body } = parseFrontmatter(
    [
      "---",
      "name: sample",
      "description: A one line description.",
      "allowed-tools: [Read, Grep]",
      "tags:",
      "  - alpha",
      "  - beta",
      "notes: >",
      "  folded",
      "  text",
      "---",
      "# Body",
      "",
      "content",
    ].join("\n"),
  );
  assert.equal(data.name, "sample");
  assert.deepEqual(data["allowed-tools"], ["Read", "Grep"]);
  assert.deepEqual(data.tags, ["alpha", "beta"]);
  assert.equal(data.notes, "folded text");
  assert.match(body, /^# Body/);
});

test("parseFrontmatter ignores colons inside the body and tolerates missing frontmatter", () => {
  const plain = parseFrontmatter("# Title\n\nkey: value\n");
  assert.equal(plain.hasFrontmatter, false);
  assert.equal(plain.body, "# Title\n\nkey: value\n");

  const withUrl = parseFrontmatter("---\nname: x\ndescription: See https://example.com/a\n---\nbody\n");
  assert.equal(withUrl.data.description, "See https://example.com/a");
});

test("parseFrontmatter does not treat an email or git remote as an import marker", () => {
  const { body } = parseFrontmatter("---\nname: x\n---\nContact user@example.com or git@github.com:org/repo.git\n");
  assert.match(body, /user@example\.com/);
});

test("serializeFrontmatter round-trips through parseFrontmatter", () => {
  const data = { name: "sample", description: "round trip", license: "MIT" };
  const text = `${serializeFrontmatter(data)}\nbody\n`;
  const parsed = parseFrontmatter(text);
  assert.equal(parsed.data.name, "sample");
  assert.equal(parsed.data.description, "round trip");
  assert.equal(parsed.data.license, "MIT");
});

test("loadSkill accepts a well-formed skill", () => {
  const dir = tmpdir();
  writeTree(dir, {
    "good/SKILL.md": "---\nname: good\ndescription: Does a thing when the task needs that thing.\nlicense: MIT\n---\n# Good\n\nSteps.\n",
  });
  const skill = loadSkill(path.join(dir, "good"));
  assert.equal(skill.ok, true);
  assert.equal(skill.name, "good");
  assert.deepEqual(skill.errors, []);
});

test("loadSkill rejects a name that disagrees with its directory", () => {
  const dir = tmpdir();
  writeTree(dir, { "good/SKILL.md": "---\nname: other\ndescription: x\n---\nbody\n" });
  const skill = loadSkill(path.join(dir, "good"));
  assert.equal(skill.ok, false);
  assert.match(skill.errors.join(" "), /does not match directory/);
});

test("loadSkill rejects an invalid name, a missing description, and an over-long description", () => {
  const dir = tmpdir();
  writeTree(dir, {
    "Bad_Name/SKILL.md": "---\nname: Bad_Name\ndescription: x\n---\nbody\n",
    "nodesc/SKILL.md": "---\nname: nodesc\n---\nbody\n",
    "longdesc/SKILL.md": `---\nname: longdesc\ndescription: ${"a".repeat(1100)}\n---\nbody\n`,
    "empty/SKILL.md": "---\nname: empty\ndescription: x\n---\n\n",
  });
  assert.match(loadSkill(path.join(dir, "Bad_Name")).errors.join(" "), /lowercase alphanumerics/);
  assert.match(loadSkill(path.join(dir, "nodesc")).errors.join(" "), /description is required/);
  assert.match(loadSkill(path.join(dir, "longdesc")).errors.join(" "), /maximum is 1024/);
  assert.match(loadSkill(path.join(dir, "empty")).errors.join(" "), /body is empty/);
});

test("loadSkill warns about unknown frontmatter without failing", () => {
  const dir = tmpdir();
  writeTree(dir, { "x/SKILL.md": "---\nname: x\ndescription: y\ninvented: true\n---\nbody\n" });
  const skill = loadSkill(path.join(dir, "x"));
  assert.equal(skill.ok, true);
  assert.match(skill.warnings.join(" "), /unknown frontmatter key "invented"/);
});

test("loadSkill reports a missing SKILL.md instead of throwing", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, "empty-dir"));
  const skill = loadSkill(path.join(dir, "empty-dir"));
  assert.equal(skill.ok, false);
  assert.match(skill.errors[0], /missing SKILL\.md/);
});

test("estimateTokens is proportional to input length", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("a".repeat(400)), 100);
});

test("managed block: append, replace, and remove are idempotent", () => {
  const original = "# Project\n\nExisting guidance.\n";
  const once = upsertBlock(original, "## Framework\n\nRules here.\n");
  assert.ok(hasBlock(once));
  assert.match(once, /^# Project/);
  assert.match(once, /Rules here\./);

  const twice = upsertBlock(once, "## Framework\n\nUpdated rules.\n");
  assert.equal(twice.match(/uaf:begin/g).length, 1);
  assert.match(twice, /Updated rules\./);
  assert.doesNotMatch(twice, /Rules here\./);

  const removed = removeBlock(twice);
  assert.equal(removed.removed, true);
  assert.equal(removed.text.includes("uaf:begin"), false);
  assert.match(removed.text, /Existing guidance\./);
});

test("removeBlock on a file with no block leaves the content untouched", () => {
  const original = "just content\n";
  const result = removeBlock(original);
  assert.equal(result.removed, false);
  assert.equal(result.text, original);
});

test("renderBlock keeps the body verbatim and wraps it in markers", () => {
  const block = renderBlock("line one\n\nline two\n");
  assert.ok(block.startsWith("<!-- uaf:begin v1 -->"));
  assert.ok(block.trimEnd().endsWith("<!-- uaf:end -->"));
  assert.match(block, /line one\n\nline two\n/);
});

test("addEntry updates an existing target rather than duplicating it", () => {
  const manifest = emptyManifest("/tmp/scope");
  addEntry(manifest, { type: "copy", agent: "claude", target: "/tmp/scope/a", hash: "1" });
  addEntry(manifest, { type: "copy", agent: "claude", target: "/tmp/scope/a", hash: "2" });
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].hash, "2");
});

test("frontmatterIssues catches values a strict YAML parser would reinterpret", () => {
  const bad = [
    "description: A review with a caveat: it depends.",
    "argument-hint: [--force] [--json]",
    "argument-hint: [get|set <mode>] [--files a,b]",
    "note: ends here # not a comment",
    "value:\twith a tab",
    "leading: *alias",
  ].join("\n");
  const issues = frontmatterIssues(bad);
  assert.equal(issues.length, 6, issues.join("\n"));
  assert.ok(issues.some((i) => /nested mapping/.test(i)));
  assert.ok(issues.some((i) => /flow brackets/.test(i)));
  assert.ok(issues.some((i) => /comment/.test(i)));
  assert.ok(issues.some((i) => /tab/.test(i)));
  assert.ok(issues.some((i) => /indicator character/.test(i)));
});

test("frontmatterIssues accepts quoted values, nested blocks, and empty blocks", () => {
  const good = [
    "name: sample",
    "description: A plain single-line description without ambiguity.",
    "argument-hint: '[--force] [--json]'",
    "note: \"contains: a colon but is quoted\"",
    "metadata:",
    "  activation: contextual",
    "  agents: claude, codex",
  ].join("\n");
  assert.deepEqual(frontmatterIssues(good), []);
  assert.deepEqual(frontmatterIssues(""), []);
});

test("loadSkill rejects an ambiguous frontmatter value rather than shipping it", () => {
  const dir = tmpdir();
  writeTree(dir, { "ambig/SKILL.md": "---\nname: ambig\ndescription: Fine.\nargument-hint: [a] [b]\n---\nbody\n" });
  const skill = loadSkill(path.join(dir, "ambig"));
  assert.equal(skill.ok, false);
  assert.match(skill.errors.join(" "), /flow brackets/);
});

test("loadSkill checks only the frontmatter, never the body", () => {
  const dir = tmpdir();
  writeTree(dir, {
    "bodyed/SKILL.md": "---\nname: bodyed\ndescription: Fine.\n---\n## Procedure\n\n1. Step one: do the thing.\n2. Step two.\n",
  });
  const skill = loadSkill(path.join(dir, "bodyed"));
  assert.deepEqual(skill.errors, []);
});
