import { Table, TablesRelationalConfig } from "drizzle-orm";
import type { VSLogLevel } from "vsrepo";
import { DrizzleDbLike } from "./drizzle-db-like.type.js";
import { SupportedDialects } from "./supported-dialects.type.js";
import { AdapterRelations } from "./adapter-relations.type.js";

/**
 * Configuration object for the {@link DrizzleAdapter} constructor.
 *
 * @publicApi
 */
export type DrizzleAdapterConfig<T, K extends DrizzleDbLike = DrizzleDbLike> = {
    /**
     * The Drizzle `Table` object representing the entity's database table. The primary key is auto-detected from this table's column config.
     */
    table: Table;
    /**
     * The SQL dialect to use. Auto-detected from `table`'s own class (`PgTable` -> `"postgresql"`, `CockroachTable` -> `"cockroach"`, `SQLiteTable` -> `"sqlite"`)
     * when omitted; throws `NOT_SUPPORTED` if `table` isn't one of those three and `dialect` wasn't given. An explicit value always overrides detection. Affects placeholder
     * syntax, case-insensitive search behavior, and raw result interpretation.
     */
    dialect?: SupportedDialects;
    /**
     * The key in `db.query` that maps to this table's relational query builder (e.g. `"userTable"` for `db.query.userTable`).
     */
    queryKey: keyof K["query"];
    /**
     * Optional relation write config. Describes how relation fields in write payloads (`create`/`update`/`save`/`upsert`/`merge`) should be
     * resolved imperatively. When `relationsSchema` is also given, each field's `table`/`mode`/`fkHere`/`fkThere` is derived from it and only
     * needs to be spelled out here to override the derived value — `restriction` and `nullable` (defaults to `false` when omitted) still always have to be provided by hand.
     */
    relations?: AdapterRelations<T>;
    /**
     * Optional: the object returned by Drizzle's `defineRelations(schema, r => ({ ... }))` (the same one you pass to `drizzle(client, { relations })`).
     * When given, it drives two things: (1) `select`s with a relation field marked `true` are recognized at any nesting depth, not just the first level;
     * (2) relation write config (`relations` above) has its `table`/`mode`/`fkHere`/`fkThere` auto-derived per field.
     */
    relationsSchema?: TablesRelationalConfig;
    /**
     * Minimum log level for the adapter's internal `VSLogger`. @default VSLogLevel.WARN
     */
    logLevel?: VSLogLevel;
    /**
     * Duration (in ms) above which a finished operation is logged as `WARN`, flagging a potentially slow query, instead of the usual `DEBUG` line.
     * Pass `false` to disable slow-operation warnings entirely (every operation is then only ever logged at `DEBUG`); `true` (or omitting the field) uses the default of 300ms.
     */
    logSlowThresholdMs?: number | boolean;
};
