# TypeScript

Covers TypeScript and the JavaScript it compiles to, on Node or a bundled runtime.

## Tooling to discover in the repo

- `package.json`: `packageManager` field (which package manager owns the lockfile), `scripts` (the real entry points for build, test, lint, typecheck), `type` (module vs commonjs), `engines`.
- Lockfile: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock`/`bun.lockb`. Use the matching package manager only.
- `tsconfig.json` and any `tsconfig.*.json` it extends: `strict`, `target`, `module`/`moduleResolution`, `paths` aliases, project references.
- Lint/format config: `eslint.config.js` or `.eslintrc.*`, `biome.json`, `.prettierrc*`; the scripts decide, not your preference.
- Test runner config: `vitest.config.ts`, `jest.config.*`, `playwright.config.ts`, or plain `node:test`.
- Runtime pin: `.nvmrc`, `.node-version`, `engines.node`, or the CI workflow.
- Build tool: `tsc`, `tsup`, `esbuild`, `swc`, `vite`, or a framework's own build.

## Error handling

- `catch` bindings are `unknown` under `strict`; narrow before use (`if (e instanceof Error)`, or validate shape).
- Throw `Error` subclasses, never strings. Give them a `name` and capture the cause: `throw new ConfigError(msg, { cause: e })`.
- Re-throwing must preserve the original: `throw new ConfigError(msg, { cause: err })`, not `throw new ConfigError(String(err))`.
- Do not swallow. Logging and continuing is only acceptable when the caller genuinely tolerates failure, and then the function must say so.
- Return errors as values for expected failures (discriminated unions of `{ ok: true, value }` / `{ ok: false, error }`) when the signature makes that cheaper for callers than exceptions.
- Validate at boundaries (parsed JSON, env vars, HTTP bodies) and convert to typed domain objects; do not let `JSON.parse` results flow onward as `any`.

## Concurrency and async

- JavaScript is single-threaded: one blocking call (`fs.readFileSync`, a synchronous hash over a large buffer, a JSON parse of a huge file) stalls every pending request handled by the process.
- `await` interleaves at every suspension point, so read-modify-write sequences on shared state need one of: no `await` between read and write, a queue/mutex, or an atomic database operation.
- Run independent work concurrently with `Promise.all`; iterate sequentially only when ordering or rate limits require it.
- Bound fan-out. An unbounded `Promise.all` over a user-sized list is a resource exhaustion bug; use a concurrency-limited map or batched chunks.
- Propagate cancellation with `AbortSignal`/`AbortController` down to `fetch`, timers, and database clients.
- Enable the lint rule for unhandled promises where the project has it; unhandled rejections terminate modern Node processes.

## Testing

- Use the runner already configured. Do not add a second runner for one module.
- Co-located `*.test.ts` next to the source, or the repo's `__tests__`/`test/` layout — follow whichever exists.
- Prefer `node:test` only when the project already uses it; otherwise stay with the configured framework.
- Test through the public API; mock at the boundary (HTTP, clock, filesystem), not the module's internals.
- Run in CI mode (the repo's `test` script), not a watch mode.

## Anti-patterns

Swallowing errors.
```ts
try {
  await saveOrder(order);
} catch (e) {
  console.log(e);
}
```
The caller proceeds as if the order was saved. Improved: let it propagate, or return a typed failure the caller must handle.

Casting parsed input instead of validating it.
```ts
const cfg = JSON.parse(await readFile(path, "utf8")) as Config;
```
A typo in the file becomes a crash far from the cause. Improved: validate the parsed value against a schema and produce a `Config` only on success.

Sequential awaits for independent work.
```ts
for (const id of ids) results.push(await fetchUser(id));
```
```ts
const results = await Promise.all(ids.map((id) => fetchUser(id)));
```
Improved: run them concurrently; wall-clock time drops from the sum to the maximum once the calls are independent.

Unbounded concurrency.
```ts
await Promise.all(ids.map((id) => fetchUser(id))); // ids may be 50,000
```
Improved: bounded batches or a limiter keep the client and the upstream healthy.

Sync I/O on a request path.
```ts
app.get("/config", () => fs.readFileSync(CONFIG_PATH, "utf8"));
```
Improved: use the async API; one slow disk read otherwise blocks every concurrent request in the process.
