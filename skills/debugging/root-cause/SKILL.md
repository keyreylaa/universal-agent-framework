---
name: root-cause
description: A disciplined debugging procedure that orders work from reliable reproduction, through evidence-based narrowing, to one falsifiable hypothesis, the smallest justified fix, a regression test, and a report of the verification actually performed. Use when a bug, failing test, crash, flake, or post-change regression must be explained rather than silenced.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Debugging is judged by whether the cause is identified and the fix verified, not by whether the symptom disappeared. This skill fixes an order of operations so guesses are replaced by evidence at each step. It applies to any defect whose cause is not already proven by the error message: crashes, wrong values, failing or intermittent tests, and regressions introduced by a recent change. Follow it end to end; skipping ahead to the fix is what produces the same bug twice.

## When this activates

Activate on: a reported bug or incorrect output; a failing, flaky, or order-dependent test; a stack trace or error log whose cause is not obvious; a regression after a change or upgrade; "works locally, fails in CI"; a failure the agent hit itself while doing unrelated work.

Do not activate for: a compile or lint error whose message already states the fix; ordinary feature work with no defect; a deliberate experiment where failure is expected; a failure the user has explicitly declared expected. Fix or continue directly in those cases.

## Prerequisites

- A runnable entrypoint for the failing scenario: the test command, CLI, script, or service call.
- The project's own test runner, taken from the manifest or CI config rather than an ad-hoc substitute.
- Access to the error output and, where relevant, to logs from the environment where the failure appears.
- When a prerequisite is missing, name it and proceed only as far as the evidence allows (see Failure behavior).

## Procedure

1. Reproduce before theorising. Make the failing scenario fail on demand, using the project's own command. For an intermittent failure, do not accept "it sometimes fails": measure it (for example 4 failures in 20 runs) and record whether it correlates with parallelism, ordering, timing, or a specific input.
2. Capture the exact failure and environment. Copy the full error text, stack trace, and the command that produced it; never paraphrase. Record commit or version, OS and architecture, runtime version, relevant env vars, and the input or fixture. Note whether it fails on a clean checkout.
3. List plausible causes. Write three to six candidate explanations before narrowing, including at least one you expect to be wrong. Start broad, then order them by the evidence gathered so far.
4. Narrow with evidence, one discriminating experiment at a time. Choose the cheapest experiment that eliminates a candidate:
   - history bisection: `git bisect`, or the last known-good commit or tag, to find the introducing change;
   - input bisection: shrink the fixture, payload, or query to a minimal reproduction;
   - instrumentation: log or assert at module boundaries to see which assumption breaks first;
   - differential runs: compare two environments, configs, or versions, changing exactly one variable.
   After each experiment, state which candidate it eliminated. Instrumentation is temporary and must be removed.
5. Commit to one falsifiable hypothesis: "X causes Y because Z; if that is true, this experiment shows this observable result." If you cannot name the result that would disprove it, it is a guess, not a hypothesis.
6. Make the smallest justified fix. Change the cause, not the symptom. No drive-by refactors, no version bumps, no new retries or delays unless the analysis shows they are the cause. Touch only the code the evidence implicates.
7. Add a regression test where practical. It must fail on the pre-fix code and pass on the fixed code, and must assert the observable behaviour (see the testing-strategy skill). If a test is not practical, say why and record what manual check substitutes for it.
8. Re-run the failing scenario from step 1 and watch it pass. A fix is unverified until the original reproduction no longer fails. For an intermittent defect, repeat it enough times to be meaningful (for example 20 runs, or under the same concurrency as the original failure).
9. Run the relevant tests: the owning module or package suite plus the regression test. In `full` mode run the affected suite; in `ultra` mode run the full suite and adjacent failure paths when the change touches shared code.
10. Report the root cause and the verification. State the cause, the evidence chain that identified it, the fix, the regression test added, exactly which commands ran with their results, and which checks could not run and why. Never present an assumption as a verified result.

### Worked example

An order service has a CI test, `JobQueue > processes a batch concurrently`, that fails roughly one run in ten with `SQLITE_BUSY: database is locked`; locally it never fails. Reproduction is intermittent, so it is measured first: 4 failures in 40 CI runs, always on the parallel runner, never with the runner in single-process mode.

Candidates written down: (a) concurrent writers exceed the configured wait, (b) some connection is opened outside the pooled path and never receives the wait setting, (c) the test itself shares one temporary database file across workers. Input bisection removes (c): a single-process run of the same test still fails occasionally. A differential run removes (a): the pooled path never fails under identical load. Instrumenting connection creation shows one code path opening a connection directly and never applying the wait the pool applies.

