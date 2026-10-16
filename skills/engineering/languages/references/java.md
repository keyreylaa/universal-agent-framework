# Java

## Tooling to discover in the repo

- Build tool first: `pom.xml` means Maven (`./mvnw` if the wrapper exists), `build.gradle`/`build.gradle.kts` with `settings.gradle` means Gradle (`./gradlew`). Always use the wrapper when present; it pins the build tool version.
- Release level: `maven.compiler.release` or the Gradle `java.toolchain`/`sourceCompatibility` settings; this gates language features such as records, pattern matching, and virtual threads.
- Dependency management: the parent POM or Gradle platform/BOM; add versions by extending it, not by pinning an unrelated version inside a module.
- Static analysis and formatting: `checkstyle.xml`, `spotbugs`/`findbugs` includes, `pmd`, `errorprone`, or a formatter plugin, plus whatever CI enforces.
- Test stack: the JUnit version (JUnit 5/Jupiter versus JUnit 4), assertion and mocking libraries (AssertJ, Mockito), and Surefire/Failsafe or the Gradle `test` task configuration.
- Framework conventions: Spring, Quarkus, Micronaut, or plain libraries, since they define where configuration and wiring live.

## Error handling

- Checked exceptions are for conditions a caller can reasonably recover from; runtime exceptions are for programming errors and invariant violations. Do not convert every checked exception to a runtime one to avoid handling it.
- Never catch and discard. `catch (Exception e) {}` turns a failure into silent wrong output.
- Wrap with context and keep the cause: `throw new OrderException("submit failed for " + id, e)`. Dropping `e` loses the only useful stack.
- Catch narrowly, and place the handler where you can actually do something about the error; do not catch `Throwable` or `Exception` at an intermediate layer just to log it.
- Log once at the boundary that decides the outcome, using the project's logger at the right level, not `printStackTrace()`.
- Use try-with-resources for every `AutoCloseable` (streams, connections, executors); it suppresses nothing and closes on every path.
- Return `Optional` for "may be absent" single values, and empty collections rather than `null` for "may be empty" aggregates. Never return `null` from a method whose name promises a collection.
- Preserve the project's exception hierarchy; do not throw raw `RuntimeException` where a domain type exists.

## Concurrency

- Use `java.util.concurrent` primitives (`ExecutorService`, `CompletableFuture`, concurrent collections) instead of raw `Thread` and hand-rolled `wait`/`notify`.
- Always shut down executors; a non-daemon executor that is never shut down keeps the process alive, and virtual threads (Java 21 and later) change neither the need for bounds nor the need for cleanup.
- Bound concurrency and queues; unbounded submission converts a slow downstream into an out-of-memory failure.
- Sharing mutable state requires `synchronized`, a lock, or an atomic class; `volatile` gives visibility, not atomicity.
- Prefer immutability and confinement. An immutable object is automatically safe to share.
- Do not hold a lock while calling remote I/O or user callbacks; escalate to a coarse design change rather than a longer critical section.
- Use `java.time` and its `DateTimeFormatter` (immutable and thread-safe) instead of the legacy date/time types, whose formatters are not.

## Testing

- Run the module's own test task (`./mvnw test`, `./gradlew test`) so the configured toolchain, JVM arguments, and System property overrides apply.
- JUnit 5 idioms when present: `@Test`, `@ParameterizedTest`, `@Nested` for grouping, `@TempDir` for filesystem work. Do not mix JUnit 4 annotations into a JUnit 5 module.
- Prefer real objects and in-memory implementations over mocks; mock at the boundary (HTTP client, clock, repository) and verify behavior, not implementation details.
- Use a fixed `Clock` for time-dependent logic instead of sleeping.
- Keep integration tests (Failsafe/`integrationTest`) separate from fast unit tests, following the repo's existing split.

## Anti-patterns

Swallowing exceptions.
```java
try {
    orderRepo.save(order);
} catch (Exception e) {
    e.printStackTrace();
}
```
The caller continues as if the order was persisted. Improved: propagate, or catch the specific persistence error and translate it into a domain failure the caller handles.

Logging and rethrowing without the cause.
```java
catch (SQLException e) {
    throw new ServiceException("save failed");
}
```
Improved: `throw new ServiceException("save failed for order " + id, e);` — the original stack survives.

Leaking or mutating internal collections.
```java
public List<Item> items() { return this.items; }
```
Callers can mutate the object's state. Improved: return `List.copyOf(items)` (or an unmodifiable view) and keep the field private.

Reference equality and shared mutable formatters.
```java
if (a == b) { ... }                        // Integer/String identity, not value
private static final SimpleDateFormat F = new SimpleDateFormat("yyyy-MM-dd");
```
Improved: `Objects.equals(a, b)` (or `.equals`) and a `java.time.format.DateTimeFormatter`, which is immutable and safe to share.

Ignoring resource lifecycle.
```java
ExecutorService pool = Executors.newFixedThreadPool(8);
// ... never shut down
```
Improved: hold the pool in a lifecycle-managed component that shuts it down on stop, or use try-with-resources where the scope allows.
