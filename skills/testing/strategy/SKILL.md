---
name: strategy
description: Choose and write the right kind of test for a change by first finding the project's existing runner, test directories, and CI command, then matching its conventions. Use when adding, repairing, or reviewing tests, choosing between unit, integration, contract, end-to-end, regression, security, failure-path, or performance coverage, or when a change touches behaviour, boundaries, invariants, precedence, or error paths.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Tests earn their place by pinning behaviour a consumer can observe, not by existing. This skill makes the agent inspect the project's test infrastructure and follow it before creating anything new, then pick the test type that matches the behaviour changed. The goal is a test that fails when the behaviour breaks and survives refactoring of the implementation.

## When this activates

Activate when: adding a test for new or changed behaviour; a bug fix needs a regression test; deciding which kind of test a change requires; reviewing whether an existing test is meaningful; a build is red and tests are involved.

Do not activate for: changes with no behaviour surface (comments, formatting, renames with mechanical call-site updates); throwaway local exploration that will not be committed; pure documentation edits.

## Prerequisites

- Read access to the repository, its manifest, and its CI configuration.
- The ability to run the project's existing test command.
- If no test infrastructure exists, say so and propose the smallest setup consistent with the ecosystem before adding dependencies (see Failure behavior).

## Procedure

1. Inspect what already exists, before writing any test. Look for, and read, the files this project actually has:
   - manifest and scripts: `package.json` (`scripts.test`, `scripts.lint`, `scripts.ci`), `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`, `build.gradle`, `pom.xml`;
   - test configuration: `jest.config.*`, `vitest.config.*`, `playwright.config.*`, `cypress.config.*`, `pytest.ini`, `tox.ini`, `phpunit.xml`, and any `test` key in the manifest;
   - existing tests: `tests/`, `test/`, `spec/`, `__tests__/`, `*_test.go`, `test_*.py`, `*.spec.ts`, `*.test.ts`;
   - CI: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml` - the command CI runs is the authoritative one.
2. Match the convention you found. Put the new test beside its siblings and use their naming, assertion style, and existing fixtures, factories, and helpers. Do not introduce a second runner, a new assertion library, or a parallel fixture system.
3. Run the relevant existing tests first, so the baseline is known before the change.
4. Choose the test type from the behaviour changed:

| Behaviour changed | Test type | Where it belongs |
|---|---|---|
| Pure function, branch, or parser rule | unit | beside the module's unit tests |
| Two components, a database, or a queue together | integration | integration suite with a real or containerised dependency |
| Request/response shape, schema, or versioned interface | API contract | contract suite; assert the shape seen by the caller |
| A user-visible flow across the whole system | end-to-end | the E2E suite; keep the count small |
| A previously broken behaviour | regression | next to the code it protects |
| Auth, input validation, injection, or secret handling | security | a dedicated case with hostile input |
| An error, timeout, retry, or partial failure | failure-path | beside the success case |
| Latency, throughput, or memory budget | performance | benchmark suite, tracked separately |

5. Add a permanent test only for a plausible consumer-visible bug: wrong behaviour, a boundary, a broken invariant, an illegal state transition, precedence, or an error path. For anything else - a one-off exploration, a timing curiosity, a value only visible internally - verify with a throwaway script and delete it instead of committing a test nobody needs.
6. Assert meaningful behaviour. The assertion must fail when the code is wrong. Prefer one assertion on the returned or persisted value over probing internals, and cover boundaries (empty, one, many, maximum, duplicate) and invariants where they exist.
7. Do not duplicate implementation details in assertions: no private fields, no internal call order or call counts, no copied formulas, no snapshot of an object whose shape is incidental.
8. Never weaken or delete an existing test to make a build pass. If a test now contradicts the intended behaviour, that is a contract change: say so, get agreement, then change the expectation deliberately and state which expectation changed and why.
9. Run the new test against the pre-change code where practical to confirm it fails for the right reason; a regression test that passes before the fix pins nothing.
10. Run the affected suite, then broader suites when the change is shared or the current mode warrants it.

## Verification

- Run the project's own command from the manifest or CI file (`npm test`, `pytest`, `go test ./...`), not one you invented.
- The new test passes with the change and fails without it (revert, run, restore).
- The affected suite is green with no newly skipped or disabled tests.
- Report the exact command and its observed result; do not claim a suite passed that you did not run.

## Failure behavior

- No test infrastructure: state that plainly, propose the smallest setup the ecosystem supports, and ask before adding dependencies or a runner.
- The suite fails before your change: isolate the pre-existing failures, record them, and keep them out of your result; do not "fix" them by weakening assertions.
- Tests cannot run here because a service, credential, or environment is missing: say exactly what is missing and what you verified instead, and label unrun checks as unrun.
- The only available assertion would be a no-throw check: it proves little; assert the value or state that must result instead.
- A test is flaky: do not add retries to hide it; treat it as a defect and find the cause (see the root-cause skill).

## Anti-patterns

Poor, pins a copied implementation detail:
```ts
it("computes the quote", async () => {
  const repo = { findCart: vi.fn().mockResolvedValue(cart), findRate: vi.fn().mockResolvedValue({ rate: 0.1 }) };
  const quote = await new PricingService(repo).quote("cart-1");
  expect(repo.findCart).toHaveBeenCalledWith("cart-1");
  expect(repo.findRate).toHaveBeenCalledAfter(repo.findCart);   // internal ordering
  expect(quote).toBe(18);
});
```
This asserts how the service is built, not what it promises: batching the two lookups, adding a cache, or renaming `findRate` breaks it while the price a customer sees never changed - and it still passes if tax is applied off the wrong base.

Improved, pins the observable contract:
```ts
it("charges the discounted total and never exceeds the subtotal", async () => {
  const pricing = makePricingService();                  // the project's own factory
  pricing.seedCart({ id: "cart-1", items: [{ price: 10, qty: 2 }], discountRate: 0.1 });

  const quote = await pricing.quote("cart-1");

  expect(quote.subtotal).toBe(20);
  expect(quote.total).toBe(18);
  expect(quote.total).toBeLessThanOrEqual(quote.subtotal);   // invariant the ordering must keep
});
```
This survives refactoring of the internals because it asserts prices a caller can see plus an invariant, and it fails the moment the discount is dropped or the rounding regresses.

Poor, asserts only that nothing threw:
```ts
it("parses the config", () => { expect(() => parseConfig(input)).not.toThrow(); });
```
Improved: assert the parsed result, for example `expect(parseConfig(input).retries).toBe(3)`. A not-throw test passes for a function that silently returns `undefined`.

Poor, weakens a failing test to get a green build:
```diff
-  expect(quote.total).toBe(18);
+  expect(quote.total).toBeLessThan(100);
```
Improved: leave it failing, find the cause, and fix the code - or, if the contract truly changed, record the decision and update the exact expected value with agreement.

## Security

- Tests must not use real credentials, real customer data, or production endpoints; use fixtures, factories, and local or containerised dependencies.
- Do not disable TLS verification, authentication, or permission checks to make a test run; that removes the very check the test exists to make.
- Treat snapshot and fixture files as commit-visible: they can capture secrets, tokens, or personal data; review them before committing.
- Hostile-input tests are valuable, but never point the hostile input at a live system.

## Token notes

- Read the manifest, the one relevant config file, and one sibling test to learn the convention, not the whole test tree.
- Keep test output to the failing case; a full suite log rarely needs to enter context.
- Reuse existing fixtures and factories rather than writing new setup, which is both longer to write and more context to hold.
- Record a durable decision with `uaf remember "<test convention>"` when you discover a project-specific rule, so later sessions do not re-derive it.

## Known limitations

- The mapping from behaviour to test type is a default, not a law; a project's existing arrangement wins where it differs.
- Whether an integration or E2E suite can run here depends on services and credentials that may be unavailable; the skill cannot create them.
- Coverage percentages are not evidence of correctness and are not used here as an acceptance criterion.
- This skill cannot judge the intended behaviour; it only ensures the chosen test pins behaviour someone has agreed on.
