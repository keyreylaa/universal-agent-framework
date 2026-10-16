---
name: code-quality
description: Enforces engineering standards for code an agent writes or reviews, covering domain-accurate naming, flat control flow with early returns, abstraction only after real callers exist, boundary-only validation, error context preservation, and no unrequested options. Use when writing, modifying, or reviewing application code and before finishing any change that adds functions, handlers, branches, or error paths; do not use for prose, documentation-only edits, formatting-only changes, or data and configuration files with no logic.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Code quality here means code a reviewer can read without translating it: names that carry domain meaning, control flow that reads top to bottom, and abstractions that exist because callers demanded them. This skill governs how you write and revise application code so the result looks like the repository it lives in rather than like generic assistant output. It is language-agnostic; the examples use TypeScript and Python because the failure modes are easiest to see there.

## When this activates

- You are about to write or modify application code: functions, classes, handlers, modules, error paths.
- You are reviewing a diff and must decide whether a comment, abstraction, or validation belongs.
- You are renaming, extracting, or de-duplicating existing code.
- You are adding an option, flag, config key, or parameter to existing code.

Must NOT activate for prose or documentation-only edits, dependency bumps, formatting-only changes, data and configuration files with no logic, or a throwaway script the user explicitly said will not be kept.

## Prerequisites

- Read access to the repository, plus its test, lint, and format commands when they exist. Read two or three files in the same area before writing (Procedure step 1).
- `uaf mode get` to know the current mode: `lite` for a small scoped change, `full` (default), `ultra` for risky or release-critical work.
- If the repo has no linter, formatter, or test command, do not invent one. Match the surrounding code by hand and state which checks were unavailable.

## Procedure

1. Read before writing. Open the module you will change and at least one sibling module that does something similar. Record the naming style (casing, verb versus noun for functions), error-handling convention, logging, config access, and test layout. Match them even where you would have chosen differently; divergence is a defect in a shared codebase.

2. Name by domain, not by shape. `user`, `invoice`, `retryPolicy` beat `data`, `item`, `obj`; `fetchInvoicesForTenant` beats `processData`. If a name needs a comment to explain what it holds, rename it instead of commenting. Renaming beats documenting a bad name.

3. Flatten control flow. Handle the failure or edge case first and return early; keep the happy path at the lowest indentation. Prefer guard clauses over `if`/`else` pyramids. If a function exceeds roughly three levels of nesting or a screen of length, extract the inner block into a function named after what it does.

4. Abstraction comes after the callers, not before. Write the concrete code. Introduce a shared function, interface, class, or wrapper at the second or third real caller, when the callers demonstrably change together. Do not create an interface, factory, or base class for a single implementation. "We might need it later" is not a caller.

5. Comment the why, never the what. A comment earns its place when it records a non-obvious constraint, an external requirement, a workaround with a link, or a decision a future reader would otherwise re-litigate. If it restates the next line, delete it.

6. Validate at the boundary only. Parse and validate untrusted input once, at the edge where it enters the system: HTTP handler, CLI argument parse, file or queue read, third-party response. Downstream, trust the validated value. Do not re-check for `null` a value the type system already narrows, and do not re-validate an object the caller's contract already guarantees.

7. Preserve error context. When you handle or rethrow, keep what failed and with which input, and chain the original cause. Never catch and discard. Never replace a specific, useful error with a generic one. If you can act on the error, act; otherwise let it propagate.

8. De-duplicate at the third occurrence. Two similar blocks may legitimately differ; wait until a third copy appears and the copies change together, then extract one function with a clear name. Do not merge code that merely looks similar but is expected to diverge.

9. Add no unrequested options. No config key, flag, environment variable, or parameter that the task did not require and no caller passes. Options are permanent compatibility surface. If you believe an option is needed, state the need to the user instead of adding it.

10. Keep the change minimal and cutover-clean. Delete what your change made obsolete: dead branches, now-unused helpers, stale comments. Leave no commented-out code, no `TODO`s you created, and no backwards-compatibility shim nobody requested.

11. Match the mode. In `lite`, do steps 1, 2, 3, and 10 and stop. In `full`, apply every step. In `ultra`, re-read steps 4 and 6 with a hostile eye: every abstraction and every validation must name its caller.

## Verification

- Run the project's own tooling, not your judgement alone: its test command, linter, type checker, and formatter. Read the actual command from `package.json` scripts, `Makefile`, `pyproject.toml`, or CI config; do not guess flags, and confirm them against the tool's own `--help` when unsure.
- `uaf doctor` reports whether the environment is wired for the current agent.
- Review the diff as the reviewer would; use `uaf git --commit` for commits and `uaf gh` for pull request work when the repo uses them.
- Self-check the diff against steps 2 through 9: any new name generic, any new nesting, any abstraction with one implementation, any comment restating code, any validation the type system already guarantees, any option no caller passes; and confirm the change added no dead code by finding a caller for each symbol you introduced.

