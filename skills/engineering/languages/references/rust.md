# Rust

## Tooling to discover in the repo

- `Cargo.toml`: `[package]` `edition` and `rust-version`, `[dependencies]` feature flags, `[workspace]` members, and `[lints]` overrides. Features decide which code paths even compile.
- `Cargo.lock`: present for binaries and applications; a library may intentionally omit it.
- Toolchain pin: `rust-toolchain.toml` (channel, components, targets), `.cargo/config.toml` (targets, linker, aliases).
- Formatting and linting config: `rustfmt.toml`, `clippy.toml`, and whether CI runs `clippy` with warnings denied.
- Test targets: `tests/` integration tests, `benches/`, examples, and any `cargo-nextest` configuration.
- Async runtime: which of the ecosystem's runtimes (for example `tokio`) the project depends on, and whether the macro entry point is used.

## Error handling

- `Result<T, E>` with `?` is the default. `Option` covers absence; `Result` covers failure with a reason.
- Library crates: define concrete error enums (commonly via `thiserror`) so callers can match variants. Application crates: an opaque dynamic error type (commonly `anyhow`) is acceptable at the top level, but not in a public API.
- Implement `From` conversions so `?` does not force manual mapping at every call.
- `unwrap()`/`expect()` are for cases where failure is provably impossible. When using `expect`, the message must state the invariant, not "failed".
- `panic!` is not error handling; it unwinds the current task or thread and, in a server, may take down a request or the process.
- Do not silently discard a `Result`: `let _ = save(&x);` needs a comment justifying the discard, or `let _ = ...` becomes a bug farm.
- Preserve the cause when wrapping, and keep `Display` messages lowercase and context-free; put operation context in the wrapper.

## Concurrency and async

- The compiler enforces `Send`/`Sync`; when it complains, that is a design signal. Do not paper over it with `unsafe impl` or by cloning shared state everywhere.
- Threads: move owned data in, communicate with channels or `Arc<Mutex<T>>`/`Arc<RwLock<T>>`, and join handles so panics are observed.
- Locks are guards: the lock releases when the guard drops, so understand its scope. Holding a `std::sync` guard across `.await` risks deadlock and usually fails to compile in async code; either scope the guard to a block or use the async runtime's mutex.
- Async code must not block: no synchronous file or network I/O inside a task. Use the runtime's async APIs, or an explicit blocking-offload pool for unavoidable blocking work.
- Tasks must not be detached without intent; keep the join handle so cancellation and panics are visible.
- Atomics are for counters and flags; anything more complex needs a lock, and every claim about atomic ordering deserves a comment.

## Testing

- `cargo test` runs unit tests in `#[cfg(test)] mod tests`, integration tests under `tests/`, and doc tests in code fences.
- Table-style tests over a helper function; use `#[should_panic(expected = "...")]` sparingly, preferring assertions on `Err` values.
- Integration tests exercise the public API the way a consumer would; unit tests cover internal invariants.
- Run `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` when CI does; do not edit unrelated files to satisfy the formatter.
- Property-based testing (`proptest`, `quickcheck`) belongs where the project already uses it.

## Anti-patterns

Unwrapping user input.
```rust
let port: u16 = env::var("PORT").unwrap().parse().unwrap();
```
A missing or malformed variable aborts the process with an unhelpful message. Improved: `let port: u16 = env::var("PORT")?.parse().context("PORT must be a number")?;`.

Cloning to satisfy the borrow checker.
```rust
fn total(rows: &Vec<Order>) -> Decimal {
    rows.clone().into_iter().map(|r| r.amount).sum()
}
```
The clone is pure cost. Improved: `rows.iter().map(|r| r.amount).sum()`.

Taking `&Vec<T>` or `&String` in a signature.
```rust
fn load(path: &String) -> io::Result<String>
```
Callers with a `&str` cannot call it. Improved: `fn load(path: &str) -> io::Result<String>` (or `impl AsRef<Path>`).

Holding a lock across an await point.
```rust
let guard = state.lock().unwrap();
let row = db.fetch(guard.id).await; // guard is alive across the await
```
Improved: copy the needed value out, drop the guard, then await.

Truncating casts.
```rust
let size = len as u32; // silently wraps for large inputs
```
Improved: `let size = u32::try_from(len).expect("input larger than u32");` — an explicit, checked conversion.
