// Retrieval over the project index. Deterministic scoring, no embeddings.

import { indexStats } from "./index.mjs";

const KIND_WEIGHT = { code: 1.2, test: 1.05, config: 1.0, doc: 0.95, other: 0.8, binary: 0.1 };

function normalize(term) {
  return term.toLowerCase();
}

/**
 * Score one index entry against the query terms.
 * Symbol matches outrank path matches so "where is retry handled" finds the
 * function rather than the string "retry" in an unrelated path.
 */
function scoreFile(file, terms, phrase) {
  const pathLower = file.path.toLowerCase();
  const headlineLower = (file.headline ?? "").toLowerCase();
  let score = 0;
  const matchedSymbols = [];

  for (const symbol of file.symbols ?? []) {
    const nameLower = symbol.name.toLowerCase();
    if (nameLower === phrase) score += 120;
    else if (nameLower.startsWith(phrase)) score += 80;
    else if (nameLower.includes(phrase)) score += 55;
    else if (terms.length > 1 && terms.every((t) => nameLower.includes(t))) score += 35;
    else continue;
    matchedSymbols.push(symbol);
  }

  if (pathLower.includes(phrase)) score += 30;
  if (headlineLower.includes(phrase)) score += 22;
  for (const term of terms) {
    if (pathLower.includes(term)) score += 8;
    if (headlineLower.includes(term)) score += 6;
    if ((file.language ?? "").includes(term)) score += 5;
  }
  if (terms.length > 1 && terms.every((t) => pathLower.includes(t) || headlineLower.includes(t))) score += 12;

  if (score === 0) return null;
  if (matchedSymbols.length > 0) {
    score += Math.min(matchedSymbols.length, 5) * 3;
  }
  return { score: score * (KIND_WEIGHT[file.kind] ?? 1), matchedSymbols: matchedSymbols.slice(0, 8) };
}

/**
 * @param {object} index
 * @param {string} query
 * @returns {{path: string, score: number, kind: string, language: string|null, headline: string, symbols: {name: string, line: number}[], lines?: number}[]}
 */
export function searchIndex(index, query, { limit = 20, kind = null, language = null } = {}) {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  const phrase = normalize(trimmed);
  const terms = phrase.split(/\s+/).filter((t) => t.length > 1);
  const results = [];
  for (const file of index.files ?? []) {
    if (kind && file.kind !== kind) continue;
    if (language && file.language !== language) continue;
    const scored = scoreFile(file, terms, phrase);
    if (!scored) continue;
    results.push({
      path: file.path,
      score: Math.round(scored.score),
      kind: file.kind,
      language: file.language ?? null,
      headline: file.headline ?? "",
      symbols: scored.matchedSymbols,
      lines: file.lines,
    });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, limit);
}

/** Compact, token-bounded context block an agent can act on directly. */
export function formatResults(results, { maxChars = 1600 } = {}) {
  const lines = [];
  let used = 0;
  for (const result of results) {
    const symbols = result.symbols.map((s) => `${s.name}:${s.line}`).join(", ");
    const line = `- ${result.path}${result.language ? ` [${result.language}]` : ""}${symbols ? ` — ${symbols}` : ""}${result.headline && result.symbols.length === 0 ? ` — ${result.headline}` : ""}`;
    if (used + line.length > maxChars) break;
    used += line.length + 1;
    lines.push(line);
  }
  return lines.join("\n");
}

export function describeIndex(index) {
  const stats = indexStats(index);
  const tooling = index.tooling ?? {};
  const top = (stats.byLanguage && Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1]).slice(0, 5)) ?? [];
  return [
    `${stats.files} files, ${stats.lines} lines indexed at ${index.generatedAt}`,
    `languages: ${top.map(([k, v]) => `${k}(${v})`).join(", ") || "none detected"}`,
    `tests: ${tooling.testTools?.join(", ") || "none detected"}`,
    `lint: ${tooling.lintTools?.join(", ") || "none detected"}`,
    `ci: ${tooling.ci?.length ? tooling.ci.join(", ") : "none detected"}`,
    `commands: ${Object.entries(tooling.commands ?? {})
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ") || "none detected"}`,
  ].join("\n");
}
