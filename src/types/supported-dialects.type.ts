/**
 * SQL dialects supported by the Drizzle adapter.
 *
 * - `"postgresql"` — PostgreSQL. Uses `ILIKE` for case-insensitive searches and `$1, $2, ...` placeholders.
 * - `"sqlite"` — SQLite. Uses `LIKE` (case-insensitive for ASCII by default) and `?` placeholders.
 * - `"cockroach"` — CockroachDB. Same behavior as PostgreSQL.
 *
 * When omitted from the constructor config, it's auto-detected from the table's own
 * Drizzle class (`PgTable`/`CockroachTable`/`SQLiteTable`).
 *
 * @publicApi
 */
export type SupportedDialects = "postgresql" | "sqlite" | "cockroach";