Root cause: that direct connection failed immediately under contention instead of waiting, so two writers racing produced `SQLITE_BUSY`. Fix: route that path through the pooled connection helper so it inherits the same wait setting - one file changed.

Regression test: open two connections through the public API and assert that the second write waits and completes rather than throwing. It fails on the pre-fix revision and passes on the fix. Verification performed: the new test against the pre-fix revision (fails), then against the fix (passes), then the job-queue suite green, then 40 repeated CI-style runs with 0 failures against 4 before.

## Verification

- The exact step-1 reproduction now passes, and the new regression test fails when the fix is reverted (`git stash` the fix, run it, restore).
- Commands come from the project's manifest or CI file, not from a runner you chose.
- The owning suite is green; broader suites only when the change touches shared code or the current mode warrants them.
- An intermittent defect is verified by repetition, not by a single green run.
- The report names each command run and its observed result, and separately names anything not run.

## Failure behavior

- Cannot reproduce: do not guess-fix. Gather the conditions present at failure, ask for the exact input, command, and version, or add temporary diagnostics that collect data on the next occurrence.
- The scenario needs a service, credential, or environment that is not available: say exactly what is missing ("the integration suite needs DATABASE_URL and a live Postgres; neither is available here"). Report what you did verify by other means and label the rest as an unverified assumption. Never describe an unverified fix as working.
- Several candidates survive elimination: keep narrowing. If two genuinely cannot be separated, fix the one with the strongest evidence and note the alternative in the report.
- The correct fix is large: stop, report the root cause and the options, and get a decision before rewriting.
- The user already reported the failure: treat their report as ground truth. Do not re-run the check merely to confirm it; spend that run on a discriminating experiment instead.

## Anti-patterns

Poor, guessing until it is green:
```python
# Three speculative changes, none of them the cause.
client = Client(timeout=30)        # maybe it is too slow
for _ in range(3):                 # maybe it needs a retry
    result = client.send(payload)
if _is_ci():
    pytest.skip("flaky")           # make CI stop complaining
```
Improved, one change at the located cause: the analysis names the missing connection wait, so exactly that path is fixed and a test reproduces the race. The improved version leaves an explanation and a guard; the poor one hides the defect and reopens it later under different timing.

Poor, claiming a fix without running the failure:
"Changed the guard clause; the logic now looks right, so this is fixed."
Improved: "Re-ran `npm test -- job-queue` 40 times: 0 failures, against 4 in 40 before the change."

Poor, re-running the user's report to confirm it:
"I ran the suite again and confirmed it still fails, as you said."
Improved: accept the report and spend the run on a differential experiment instead; confirming a report the user already gave buys nothing.

Poor, editing the test to match the code:
```diff
-  expect(quote.total).toBe(18)
+  expect(quote.total).toBe(17.5)
```
Improved: the assertion states the agreed behaviour, so a mismatch is a signal from the bug. If the intended behaviour really changed, say so explicitly and get agreement before editing the expectation.

## Security

- Reproduce with synthetic fixtures, never production data or live credentials.
- Stack traces, logs, dumps, and fixture files often contain tokens, personal data, or connection strings; redact them before pasting into a report, a commit, or `uaf remember`.
- Remove temporary instrumentation before the fix lands; debug logging is a common leak path.
- Do not disable TLS verification, authentication, or sandboxing to make a reproduction cheaper.

## Token notes

- Work from the one failing test and its output, not the whole suite log; slice logs to the failing run.
- Keep hypotheses and experiment results in a scratch note instead of re-deriving them in context.
- Use `uaf search "<symbol or error text>"` to find the relevant module rather than reading whole files; read only the frames on the stack.
- Record a durable root cause with `uaf remember "<cause and fix>"` so the next session does not repeat the investigation.
- Ask for the failing output when it is missing rather than scanning the repository for it.

## Known limitations

- A race or environment-dependent defect may not reproduce in the available environment; the procedure can bound the cause with evidence but cannot prove it from one green run.
- History bisection needs a usable commit history; a squashed or uncommitted history leaves input bisection, instrumentation, and differential runs.
- Whether an existing suite can run here is environment-dependent; coverage you did not exercise is an assumption, not a result.
- The skill cannot decide whether the intended behaviour is correct; that comes from the user, the tests, or the specification.
