import { is, Table } from "drizzle-orm";
import { AdapterErrorCode, VSLogLevel, VSRepoAdapterError } from "vsrepo";
import { DrizzleAdapterConfig } from "../types/drizzle-adapter-config.type.js";
import { DrizzleDbLike } from "../types/drizzle-db-like.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import { SupportedDialects } from "../types/supported-dialects.type.js";
import { isPlainObject } from "./is-plain-object.validator.js";

const SUPPORTED_DIALECTS: ReadonlySet<SupportedDialects> = new Set(["postgresql", "sqlite", "cockroach"]);
const VALID_LOG_LEVELS = new Set(Object.values(VSLogLevel).filter((v): v is number => typeof v === "number"));

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
 *    calls later inside `findOne` (code `MODEL_NOT_FOUND`);
 *  - `config.relationsSchema`, when provided, is a plain object (the shape
 *    returned by Drizzle's `defineRelations()`) (code `INVALID_ADAPTER_CONFIG`);
 *  - `config.logLevel`, when provided, is a valid `VSLogLevel` (code `INVALID_ADAPTER_CONFIG`);
 *  - `config.logSlowThresholdMs`, when provided, is a `number` greater than 0 or a `boolean`
 *    (code `INVALID_ADAPTER_CONFIG`).
 */
export function validateDrizzleAdapterConfig<T, K extends DrizzleDbLike>(
    db: unknown,
    config: unknown,
): { db: K; config: DrizzleAdapterConfig<T, K> } {
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

    const { table, dialect, queryKey, relationsSchema, logLevel, logSlowThresholdMs } = config as DrizzleAdapterConfig<
        T,
        K
    >;

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

    if (relationsSchema !== undefined && !isPlainObject(relationsSchema)) {
        throw new VSRepoAdapterError(
            "Invalid constructor config (relationsSchema): expected the object returned by Drizzle's " +
                "'defineRelations()' (the same one passed to 'drizzle(client, { relations })'), mapping each " +
                "table's schema export key to its '{ table, name, relations }' config.",
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    if (logLevel !== undefined && !VALID_LOG_LEVELS.has(logLevel)) {
        throw new VSRepoAdapterError(
            `Invalid constructor config (logLevel): must be a valid VSLogLevel value (${[...VALID_LOG_LEVELS].join(", ")}).`,
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    if (
        logSlowThresholdMs !== undefined &&
        typeof logSlowThresholdMs !== "boolean" &&
        (typeof logSlowThresholdMs !== "number" || logSlowThresholdMs <= 0)
    ) {
        throw new VSRepoAdapterError(
            "Invalid constructor config (logSlowThresholdMs): must be a number greater than 0, or a boolean.",
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

    return { db: db as K, config: config as DrizzleAdapterConfig<T, K> };
}
