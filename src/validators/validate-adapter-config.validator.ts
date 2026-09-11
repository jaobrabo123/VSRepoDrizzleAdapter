import { is, Table } from "drizzle-orm";
import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { DrizzleAdapterConfig } from "../types/drizzle-adapter-config.type.js";
import { DrizzleDbLike } from "../types/drizzle-db-like.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import { SupportedDialects } from "../types/supported-dialects.type.js";

const SUPPORTED_DIALECTS: ReadonlySet<SupportedDialects> = new Set([
    "postgresql",
    "mysql",
    "sqlite",
    "singlestore",
    "mssql",
    "cockroach",
]);

/**
 * Validates the two arguments received by `DrizzleAdapter`'s constructor
 * (`db` and `config`), failing fast — with a clear `VSRepoAdapterError` —
 * instead of letting the adapter break later, on the first query, with a
 * generic runtime error (`Cannot read properties of undefined`, etc.).
 *
 * Checks, in order:
 *  - `db` isn't null/undefined (code `MISSING_DB_CLIENT`);
 *  - `db.query` is an object — only present when the client was created with
 *    Drizzle's `relations` config, e.g. `drizzle(connection, { relations })`
 *    (code `MISSING_DB_CLIENT`);
 *  - `config` isn't null/undefined (code `INVALID_ADAPTER_CONFIG`);
 *  - `config.table` is a Drizzle `Table` instance (code `INVALID_ADAPTER_CONFIG`);
 *  - `config.dialect`, when provided, is one of `SupportedDialects` (code `INVALID_ADAPTER_CONFIG`);
 *  - `config.queryKey` is a non-empty string (code `INVALID_ADAPTER_CONFIG`);
 *  - `db.query[config.queryKey]` exists and exposes `findFirst`/`findMany` —
 *    catches a typo'd/mismatched `queryKey` in the constructor, not three
 *    calls later inside `findOne` (code `MODEL_NOT_FOUND`).
 */
export function validateDrizzleAdapterConfig<K extends DrizzleDbLike>(
    db: unknown,
    config: unknown,
): { db: K; config: DrizzleAdapterConfig<K> } {
    if (db === null || db === undefined) {
        throw new VSRepoAdapterError(
            "Missing Drizzle client: the first constructor argument (db) is null/undefined.",
            AdapterErrorCode.MISSING_DB_CLIENT,
            null,
        );
    }

    const dbLike = db as DrizzleDbLike;

    if (typeof dbLike.query !== "object" || dbLike.query === null) {
        throw new VSRepoAdapterError(
            "Invalid Drizzle client: 'db.query' is undefined — the client must be created with the 'relations' " +
                "config (e.g. 'drizzle(connection, { relations })') for DrizzleAdapter to run relational queries.",
            AdapterErrorCode.MISSING_DB_CLIENT,
            null,
        );
    }

    if (config === null || config === undefined) {
        throw new VSRepoAdapterError(
            "Invalid constructor config: the second constructor argument (config) is null/undefined.",
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    const { table, dialect, queryKey } = config as DrizzleAdapterConfig<K>;

    if (!is(table, Table)) {
        throw new VSRepoAdapterError(
            "Invalid constructor config (table): expected a Drizzle 'Table' instance (the object exported by " +
                "your schema, e.g. 'userTable').",
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    if (dialect !== undefined && !SUPPORTED_DIALECTS.has(dialect)) {
        throw new VSRepoAdapterError(
            `Invalid constructor config (dialect): '${String(dialect)}' is not supported. Expected one of: ` +
                `${[...SUPPORTED_DIALECTS].join(", ")}.`,
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    if (typeof queryKey !== "string" || queryKey.length === 0) {
        throw new VSRepoAdapterError(
            "Invalid constructor config (queryKey): expected a non-empty string matching a key of 'db.query' " +
                "(the name your schema exports the table under, e.g. 'userTable').",
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    const queryEntry = (dbLike.query as PlainObject)[queryKey];

    if (
        typeof queryEntry !== "object" ||
        queryEntry === null ||
        typeof (queryEntry as PlainObject).findFirst !== "function" ||
        typeof (queryEntry as PlainObject).findMany !== "function"
    ) {
        throw new VSRepoAdapterError(
            `Invalid constructor config (queryKey): no relational query builder found for '${queryKey}' on ` +
                `'db.query' (expected 'db.query.${queryKey}' to exist — check that '${queryKey}' matches the name ` +
                `your schema exports the table under, and that the table is included in the 'relations' config).`,
            AdapterErrorCode.MODEL_NOT_FOUND,
            null,
        );
    }

    return { db: db as K, config: config as DrizzleAdapterConfig<K> };
}
