# C++

## Tooling to discover in the repo

- Build system: `CMakeLists.txt`, `meson.build`, `BUILD`/`WORKSPACE`/`MODULE.bazel`, or a hand-written `Makefile`. Read the targets the CI invokes rather than inventing a configure step.
- Language standard: `CMAKE_CXX_STANDARD`/`target_compile_features` in CMake, `cpp_std` in Meson, or flags in the build file. It decides which library features are available.
- Dependency management: `vcpkg.json`, `conanfile.txt`/`conanfile.py`, FetchContent, or system packages — installing a new one needs the project's mechanism, not a manual `apt`/`brew`.
- Formatting and linting: `.clang-format`, `.clang-tidy`, and the CI job that enforces them.
- Compiler and flags: GCC versus Clang versus MSVC, warning flags (`-Wall -Wextra` and whether `-Werror` is on), and sanitizer configurations.
- Test framework: GoogleTest, Catch2, doctest, or a custom harness; and how tests are registered with CTest or the build target.

## Error handling

- Prefer value-based signaling for recoverable, expected conditions: `std::optional` (C++17) for absence, `std::variant` or a result type for failure, `std::expected` on C++23 toolchains.
- Use exceptions for exceptional conditions only, and only where the codebase and the build configuration support them; many embedded and some game projects compile with exceptions disabled.
- Never let an exception cross a C ABI boundary or a thread entry point without catching it.
- RAII owns every resource: `std::unique_ptr`/`std::shared_ptr`, `std::vector`, `std::string`, and containers. There is no correct reason for a manual `new`/`delete` pair in application code.
- Check the project's assertion macro. `assert` compiles away in release builds, so use it for internal invariants and the project's own check macro (or an explicit error return) for things that can happen at runtime.
- When wrapping a lower-level error, keep the original code or `std::error_code` rather than flattening it to a string.
- `noexcept` belongs on moves, destructors, and accessors that cannot throw; marking a throwing function `noexcept` terminates the process instead of propagating.

## Concurrency

- Threads: `std::thread`, or `std::jthread` (C++20) when cooperative cancellation and joining are wanted.
- Locks are RAII objects: `std::lock_guard`/`std::scoped_lock` for scopes, `std::unique_lock` when the lock must be released and reacquired. Never call `lock()`/`unlock()` by hand.
- Condition variables always wait with a predicate loop to be immune to spurious wakeups.
- `std::atomic` is for counters, flags, and pointers; guard anything larger with a mutex. Read the memory-order documentation before using anything other than the default, and justify the choice in a comment.
- Data races are undefined behavior, not "usually fine": validate concurrent code under the thread sanitizer.
- Do not detach threads; a detached thread outliving its data is a use-after-free.
- Keep locking granular, and hold no lock while calling user code or I/O.

## Testing

- Use the framework the repo already links; add the test to the same build target the CI runs (`ctest`, or the project's test executable).
- Cover the failure paths: allocation failure handling where modeled, invalid input to parsers, boundary sizes, and empty containers.
- Build and run tests under `-fsanitize=address,undefined` at least once for memory- and UB-sensitive changes, and under `-fsanitize=thread` for concurrency changes.
- For value types, test copy and move behavior explicitly when a class manages a resource.
- Avoid sleeping to synchronize tests; use the primitives under test.

## Anti-patterns

Manual memory management.
```cpp
Buffer* b = new Buffer(size);
process(b);
delete b;   // skipped on any early return or exception
```
Improved: `auto b = std::make_unique<Buffer>(size);` with the same call site, so every exit path frees.

Dangling reference to a temporary.
```cpp
const std::string& name = user().name();  // binds to a member of a destroyed temporary
```
Improved: `std::string name = user().name();` or hold the `User` in a named variable first.

Holding a reference into a container that grows.
```cpp
const auto& first = items[0];
items.push_back(more);     // reallocation invalidates `first`
```
Improved: index into the container, or copy the value when it must outlive mutation.

Pessimizing move and copy.
```cpp
std::vector<std::string> names() {
    std::vector<std::string> v = build();
    return std::move(v);           // blocks copy elision
}
for (auto s : vec) { consume(s); } // copies every element
```
Improved: `return v;` to allow the optimizer, and `for (const auto& s : vec)` to avoid the copies.

C string functions on arbitrary input.
```cpp
char buf[64];
strcpy(buf, input);      // unbounded write
sprintf(buf, "%s", input);
```
Improved: `std::string buf = input;` or a bounded `snprintf` with an explicit size check.
