# Python

## Tooling to discover in the repo

- `pyproject.toml`: `[project]` dependencies, `[build-system]` backend, and tool tables such as `[tool.poetry]`, `[tool.pdm]`, `[tool.hatch]`, `[tool.ruff]`, `[tool.mypy]`, `[tool.pytest.ini_options]`.
- Lockfiles and requirements: `uv.lock`, `poetry.lock`, `Pipfile.lock`, `requirements.txt`, `requirements-dev.txt`.
- Legacy layout files: `setup.py`, `setup.cfg`, `tox.ini` — read them before assuming `pyproject.toml` is authoritative.
- Interpreter pin: `.python-version`, `requires-python`, the CI matrix, `tox.ini` envlist.
- Lint/format: `ruff`, `black`, `isort`, `flake8` — whichever the config and CI actually invoke.
- Type checking: `mypy` or `pyright`, with its strictness level.
- Test runner and layout: `pytest` (usually) versus `unittest`; `tests/` versus `test/`; `conftest.py` fixtures.

## Error handling

- Catch the narrowest exception that makes sense (`KeyError`, `ValueError`, `TimeoutError`), never bare `except:` and rarely `except Exception`.
- Re-raise with context: `raise ConfigError(f"bad key {name!r}") from exc`. `from exc` keeps the chain visible in the traceback.
- Define a package-level exception root and derive specific errors from it so callers can catch one family.
- Use exception chaining and cleanup via `try/except/else/finally` or a context manager; do not hand-roll file and lock release.
- Follow EAFP (`try: value = mapping[key] except KeyError:`) when the failure is genuinely exceptional; use `.get()`/`getattr(..., default)` for expected absence.
- Do not return `None` to signal failure when the caller cannot distinguish it from a valid `None`; raise, or return a sentinel/result type.
- `assert` disappears under optimization; never use it for input validation.

## Concurrency and async

- The GIL means threads help I/O-bound work and not CPU-bound work. CPU-bound parallelism belongs in `concurrent.futures.ProcessPoolExecutor` or `multiprocessing`.
- `asyncio` runs on one thread: a single blocking call inside a coroutine stalls the whole loop. Move blocking work to `asyncio.to_thread` or a process pool, or use the async variant of the library.
- Never mix a synchronous database driver or HTTP client into an async application just for convenience.
- Bound concurrency with a semaphore; `asyncio.gather` over an unbounded collection will exhaust file descriptors or upstream rate limits.
- Always apply timeouts (`asyncio.timeout`/`asyncio.wait_for` on modern interpreters, or the client's own timeout parameter).
- Prefer task groups or explicit task tracking so cancellation and exceptions are not dropped; a bare `asyncio.create_task` whose exception you never await logs "task exception was never retrieved".
- Threads sharing mutable state need a `threading.Lock`; the GIL does not make read-modify-write atomic.

## Testing

- Use the configured runner; with `pytest`, `pytest -q` and the repo's own options (markers, addopts) rather than new ones.
- Fixtures for setup and teardown; parametrize instead of copy-pasting near-identical tests.
- Keep tests deterministic: freeze or inject the clock, avoid real network calls, and isolate the filesystem with a temp directory.
- Do not weaken assertions to make a test pass; if the expected value is unclear, that is the finding.

## Anti-patterns

Bare except that hides failures.
```python
try:
    total = compute_invoice(order)
except Exception:
    pass
```
The billing bug becomes a silent zero. Improved: catch the specific expected error, and let everything else propagate.

Mutable default argument.
```python
def add_item(item, basket=[]):
    basket.append(item)
    return basket
```
The default list is created once and shared across calls. Improved: `def add_item(item, basket=None): basket = basket if basket is not None else []`.

Truthiness on values where zero and empty are valid.
```python
if not timeout:
    timeout = 30
```
`timeout=0`, `""`, and `[]` are all falsy but may be intentional. Improved: `if timeout is None:`.

Blocking calls inside async code.
```python
async def handler(req):
    return requests.get(req.url).text  # blocks the event loop
```
Every concurrent request waits on this call. Improved: an async client, or `await asyncio.to_thread(...)` for unavoidable blocking work.

String-built SQL.
```python
cursor.execute(f"SELECT * FROM users WHERE email = '{email}'")
```
Injection. Improved: `cursor.execute("SELECT id FROM users WHERE email = %s", (email,))` with the driver's placeholder style.

Ignoring an unclosed resource.
```python
f = open(path)
data = f.read()
```
Improved: `with open(path) as f: data = f.read()`.
