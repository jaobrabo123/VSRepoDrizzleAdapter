/**
 * SQL dialects supported by the Drizzle adapter.
 *
 * - `"postgresql"` — PostgreSQL (default). Uses `ILIKE` for case-insensitive searches and `$1, $2, ...` placeholders.
 * - `"sqlite"` — SQLite. Uses `LIKE` (case-insensitive for ASCII by default) and `?` placeholders.
 * - `"cockroach"` — CockroachDB. Same behavior as PostgreSQL.
 *
 * @publicApi
 */
export type SupportedDialects = "postgresql" | "sqlite" | "cockroach";
