import { SupportedDialects } from "../types/supported-dialects.type.js";

/**
 * Candidate paths — probed in order — where each PostgreSQL/CockroachDB driver reports how many
 * rows a statement affected. There's no standard for this, so the shape is driver-specific:
 *
 * - `rowCount`: `pg` (and therefore `cockroach`, `neon-serverless`, `vercel-postgres`) and
 *   `minipg` — all expose a node-postgres-like `QueryResult`.
 * - `count`: `postgres-js`. Its raw result is a `RowList` — an *array* of rows carrying
 *   `count`/`command`/`statement`, with no `rows`/`rowCount` at all.
 * - `affectedRows`: `pglite` (`Results`).
 * - `numberOfRecordsUpdated`: `aws-data-api` (Aurora Serverless v2), where
 *   `ExecuteStatementResponse` reports DML counts under that name.
 */
const PG_AFFECTED_ROWS_PATHS: readonly (readonly string[])[] = [
    ["rowCount"],
    ["count"],
    ["affectedRows"],
    ["numberOfRecordsUpdated"],
];

/**
 * Candidate paths — probed in order — where each SQLite driver reports how many rows a
 * statement affected. Same story as {@link PG_AFFECTED_ROWS_PATHS}: no standard, driver-specific
 * shapes, and the `run()` result is returned to the adapter untouched.
 *
 * - `changes`: `better-sqlite3`, `bun:sqlite`, `node:sqlite`, `expo-sqlite`, and legacy
 *   `D1Result` (where `changes` sits at the top level).
 * - `rowsAffected`: `libsql` (`@libsql/client`'s `ResultSet`) and `op-sqlite` (`QueryResult`).
 * - `meta.changes` / `meta.rows_written`: newer `D1Result`, which nests the counters under `meta`.
 *
 * Drivers with no counter at all (`bun-sql`, `sql-js`, `durable-sqlite`, `sqlite-cloud`) simply
 * match nothing and fall back to `0` + `onUnrecognized`.
 */
const SQLITE_AFFECTED_ROWS_PATHS: readonly (readonly string[])[] = [
    ["changes"],
    ["rowsAffected"],
    ["meta", "changes"],
    ["meta", "rows_written"],
];

const AFFECTED_ROWS_PATHS: Record<SupportedDialects, readonly (readonly string[])[]> = {
    postgresql: PG_AFFECTED_ROWS_PATHS,
    cockroach: PG_AFFECTED_ROWS_PATHS,
    sqlite: SQLITE_AFFECTED_ROWS_PATHS,
};

/** Walks `path` over `source`, short-circuiting on `null`/`undefined` (e.g. `sql-js`'s `run(): void`). */
function readPath(source: unknown, path: readonly string[]): unknown {
    let current: unknown = source;

    for (const key of path) {
        if (current === null || current === undefined) return undefined;
        current = (current as Record<string, unknown>)[key];
    }

    return current;
}

/** Normalizes a probed value to a row count, rejecting anything that isn't a finite integer-ish number. */
function toAffectedRows(value: unknown): number | undefined {
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
}

/**
 * Interprets the raw result of a `run()`/`execute()` call into what the caller asked for: the
 * affected row count for a modifying statement, or the rows themselves for a read.
 *
 * The result shape is **driver-specific**, not dialect-specific, so this probes an ordered list
 * of candidate fields per dialect and takes the first one that's actually a number:
 *
 * | Dialect            | Fields probed, in order                                                             |
 * | ------------------ | ---------------------------------------------------------------------------------- |
 * | `postgresql`       | `rowCount`, `count`, `affectedRows`, `numberOfRecordsUpdated`                         |
 * | `cockroach`        | same as `postgresql`                                                                 |
 * | `sqlite`           | `changes`, `rowsAffected`, `meta.changes`, `meta.rows_written`                        |
 *
 * Reading: `sqlite` clients return the row array directly from `all()`, so the result passes
 * through untouched. PostgreSQL/CockroachDB clients return a wrapper object, so `.rows` is
 * unwrapped — but falls back to the result itself when there's no `.rows`, which is what
 * `postgres-js` (`RowList`, an array) and `bun-sql` (`Row[]`) hand back. Using `??` (not `||`)
 * keeps an empty-but-valid `rows: []` from being mistaken for "no wrapper".
 *
 * @param dialect - The configured dialect, which selects the candidate list.
 * @param result - The raw value returned by the client's `run()`/`execute()`.
 * @param modifying - When `true`, resolve to the affected row count; when `false`, to the rows.
 * @param onUnrecognized - Optional. Called with the probed paths (as a list of field paths) when
 *   none of them yielded a count (i.e. the driver doesn't expose a known counter). The count is
 *   still `0` either way.
 * @returns The affected row count, or the rows.
 */
export function resolveRawResult(
    dialect: SupportedDialects,
    result: any,
    modifying: boolean,
    onUnrecognized?: (triedPaths: readonly (readonly string[])[]) => void,
): unknown {
    if (!modifying) {
        // * `sqlite`: `all()` already hands back the row array as-is (better-sqlite3, libsql,
        // * op-sqlite, d1, ... all map to a plain array internally).
        if (dialect === "sqlite") return result;

        // * `pg`/`cockroach`: unwrap the wrapper's `.rows`, but keep the result itself when there's
        // * no `.rows` — that's the `RowList` (postgres-js) and `Row[]` (bun-sql) shape.
        return readPath(result, ["rows"]) ?? result;
    }

    const paths = AFFECTED_ROWS_PATHS[dialect];

    for (const path of paths) {
        const affected = toAffectedRows(readPath(result, path));
        if (affected !== undefined) return affected;
    }

    onUnrecognized?.(paths);
    return 0;
}
