# Go

## Tooling to discover in the repo

- `go.mod`: module path, the `go` directive (language version — it gates generics and newer stdlib APIs), and requirement directives; `go.sum` for verification hashes.
- `vendor/` when present: the build uses vendored code, and dependency edits must go through the module cache, not the vendor tree.
- Lint config: `.golangci.yml`/`.golangci.yaml`, plus whatever CI runs beyond it (`go vet`, `staticcheck`).
- Formatting: `gofmt` and usually `goimports`; a `Makefile` or CI target may wrap them.
- Build and test targets: `Makefile`, `Taskfile.yml`, `magefile.go`, `.github/workflows/*`.
- Code layout: `cmd/`, `internal/`, `pkg/` conventions, `*_test.go` placement, and whether the repo uses build tags.

## Error handling

- Errors are values returned as the last result: `func Load(p string) (*Config, error)`.
- Wrap with context and `%w` so callers can still match: `fmt.Errorf("load config %s: %w", p, err)`. Use `%v` only when the cause should not be inspected.
- Match with `errors.Is` (sentinels) and `errors.As` (typed errors), never with string comparison of `err.Error()`.
- Declare sentinels for caller-visible conditions: `var ErrNotFound = errors.New("not found")`, returned or wrapped, not recreated per call site.
- Define a typed error when the caller needs data: a struct implementing `Error() string`.
- Every returned error must be handled, wrapped, or explicitly discarded with a comment saying why. Silent `_ = doThing()` hides real failures.
- Reserve `panic` for programmer error that cannot be recovered (broken invariants at init). Do not panic on input, network, or file conditions, and never call `log.Fatal`/`os.Exit` from library code — it skips deferred cleanup and is untestable.
- Use `defer` for cleanup, and check the error from a deferred `Close` when a write could still fail.

## Concurrency and async

- Goroutines are cheap but not free. Spawning one per request or per item without a bound is a resource leak under load.
- Take `ctx context.Context` as the first parameter of anything that can block, and pass it through to I/O calls so cancellation propagates.
- Every goroutine needs a defined exit path: a closed channel, a cancelled context, or a drained result. A goroutine with no exit path leaks for the process lifetime.
- Use `sync.WaitGroup` (or `golang.org/x/sync/errgroup` when errors matter) to join workers; the sender closes the channel, the receiver never does.
- Guard shared state with `sync.Mutex`/`sync.RWMutex` or channels; never copy a struct containing a mutex (pass pointers, run `go vet`).
- Store data in shared structs, not contexts; contexts carry cancellation, deadlines, and request-scoped values only.
- Run tests with the race detector; a race that passes locally is still undefined behavior.

## Testing

- `go test ./...` is the baseline; the repo may add flags (`-race`, `-count=1`, tags) in a Makefile or CI target.
- Table-driven tests with named subtests (`t.Run(name, ...)`) match the standard idiom.
- `t.Helper()` in assertion helpers so failures point at the caller; `t.Cleanup` for teardown instead of manual defers in every test.
- `net/http/httptest` for handlers, real temp dirs from `t.TempDir()` for filesystem work, and interfaces to substitute collaborators.
- `t.Parallel()` where the repo already uses it, and only for tests without shared mutable state.

## Anti-patterns

Ignoring an error to keep the code short.
```go
data, _ := os.ReadFile(path)
json.Unmarshal(data, &cfg)
```
The second call can also fail silently, and the first failure is invisible. Improved: handle or wrap both, so the failure line number means something.

String matching on errors.
```go
if strings.Contains(err.Error(), "not found") {
```
Message text is not part of the contract and changes between versions. Improved: `if errors.Is(err, ErrNotFound)`.

Losing the cause.
```go
return fmt.Errorf("failed to load config")
```
The underlying error, and its type, are gone. Improved: `fmt.Errorf("load config: %w", err)`.

Goroutine with no exit path.
```go
go func() {
    for {
        process(<-ch) // if ch is never closed and nothing cancels, this lives forever
    }
}()
```
Improved: select on `ctx.Done()` alongside `ch`, and join the goroutine with a `WaitGroup` so shutdown is observable.

Panicking in a request path.
```go
if user == nil {
    panic("missing user")
}
```
One bad request takes down the connection or process. Improved: return an error and let the handler map it to a status code.
