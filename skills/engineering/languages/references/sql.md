# SQL

Covers schema changes, queries, and transaction logic, whether written directly or through an ORM.

## Tooling to discover in the repo

- Migration tool and directory: `migrations/`, `db/migrate/`, `sql/`, or a framework path, with tools such as Alembic, Flyway, Liquibase, Prisma Migrate, Knex, Django migrations, or Rails migrations. Use the project's tool; never hand-apply DDL.
- Migration naming and ordering convention (timestamped, sequential, versioned) — extend the existing scheme, do not introduce a second one.
- Engine and version: the container image, CI service definition, connection string documentation, or `docker-compose.yml`. Version decides available syntax and default isolation.
- Schema source of truth: an ORM model, a `schema.sql` dump, or a generated migration history. Changes must be expressed in whichever the project treats as canonical.
- Query layer: raw SQL files, a query builder, an ORM, or a stored-procedure directory.
- Existing indexes and constraints, readable from the schema dump or by querying the catalog tables.

## Error handling

- Put multi-statement writes in an explicit transaction and roll back on failure; a partially applied change is usually worse than a failed one.
- Distinguish integrity errors from infrastructure errors. Match on the driver's structured error code (for example a unique-violation code) instead of on message text.
- Do not swallow a constraint violation in application code; a returned conflict/duplicate is information the caller must handle.
- Retry only on the transient classes the engine documents as retryable; retry the whole transaction, not individual statements.
- Set statement and lock timeouts so a runaway query fails instead of holding locks indefinitely.
- Migrations must be able to fail cleanly: wrap the DDL according to the tool's transaction support, and for engines where DDL commits implicitly, plan the rollback statement in advance.

## Concurrency

- Know the isolation level in use. Under read-committed (the common default), a read-then-write pair is a lost-update race even inside a transaction.
- Prevent lost updates with an atomic statement (`UPDATE ... SET n = n + 1 WHERE ...`), a conditional update (`WHERE version = $expected`), or row locking (`SELECT ... FOR UPDATE`).
- Take locks in a consistent order across code paths; inconsistent ordering is the usual cause of deadlocks.
- Prefer short transactions. Never call a remote service or wait on user input while holding a transaction open.
- For queue-like patterns, a claim query that deletes or marks rows atomically (for example selecting with a skip-locked modifier on engines that support it) avoids double processing.
- Uniqueness in application code is not a constraint. Express the invariant in the schema so concurrent writers cannot violate it.

## Testing

- Run migrations in CI against a real engine of the same version; embedded substitutes accept syntax production rejects.
- Assert the migration is replayable: apply it to a database populated with representative data, not only to an empty one.
- Include a test for the query behavior under concurrency when the change depends on locking or isolation.
- Use `EXPLAIN`/`EXPLAIN ANALYZE` (or the engine's equivalent) on new queries over realistic data volume, and paste the plan into the review rather than asserting the query is fast.
- Seed deterministically; keep fixture data in the repo's existing seed scripts.

## Anti-patterns

String-interpolated SQL.
```sql
SELECT id FROM users WHERE email = '<user input>';
```
Injection. Improved: a parameterized statement, letting the driver bind the value and keep it out of the parse tree.

Read-modify-write without protection.
```sql
SELECT balance FROM accounts WHERE id = 1;   -- then compute in app code
UPDATE accounts SET balance = 4820 WHERE id = 1;
```
Two concurrent requests both read the old balance and one write is lost. Improved: `UPDATE accounts SET balance = balance - $amount WHERE id = 1 AND balance >= $amount;` and check the affected row count.

Editing an applied migration.
```
migrations/0003_add_status.sql   <- edited after it shipped
```
Environments that already ran it never see the change, and the history diverges. Improved: add a new migration.

`SELECT *` in application queries.
```sql
SELECT * FROM orders WHERE customer_id = $1;
```
The result set changes whenever a column is added, silently breaking decoders and moving unnecessary bytes. Improved: name the columns the caller needs.

N+1 queries from a loop.
```sql
-- one query per order, issued from a loop in application code
SELECT * FROM line_items WHERE order_id = $1;
```
Improved: fetch the set with `WHERE order_id = ANY($1)`, or join/`GROUP BY`, and assemble in memory.