## Failure behavior

- No test or lint command found: state that verification is limited to review and name exactly which checks were unavailable. Never report an unexecuted check as passing.
- The surrounding code violates this skill (deep nesting, generic names everywhere): match the local convention for the change at hand, do not silently refactor unrelated code, and mention the inconsistency in your summary.
- You cannot decide between extracting and leaving duplication: leave it duplicated with a short note on why the copies exist, and flag the decision. The cheaper error is duplication, not the wrong abstraction.
- The type contract conflicts with the validation need (input is `any` or untyped): treat that input as untrusted and validate it at the boundary where it is still untyped.
- A step is genuinely impossible (no repository access): say so and stop rather than proceeding with invented context.

## Anti-patterns

(a) Over-abstraction in TypeScript: one implementation wrapped in an interface and a factory.

Poor:
```ts
interface InvoiceRenderer { render(i: Invoice): string; }
class DefaultInvoiceRenderer implements InvoiceRenderer {
  render(i: Invoice): string { return `${i.id}: ${i.total}`; }
}
function makeInvoiceRenderer(): InvoiceRenderer { return new DefaultInvoiceRenderer(); }
const out = makeInvoiceRenderer().render(invoice);
```
Improved:
```ts
function renderInvoice(invoice: Invoice): string {
  return `${invoice.id}: ${invoice.total}`;
}
const out = renderInvoice(invoice);
```
Why the improved version fits: there is exactly one implementation and one caller, so the interface and factory add indirection and names to maintain while hiding nothing. Introduce the interface when a second renderer actually appears and callers must choose between them.

(b) Nested conditionals with a swallowed error in Python.

Poor:
```python
def load_rate(currency, table):
    if currency:
        if currency in table:
            try:
                return float(table[currency])
            except Exception:
                return None
        else:
            return None
    else:
        return None
```
Improved:
```python
def load_rate(currency, table):
    if not currency:
        raise ValueError("currency is required")
    if currency not in table:
        raise KeyError(f"no rate for {currency!r}; known: {sorted(table)}")
    try:
        return float(table[currency])
    except ValueError as exc:
        raise ValueError(f"rate for {currency!r} is not numeric: {table[currency]!r}") from exc
```
Why the improved version fits: the guards remove the pyramid and read top to bottom, while `except Exception: return None` erased both the failure kind and the offending input; the specific handlers keep the currency, the raw value, and the original cause.

(c) Redundant re-validation of an already-typed value plus a comment that restates the code.

Poor:
```ts
function totalPrice(order: Order): number {
  // loop over the items and add up the price
  if (order === null || order === undefined) throw new Error("order missing");
  if (!Array.isArray(order.items)) throw new Error("items missing");
  return order.items.reduce((sum, item) => sum + item.price, 0);
}
```
Improved:
```ts
function totalPrice(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.price, 0);
}
```
Why the improved version fits: `Order` already guarantees a non-null object with an `items` array, so the checks re-test the type system and the caller's contract, and the comment merely narrates the `reduce`. Delete both; if `order` really arrives untyped, validate it once where it enters.

## Security

- Never put secrets, tokens, or full personal data into names, comments, error messages, or test fixtures; error context should carry the failing field, not a credential.
- Messages you surface to end users must not leak internal paths, stack traces, SQL, or third-party payloads. Keep detail in logs; keep the user-facing message generic. This is the one place a generic message is correct.
- Validation is a security control only at trust boundaries: validate and normalize untrusted input before it reaches a query, a shell command, a filesystem path, or a template.
- `uaf secrets` lists configured secret references; do not print their values.

## Token notes

- Read only the two or three files that establish local convention, not the whole repository. Use `uaf search "<query>"` to locate the relevant module and `uaf index` to refresh the index.
- Use `uaf notes` and `uaf remember "<note>"` for facts you will need across turns instead of re-reading files.
- Keep diffs small so review context stays small: prefer one focused edit over rewriting a file, and do not open files irrelevant to the change.

## Known limitations

- "Second or third caller" and "third occurrence" are judgement thresholds, not mechanical rules; the right count depends on how likely the copies are to change together.
- The size guidance (about a screen, about three nesting levels) is a heuristic, not a lint rule; some languages and domains legitimately need longer functions.
- This skill cannot resolve a repository that is internally inconsistent. Where the repo disagrees with itself, pick the convention nearest the code you touch and say so.
- The examples use TypeScript and Python; other languages have equivalent failure modes, but their idioms (error returns versus exceptions, for instance) may shift which step applies.
