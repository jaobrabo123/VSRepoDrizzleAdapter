import { avg, count as countFn, eq, inArray, max as maxFn, min as minFn, sql, sum as sumFn, Table } from "drizzle-orm";
import {
    AdapterErrorCode,
    AdapterMethodOptions,
    AdapterQueryOptions,
    CountResult,
    DeepPartial,
    NumericKeys,
    VSLogger,
    VSLogLevel,
    VSRepoAdapter,
    VSRepoAdapterError,
    VSRepoTransactionOptions,
    VSRepoWhere,
} from "vsrepo";
import { DrizzleAdapterConfig } from "./types/drizzle-adapter-config.type.js";
import { DrizzleDbLike } from "./types/drizzle-db-like.type.js";
import { SupportedDialects } from "./types/supported-dialects.type.js";
import { resolveTableConfig } from "./resolvers/table-config.resolver.js";
import { DrizzleTransactionLike } from "./types/drizzle-transaction-like.type.js";
import { resolveIsolationLevel } from "./resolvers/isolation-level.resolver.js";
import { resolveRawSql } from "./resolvers/raw-sql.resolver.js";
import { resolveRawResult } from "./resolvers/raw-result.resolver.js";
import { mapDrizzleError } from "./resolvers/map-drizzle-error.resolver.js";
import { validateDrizzleAdapterConfig } from "./validators/validate-adapter-config.validator.js";
import { validateRelations } from "./validators/validate-relations.validator.js";
import { parseColumns } from "./parsers/columns.parser.js";
import { parseWith } from "./parsers/with.parser.js";
import { parseDrizzleWhere, hasQuantifierFilter } from "./parsers/where.parser.js";
import { parseSqlWhere, SqlWhereContext } from "./parsers/sql-where.parser.js";
import { parseOrderBy } from "./parsers/order-by.parser.js";
import { parseSqlOrderBy } from "./parsers/sql-order-by.parser.js";
import { parseDistinctOn } from "./parsers/distinct-on.parser.js";
import { PlainObject } from "./types/plain-object.type.js";
import { ResolvedRelation } from "./types/resolved-relation.type.js";
import { RelationsResolver } from "./types/relations-resolver.type.js";
import { createFlatRelationsResolver, createRelationsResolver } from "./resolvers/relations-resolver.resolver.js";
import { mergeEntities } from "./resolvers/merge-entities.resolver.js";
import { resolveFkHereFields, resolveFkThereFields, splitWritePayload } from "./resolvers/relation-writes.resolver.js";

/**
 * `VSRepoAdapter` implementation backed by Drizzle ORM.
 *
 * Translates every `VSRepository` operation into Drizzle calls:
 * - **Reads** use the relational query API (`db.query[queryKey].findFirst/findMany`)
 *   with `columns`, `with`, `where`, `orderBy`, `limit`, and `offset`. `findMany`'s
 *   `distinct` is the one exception — Postgres-only, via `db.selectDistinctOn(...)`.
 * - **Writes** use the core query builders (`db.insert`, `db.update`, `db.delete`)
 *   with imperative relation resolution when a `relations` config is provided.
 * - **Raw SQL** uses `db.execute` with dialect-aware placeholder substitution.
 *
 * Supports PostgreSQL, SQLite, and CockroachDB dialects.
 *
 * @typeParam T - The entity type this adapter operates on.
 * @typeParam K - The Drizzle database client type (inferred from the `db` argument).
 *
 * @publicApi
 */
export class DrizzleAdapter<T, K extends DrizzleDbLike = DrizzleDbLike> extends VSRepoAdapter<T> {
    private readonly table: Table;
    private readonly db: DrizzleDbLike;
    private readonly dialect: SupportedDialects;
    private readonly pk: string;
    private readonly queryKey: keyof K["query"];
    private readonly relations?: Map<string, ResolvedRelation>;
    private readonly relationsResolver?: RelationsResolver;
    private readonly logger: VSLogger;

    /**
     * Creates a new Drizzle adapter instance.
     *
     * The constructor validates the provided `db` client and `config` (table, queryKey,
     * dialect, relations, relationsSchema) and throws a `VSRepoAdapterError` if any field
     * is invalid. The primary key is auto-detected from the Drizzle table's column definitions,
     * and so is the dialect — from the table's own class (`PgTable`/`CockroachTable`/`SQLiteTable`)
     * — unless `dialect` is given explicitly, which always wins (see `resolveTableConfig`).
     *
     * @param db - The Drizzle database client instance.
     * @param config - Adapter configuration: table, queryKey, optional dialect, relations, relationsSchema, logLevel and logSlowThresholdMs.
     *
     * @publicApi
     */
    constructor(db: K, config: DrizzleAdapterConfig<T, K>) {
        super();

        const validated = validateDrizzleAdapterConfig<T, K>(db, config);

        this.db = validated.db;
        this.table = validated.config.table;
        this.queryKey = validated.config.queryKey;

        const { pk, dialect } = resolveTableConfig(this.table, validated.config.dialect);
        this.pk = pk;
        this.dialect = dialect;

        const relationsSchema = validated.config.relationsSchema;

        this.relations = validateRelations<T>(
            this.table,
            validated.config.relations,
            this.dialect,
            relationsSchema,
            this.queryKey as string,
        );

        if (relationsSchema) {
            this.relationsResolver = createRelationsResolver(relationsSchema, this.queryKey as string);
        } else if (this.relations) {
            this.relationsResolver = createFlatRelationsResolver(new Set(this.relations.keys()));
        }

        this.logger = new VSLogger(
            validated.config.logLevel ?? VSLogLevel.WARN,
            this.constructor.name + "Logger",
            validated.config.logSlowThresholdMs ?? 300,
        );

        this.logger.logInfo(
            `${this.constructor.name} initialized for table '${this.queryKey as string}' (dialect: '${this.dialect}', pk: '${this.pk}'` +
                `${this.relations ? `, relations: [${[...this.relations.keys()].join(", ")}]` : ""})`,
        );
    }

    /**
     * Returns `db.query[queryKey]` (the relational query builder entry for
     * this adapter's table), reading from `db` when a transaction/executor
     * override is passed via `options.db`, otherwise from the root client.
     */
    private getQueryBuilder(db?: unknown): {
        findFirst: (arg: PlainObject) => Promise<any>;
        findMany: (arg: PlainObject) => Promise<any>;
    } {
        const executor = (db as DrizzleDbLike | undefined) ?? this.db;
        return executor.query[this.queryKey as string] as any;
    }

    /**
     * Resolves the "read" part of a query arg: `columns`/`with`/`where`/
     * `orderBy`/pagination.
     *
     * Per the adapter contract: when both `select` and `relations` are
     * given, `select` wins and `relations` is ignored entirely.
     *
     * When `select` contains a relation field marked as `true`, `parseColumns`
     * only routes it to `with` if that field is recognized as a relation by
     * `this.relationsResolver` — otherwise it's treated as a column and the
     * query fails. `relationsResolver` is built from `relationsSchema` when
     * given (recognizes relations-of-relations too, at any depth) or, as a
     * fallback, from the constructor's write-only `relations` config
     * (single level only — see `parseColumns` docs).
     *
     * `distinct` (only ever passed by `findMany`, for the `postgresql`
     * dialect) is forwarded to `resolveFindWhere`, which runs it through the
     * same pk-prefetch path as `_every`/`_none` — see its docs.
     */
    private async resolveReadArgs(
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
        single = false,
        distinct?: (keyof T)[],
    ): Promise<PlainObject> {
        options ??= {};

        let columns: PlainObject | undefined;
        let withArg: PlainObject | undefined;

        if (options.select) {
            const parsedSelect = parseColumns(options.select, this.relationsResolver);
            columns = parsedSelect.columns;
            withArg = parsedSelect.with;
        } else if (options.relations) {
            withArg = parseWith(options.relations);
        }

        const found = await this.resolveFindWhere(where, {
            db: options.db,
            order: options.order,
            limit: single ? 1 : options.pagination?.limit,
            offset: single ? undefined : options.pagination?.offset,
            distinct,
        });

        return {
            where: found.where,
            columns,
            with: withArg,
            // When the prefetch already applied limit/offset, `IN (pks)` no longer preserves that
            // order on its own, so the same ordering has to be re-applied at this level too — but
            // limit/offset themselves must NOT be re-applied, since the pk set is already the exact page.
            orderBy: found.paginationApplied ? found.orderBy : parseOrderBy<T>(options.order),
            limit: found.paginationApplied ? undefined : options.pagination?.limit,
            offset: found.paginationApplied ? undefined : options.pagination?.offset,
        };
    }

    /** Builds the context `parseSqlWhere` needs to resolve `_with`/`_without`/`_some`/`_every`/`_none` relation filters. */
    private getSqlWhereContext(db?: unknown): SqlWhereContext {
        return {
            table: this.table,
            pk: this.pk,
            relations: this.relations,
            db: (db as DrizzleDbLike | undefined) ?? this.db,
        };
    }

    /**
     * Resolves a user-supplied `VSRepoWhere<T>` into the `where` shape the
     * relational query API (`db.query[queryKey].findFirst/findMany`) accepts.
     *
     * The relational API's own object-shaped `where` (`where.parser.ts`) has
     * no native `_every`/`_none` semantics for to-many relations — so when
     * `where` contains one (`hasQuantifierFilter`), this instead:
     *  1. Resolves `where` into a `SQL` condition via `sql-where.parser.ts`
     *     (which DOES support `_every`/`_none`, via `NOT EXISTS`);
     *  2. Runs `db.select({pk}).from(table).where(condition)`, applying the
     *     SAME `order`/`limit`/`offset` the final query would've used
     *     (`sql-order-by.parser.ts`), so the prefetch only ever pulls the
     *     rows the caller actually needs, instead of every matching row;
     *  3. Returns `parseDrizzleWhere({ [pk]: { in: pks } })` instead — the
     *     relational API then only has to filter by pk (trivial for it),
     *     while still handling `columns`/`with` on the correct result set.
     *
     * Since SQL `IN (...)` doesn't preserve the given list's order, `resolveReadArgs`
     * re-applies `orderBy` (but NOT `limit`/`offset`, already baked into the pk set)
     * on the final relational query when `paginationApplied` comes back `true`.
     *
     * This keeps `_every`/`_none` support consistent between this adapter's
     * two `where` parsers — from the outside, `findOne`/`findMany`/etc. never
     * throw `NOT_SUPPORTED` for them, at the cost of an extra round-trip only
     * when they're actually used.
     *
     * `opts.distinct` (only ever passed by `findMany`, and only for the
     * `postgresql` dialect) takes this same prefetch path, but via
     * `db.selectDistinctOn(...)` (`parseDistinctOn`) instead of a plain
     * `db.select(...)` — the relational query API has no `distinct` of its
     * own either, so deduping has to happen at this pk-prefetch level too.
     * Unlike the `_every`/`_none` branch, this one runs whenever `distinct`
     * is given, regardless of `hasQuantifierFilter`.
     */
    private async resolveFindWhere(
        where: VSRepoWhere<T>,
        opts?: {
            db?: unknown;
            order?: AdapterMethodOptions<T>["order"];
            limit?: number;
            offset?: number;
            distinct?: (keyof T)[];
        },
    ): Promise<{ where: PlainObject | undefined; orderBy?: PlainObject; paginationApplied: boolean }> {
        if (opts?.distinct === undefined && !hasQuantifierFilter(where)) {
            return { where: parseDrizzleWhere<T>(where, this.dialect), paginationApplied: false };
        }

        const executor = (opts?.db as DrizzleDbLike | undefined) ?? this.db;
        const pkColumn = (this.table as unknown as PlainObject)[this.pk];
        const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));

        let qb: any;

        if (opts?.distinct !== undefined) {
            const distinctOn = parseDistinctOn<T>(this.table, opts.distinct, opts.order);
            qb = (executor as any)
                .selectDistinctOn(distinctOn.columns, { pk: pkColumn })
                .from(this.table)
                .where(condition)
                .orderBy(...distinctOn.orderBy);
        } else {
            const sqlOrderBy = parseSqlOrderBy<T>(this.table, opts?.order);
            qb = (executor as any).select({ pk: pkColumn }).from(this.table).where(condition);
            if (sqlOrderBy) qb = qb.orderBy(...sqlOrderBy);
        }

        if (opts?.limit !== undefined) qb = qb.limit(opts.limit);
        if (opts?.offset !== undefined) qb = qb.offset(opts.offset);

        const rows = await qb;
        const pks = rows.map((row: PlainObject) => row.pk);

        return {
            where: parseDrizzleWhere<T>({ [this.pk]: { in: pks } } as unknown as VSRepoWhere<T>, this.dialect),
            orderBy: parseOrderBy<T>(opts?.order),
            paginationApplied: opts?.limit !== undefined || opts?.offset !== undefined,
        };
    }

    /**
     * Fetches the current row matching `where` (or `null` when none exists),
     * using the same where-resolution path as `update` — the single place
     * "find the row behind a where" is materialized.
     *
     * Internal callers that already fetched a row in their own transaction
     * (`save`, `upsert`) use this to detect/create, then hand that same row
     * to `updateCore` as `current`, so the row is only ever read once.
     */
    private async findCurrentByWhere(where: VSRepoWhere<T>, opts?: { db?: unknown }): Promise<PlainObject | null> {
        const arg = {
            where: (await this.resolveFindWhere(where, { db: opts?.db, limit: 1 })).where,
        };
        return (await this.getQueryBuilder(opts?.db).findFirst(arg)) ?? null;
    }

    /**
     * Strips relation fields from a payload — used by `createMany`/`updateMany`/
     * `updateManyReturning`, since batch statements only accept flat column
     * data (no nested writes). Throws `VSRepoAdapterError` (code `NOT_SUPPORTED`).
     */
    private stripRelationFields(obj: PlainObject): PlainObject {
        if (!this.relations) return obj;

        const data: PlainObject = {};

        for (const [key, value] of Object.entries(obj)) {
            if (value === undefined) continue;

            if (this.relations.has(key)) {
                throw new VSRepoAdapterError(
                    `Field '${key}' is a configured relation, but this adapter's *Many operations don't support nested relation writes.`,
                    AdapterErrorCode.NOT_SUPPORTED,
                    null,
                );
            }

            data[key] = value;
        }

        return data;
    }

    private isRootClient(db: any): boolean {
        return typeof db?.rollback !== "function";
    }

    private async runTransactional<R>(db: any, fn: (tx: DrizzleTransactionLike) => Promise<R>): Promise<R> {
        if (db && !this.isRootClient(db)) {
            this.logger.logDebug("Reusing an already-active transaction client");
            return fn(db);
        }

        return ((db as DrizzleDbLike) ?? this.db).transaction(fn);
    }

    /**
     * Executes `fn` inside a new database transaction.
     *
     * Supports `isolationLevel` but does **not** support `timeoutMs` (throws `NOT_SUPPORTED`).
     *
     * @param fn - Callback receiving the transaction client. Call `tx.rollback()` to abort.
     * @param options - Optional transaction options (`isolationLevel`).
     * @returns The value returned by `fn`.
     *
     * @publicApi
     */
    async runInTransaction<R>(
        fn: (tx: DrizzleTransactionLike) => Promise<R>,
        options?: VSRepoTransactionOptions,
    ): Promise<R> {
        if (options?.timeoutMs !== undefined) {
            throw new VSRepoAdapterError(
                "This adapter doesn't support 'timeoutMs' in transactions.",
                AdapterErrorCode.NOT_SUPPORTED,
                null,
            );
        }

        const start = this.logger.startPerformLog("run runInTransaction");

        try {
            return await this.db.transaction(fn, {
                isolationLevel: options?.isolationLevel && resolveIsolationLevel(options.isolationLevel),
            });
        } catch (error) {
            throw mapDrizzleError(error, "runInTransaction", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Returns the root Drizzle database client passed to the constructor.
     *
     * @publicApi
     */
    getDbClient(): DrizzleDbLike {
        return this.db;
    }

    /**
     * Executes a raw SQL query string against the database.
     *
     * Placeholders are dialect-aware: `$1, $2, ...` for PostgreSQL/CockroachDB, `?` for SQLite.
     *
     * @param rawQuery - The raw SQL string.
     * @param options - Optional: `args` (bind parameters), `db` (transaction client), `modifying` (if `true`, returns affected row count instead of rows).
     * @returns The query result — rows for SELECT, affected count for modifying statements.
     *
     * @publicApi
     */
    async query<R = any>(rawQuery: string, options?: AdapterQueryOptions): Promise<R> {
        const executor = (options?.db as DrizzleTransactionLike | undefined) ?? this.db;
        const start = this.logger.startPerformLog("run query");

        try {
            const sqlQuery = resolveRawSql(this.dialect, rawQuery, options?.args);
            this.logger.logDebug("Resolved raw SQL for 'query'", {
                rawQuery,
                args: options?.args,
                modifying: options?.modifying,
            });

            const result = await executor.execute(sqlQuery);

            return resolveRawResult(this.dialect, result, options?.modifying ?? false) as R;
        } catch (error) {
            throw mapDrizzleError(error, "query", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Finds the first record matching `where`, or returns `null` if none exists.
     *
     * @publicApi
     */
    async findOne(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T | null> {
        const start = this.logger.startPerformLog("run findOne");

        try {
            const arg = await this.resolveReadArgs(where, options, true);
            this.logger.logDebug("Resolved Drizzle arg for 'findOne'", arg);

            const result = await this.getQueryBuilder(options?.db).findFirst(arg);

            return (result ?? null) as T | null;
        } catch (error) {
            throw mapDrizzleError(error, "findOne", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Finds the first record matching `where`, or throws a `VSRepoAdapterError`
     * (code `NOT_FOUND`) if none exists.
     *
     * @publicApi
     */
    async findOneOrThrow(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run findOneOrThrow");

        try {
            const arg = await this.resolveReadArgs(where, options, true);
            this.logger.logDebug("Resolved Drizzle arg for 'findOneOrThrow'", arg);

            const result = await this.getQueryBuilder(options?.db).findFirst(arg);

            if (!result) {
                throw new VSRepoAdapterError(
                    "'findOneOrThrow' found no record matching the given 'where'.",
                    AdapterErrorCode.NOT_FOUND,
                    null,
                );
            }

            return result as T;
        } catch (error) {
            throw mapDrizzleError(error, "findOneOrThrow", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Finds all records matching `where`.
     *
     * `distinct` is only supported for the `postgresql` dialect, via
     * `db.selectDistinctOn(...)` — Drizzle's relational query API
     * (`db.query[queryKey].findMany`) has no `distinct` option of its own,
     * so this adapter first prefetches the deduped rows' pks with the core
     * query builder (see `resolveFindWhere`), then re-fetches them through
     * the relational API so `select`/`relations` still apply normally. When
     * both `distinct` and `order` are given, `order` also decides which row
     * "wins" each distinct group (e.g. `distinct: ["userId"]` combined with
     * `order: { createdAt: "desc" }` keeps each user's most recent row).
     * For any other dialect, passing `distinct` throws `NOT_SUPPORTED`.
     *
     * @publicApi
     */
    async findMany(
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T> & { distinct?: (keyof T)[] },
    ): Promise<T[]> {
        if (options?.distinct !== undefined && this.dialect !== "postgresql") {
            throw new VSRepoAdapterError(
                `This adapter only supports 'distinct' in 'findMany' for the 'postgresql' dialect (uses ` +
                    `'selectDistinctOn', which is Postgres-specific) — this instance is configured for '${this.dialect}'.`,
                AdapterErrorCode.NOT_SUPPORTED,
                null,
            );
        }

        const start = this.logger.startPerformLog("run findMany");

        try {
            const arg = await this.resolveReadArgs(where, options, false, options?.distinct);
            this.logger.logDebug("Resolved Drizzle arg for 'findMany'", arg);

            return (await this.getQueryBuilder(options?.db).findMany(arg)) as T[];
        } catch (error) {
            throw mapDrizzleError(error, "findMany", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Creates or updates (upserts) a single record.
     *
     * If the payload has no primary key value, delegates to {@link create}. Otherwise,
     * checks if a record with that PK exists: if it does, updates it; if not, creates it.
     * Relation fields are resolved according to the constructor `relations` config.
     *
     * @publicApi
     */
    async save(obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run save");

        try {
            const objAny = obj as unknown as PlainObject;
            const pkValue = objAny[this.pk];

            if (pkValue === undefined) {
                this.logger.logDebug("'save': no pk in payload — delegating to 'create'");
                return await this.create(obj, options);
            }

            return await this.runTransactional(options?.db, async tx => {
                const current = await this.findCurrentByWhere({ [this.pk]: pkValue } as unknown as VSRepoWhere<T>, {
                    db: tx,
                });

                if (current === null) {
                    this.logger.logDebug(
                        `'save': no record found for pk '${String(pkValue)}' — delegating to 'create'`,
                    );
                    return this.create(obj, { ...options, db: tx });
                }

                this.logger.logDebug(`'save': record found for pk '${String(pkValue)}' — delegating to 'update'`);

                // The row was already read in this tx — hand it to the core so the
                // update path doesn't re-fetch the same row a second time.
                return this.updateCore(
                    { [this.pk]: pkValue } as unknown as VSRepoWhere<T>,
                    obj,
                    { ...options, db: tx },
                    current,
                );
            });
        } catch (error) {
            throw mapDrizzleError(error, "save", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Creates or updates multiple records in a single transaction.
     *
     * Each object in `objs` is passed to {@link save} individually, all within the same
     * transaction. If `options.db` is already a transaction, it's reused.
     *
     * @publicApi
     */
    async saveMany(objs: DeepPartial<T>[], options?: AdapterMethodOptions<T>): Promise<T[]> {
        const start = this.logger.startPerformLog("run saveMany");

        try {
            this.logger.logDebug(`'saveMany': saving ${objs.length} record(s)`);
            return await this.runTransactional(options?.db, tx =>
                Promise.all(objs.map(obj => this.save(obj, { ...options, db: tx }))),
            );
        } catch (error) {
            throw mapDrizzleError(error, "saveMany", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Inserts a new record into the database.
     *
     * Relation fields are resolved according to the constructor `relations` config:
     * `fkHere` relations are resolved before the main insert, `fkThere` relations after.
     * Returns the full entity (with relations, if requested via `options`).
     *
     * @publicApi
     */
    async create(obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run create");

        try {
            return await this.runTransactional(options?.db, async tx => {
                const objAny = obj as unknown as PlainObject;

                const { scalarFields, fkHereEntries, fkThereEntries } = splitWritePayload(
                    objAny,
                    this.relations,
                    this.pk,
                    false,
                );

                if (fkHereEntries.length > 0 || fkThereEntries.length > 0) {
                    this.logger.logDebug(
                        `'create': resolving relations — fkHere: [${fkHereEntries.map(([key]) => key).join(", ")}], ` +
                            `fkThere: [${fkThereEntries.map(([key]) => key).join(", ")}]`,
                    );
                }

                await resolveFkHereFields(tx, fkHereEntries, scalarFields, undefined, true, this.logger);

                this.logger.logDebug("Resolved Drizzle scalar fields for 'create'", scalarFields);

                const [created] = await (tx as any)
                    .insert(this.table)
                    .values(scalarFields)
                    .returning({ [this.pk]: (this.table as any)[this.pk] });
                const ownPkValue = created[this.pk];

                await resolveFkThereFields(tx, fkThereEntries, ownPkValue, true, this.logger);

                const readArg = await this.resolveReadArgs({ [this.pk]: ownPkValue } as unknown as VSRepoWhere<T>, {
                    ...options,
                    db: tx,
                });
                const result = await this.getQueryBuilder(tx).findFirst(readArg);

                return result as T;
            });
        } catch (error) {
            throw mapDrizzleError(error, "create", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Inserts multiple records in a single batch statement.
     *
     * Does **not** support relation fields in the payload — throws `NOT_SUPPORTED` if any
     * configured relation field is present. Use {@link create} or {@link saveMany} for nested writes.
     *
     * @publicApi
     */
    async createMany(
        objs: DeepPartial<T>[],
        options?: AdapterMethodOptions<T> & { ignoreConflicts?: boolean },
    ): Promise<CountResult> {
        const start = this.logger.startPerformLog("run createMany");

        try {
            const data = objs.map(obj => this.stripRelationFields(obj as unknown as PlainObject));
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;

            this.logger.logDebug(`Resolved Drizzle arg for 'createMany' (${data.length} row(s))`, {
                data,
                ignoreConflicts: options?.ignoreConflicts,
            });

            let qb = (executor as any).insert(this.table).values(data);
            if (options?.ignoreConflicts) qb = qb.onConflictDoNothing();

            const result = await qb;
            const affected = resolveRawResult(this.dialect, result, true) as number;

            return { count: affected };
        } catch (error) {
            throw mapDrizzleError(error, "createMany", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Inserts multiple records and returns the created entities.
     *
     * Does **not** support relation fields in the payload. The returned records are
     * re-queried via `findMany` by PK, so order is not guaranteed unless `order` is provided.
     *
     * @publicApi
     */
    async createManyReturning(
        objs: DeepPartial<T>[],
        options?: AdapterMethodOptions<T> & { ignoreConflicts?: boolean },
    ): Promise<T[]> {
        const start = this.logger.startPerformLog("run createManyReturning");

        try {
            const data = objs.map(obj => this.stripRelationFields(obj as unknown as PlainObject));
            this.logger.logDebug(`Resolved Drizzle arg for 'createManyReturning' (${data.length} row(s))`, {
                data,
                ignoreConflicts: options?.ignoreConflicts,
            });

            return await this.runTransactional(options?.db, async tx => {
                let qb = tx.insert(this.table).values(data);
                if (options?.ignoreConflicts) qb = qb.onConflictDoNothing();

                const created = await qb.returning({ [this.pk]: (this.table as any)[this.pk] });

                const readArg = await this.resolveReadArgs(
                    { [this.pk]: { in: created.map((_: any) => _[this.pk]) } } as unknown as VSRepoWhere<T>,
                    { ...options, db: tx },
                );
                const result = await this.getQueryBuilder(tx).findMany(readArg);

                return result as T[];
            });
        } catch (error) {
            throw mapDrizzleError(error, "createManyReturning", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Deletes a single record matching `where` and returns it.
     *
     * Throws `NOT_FOUND` if no record matches.
     *
     * @publicApi
     */
    async delete(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run delete");

        try {
            return await this.runTransactional(options?.db, async tx => {
                const readArg = await this.resolveReadArgs(where, { ...options, db: tx }, true);
                this.logger.logDebug("Resolved Drizzle arg for 'delete'", readArg);

                const columnsWithoutPk = readArg.columns && !readArg.columns[this.pk];

                // * Precisa injetar a pk para poder acessar no where lá em baixo
                if (columnsWithoutPk) {
                    readArg.columns[this.pk] = true;
                }

                const current = await this.getQueryBuilder(tx).findFirst(readArg);

                if (!current) {
                    throw new VSRepoAdapterError(
                        "'delete' found no record matching the given 'where'.",
                        AdapterErrorCode.NOT_FOUND,
                        null,
                    );
                }

                const pkColumn = (this.table as PlainObject)[this.pk];
                await tx.delete(this.table).where(eq(pkColumn, current[this.pk]));

                // * Retira a pk do retorno se o usuário não solicitou
                if (columnsWithoutPk) {
                    delete current[this.pk];
                }

                return current as T;
            });
        } catch (error) {
            throw mapDrizzleError(error, "delete", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Deletes all records matching `where`.
     *
     * @returns A `CountResult` with the number of deleted rows.
     *
     * @publicApi
     */
    async deleteMany(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<CountResult> {
        const start = this.logger.startPerformLog("run deleteMany");

        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));
            this.logger.logDebug("Resolved Drizzle condition for 'deleteMany'", { where });

            const result = await (executor as any).delete(this.table).where(condition);
            const affected = resolveRawResult(this.dialect, result, true) as number;

            return { count: affected ?? 0 };
        } catch (error) {
            throw mapDrizzleError(error, "deleteMany", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Deletes all records matching `where` and returns them.
     *
     * Runs a `findMany` on `where` first (to capture the records and their PKs), then deletes
     * by `inArray(pk, pks)` instead of re-applying `where` — so the deleted rows are exactly the
     * ones returned, even if another row starts/stops matching `where` between the two steps.
     *
     * This does not make the operation fully atomic: a row can still be concurrently modified or
     * deleted between the `findMany` and the `delete` by pk, in which case the returned record's
     * non-pk fields may be stale, or that pk may no longer match any row (silently deleting 0 for
     * it). Run inside a `transaction()` at a higher isolation level if you need strict consistency.
     *
     * @publicApi
     */
    async deleteManyReturning(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T[]> {
        const start = this.logger.startPerformLog("run deleteManyReturning");

        try {
            return await this.runTransactional(options?.db, async tx => {
                const readArg = await this.resolveReadArgs(where, { ...options, db: tx });
                this.logger.logDebug("Resolved Drizzle arg for 'deleteManyReturning'", readArg);

                const columnsWithoutPk = readArg.columns && !readArg.columns[this.pk];

                // * Precisa injetar a pk para poder acessar no condition lá em baixo
                if (columnsWithoutPk) {
                    readArg.columns[this.pk] = true;
                }

                const allRemoved = await this.getQueryBuilder(tx).findMany(readArg);

                const pks: any[] = [];

                for (const removed of allRemoved) {
                    pks.push(removed[this.pk]);
                    // * Retira a pk do retorno se o usuário não solicitou
                    if (columnsWithoutPk) {
                        delete removed[this.pk];
                    }
                }

                const pkColumn = (this.table as PlainObject)[this.pk];
                const condition = inArray(pkColumn, pks);

                await tx.delete(this.table).where(condition);

                return allRemoved as T[];
            });
        } catch (error) {
            throw mapDrizzleError(error, "deleteManyReturning", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Updates a single record matching `where` with the provided data.
     *
     * Relation fields are resolved according to the constructor `relations` config.
     * Throws `NOT_FOUND` if no record matches.
     *
     * @publicApi
     */
    async update(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run update");

        try {
            return await this.updateCore(where, obj, options);
        } catch (error) {
            throw mapDrizzleError(error, "update", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Shared implementation behind `update` — also reached from `save` and
     * `upsert`, which pass in `current` (the row they already fetched in the
     * same transaction) so the row is read only once instead of once per
     * method. The `'update' found no record...` contract applies whenever it
     * runs without a preloaded row (i.e. when called through the public
     * `update`), and always as a safety net.
     *
     * Invariant: when `current` is provided, it must be the full row read
     * from the exact `tx` referenced by `options.db` (never from outside a
     * transaction, and never a pk-only projection — `resolveFkHereFields`
     * reads the current FK values off it).
     */
    private async updateCore(
        where: VSRepoWhere<T>,
        obj: DeepPartial<T>,
        options?: AdapterMethodOptions<T>,
        current?: PlainObject,
    ): Promise<T> {
        return this.runTransactional(options?.db, async tx => {
            const resolved = current ?? (await this.findCurrentByWhere(where, { db: tx }));

            if (!resolved) {
                throw new VSRepoAdapterError(
                    "'update' found no record matching the given 'where'.",
                    AdapterErrorCode.NOT_FOUND,
                    null,
                );
            }

            const ownPkValue = resolved[this.pk];
            const objAny = obj as unknown as PlainObject;
            const { scalarFields, fkHereEntries, fkThereEntries } = splitWritePayload(
                objAny,
                this.relations,
                this.pk,
                true,
            );

            if (fkHereEntries.length > 0 || fkThereEntries.length > 0) {
                this.logger.logDebug(
                    `'update' (pk '${String(ownPkValue)}'): resolving relations — fkHere: [${fkHereEntries.map(([key]) => key).join(", ")}], ` +
                        `fkThere: [${fkThereEntries.map(([key]) => key).join(", ")}]`,
                );
            }

            await resolveFkHereFields(tx, fkHereEntries, scalarFields, resolved, false, this.logger);

            if (Object.keys(scalarFields).length > 0) {
                this.logger.logDebug(
                    `Resolved Drizzle scalar fields for 'update' (pk '${String(ownPkValue)}')`,
                    scalarFields,
                );
                const pkColumn = (this.table as unknown as PlainObject)[this.pk];
                await tx.update(this.table).set(scalarFields).where(eq(pkColumn, ownPkValue));
            }

            await resolveFkThereFields(tx, fkThereEntries, ownPkValue, false, this.logger);

            const readArg = await this.resolveReadArgs({ [this.pk]: ownPkValue } as unknown as VSRepoWhere<T>, {
                ...options,
                db: tx,
            });
            const result = await this.getQueryBuilder(tx).findFirst(readArg);

            if (!result) {
                throw new VSRepoAdapterError(
                    "The entity record was removed for some reason after processing its update payload." +
                        " Common causes: providing a one-to-one fkHere relation as `null` when it is configured with `onDelete: Cascade`.",
                    AdapterErrorCode.NOT_FOUND,
                    null,
                );
            }

            return result as T;
        });
    }

    /**
     * Updates all records matching `where` with the provided scalar data.
     *
     * Does **not** support relation fields in the payload — throws `NOT_SUPPORTED`.
     *
     * @returns A `CountResult` with the number of updated rows.
     *
     * @publicApi
     */
    async updateMany(
        where: VSRepoWhere<T>,
        obj: DeepPartial<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<CountResult> {
        const start = this.logger.startPerformLog("run updateMany");

        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const data = this.stripRelationFields(obj as unknown as PlainObject);
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));
            this.logger.logDebug("Resolved Drizzle arg for 'updateMany'", { data, where });

            const result = await (executor as any).update(this.table).set(data).where(condition);
            const affected = resolveRawResult(this.dialect, result, true) as number;

            return { count: affected ?? 0 };
        } catch (error) {
            throw mapDrizzleError(error, "updateMany", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Updates all records matching `where` and returns the updated entities.
     *
     * Does **not** support relation fields in the payload. The returned records are
     * re-queried via `findMany` by PK, so order is not guaranteed unless `order` is provided.
     *
     * @publicApi
     */
    async updateManyReturning(
        where: VSRepoWhere<T>,
        obj: DeepPartial<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T[]> {
        const start = this.logger.startPerformLog("run updateManyReturning");

        try {
            const data = this.stripRelationFields(obj as unknown as PlainObject);
            this.logger.logDebug("Resolved Drizzle arg for 'updateManyReturning'", { data, where });

            return await this.runTransactional(options?.db, async tx => {
                const condition = parseSqlWhere(where, this.getSqlWhereContext(tx));

                const updated = await tx
                    .update(this.table)
                    .set(data)
                    .where(condition)
                    .returning({ [this.pk]: (this.table as any)[this.pk] });

                const readArg = await this.resolveReadArgs(
                    { [this.pk]: { in: updated.map((_: any) => _[this.pk]) } } as unknown as VSRepoWhere<T>,
                    { ...options, db: tx },
                );
                const result = await this.getQueryBuilder(tx).findMany(readArg);

                return result as T[];
            });
        } catch (error) {
            throw mapDrizzleError(error, "updateManyReturning", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Counts the number of records matching `where`.
     *
     * @publicApi
     */
    async count(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number> {
        const start = this.logger.startPerformLog("run count");

        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));
            this.logger.logDebug("Resolved Drizzle condition for 'count'", { where });

            const [row] = await (executor as any).select({ value: countFn() }).from(this.table).where(condition);
            return Number(row?.value ?? 0);
        } catch (error) {
            throw mapDrizzleError(error, "count", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Returns `true` if at least one record matches `where`, `false` otherwise.
     *
     * Uses `SELECT 1 ... LIMIT 1` for efficiency.
     *
     * @publicApi
     */
    async exists(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<boolean> {
        const start = this.logger.startPerformLog("run exists");

        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));
            this.logger.logDebug("Resolved Drizzle condition for 'exists'", { where });

            const rows = await (executor as any)
                .select({ one: sql`1` })
                .from(this.table)
                .where(condition)
                .limit(1);
            return rows.length > 0;
        } catch (error) {
            throw mapDrizzleError(error, "exists", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Fetches the record matching `where` and deep-merges it **in memory** with `obj`.
     *
     * Does **not** persist anything — the merged result is returned for you to pass to
     * `save`/`update` yourself. For to-many relations, items are matched by primary key.
     *
     * @publicApi
     */
    async merge<K>(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<K & T> {
        const start = this.logger.startPerformLog("run merge");

        try {
            const readArg = await this.resolveReadArgs(where, options);
            this.logger.logDebug("Resolved Drizzle arg for 'merge'", readArg);

            const result = await this.getQueryBuilder(options?.db).findFirst(readArg);

            if (!result) {
                throw new VSRepoAdapterError(
                    "'merge' found no record matching the given 'where'.",
                    AdapterErrorCode.NOT_FOUND,
                    null,
                );
            }

            return mergeEntities(result as PlainObject, obj as unknown as PlainObject, this.relations) as unknown as K &
                T;
        } catch (error) {
            throw mapDrizzleError(error, "merge", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Creates or updates a record: if a record matching `where` exists, updates it with
     * `update`; otherwise, creates a new record with `create`.
     *
     * Relation fields are resolved in both the create and update paths.
     *
     * @publicApi
     */
    async upsert(
        where: VSRepoWhere<T>,
        create: DeepPartial<T>,
        update: DeepPartial<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        const start = this.logger.startPerformLog("run upsert");

        try {
            return await this.runTransactional(options?.db, async tx => {
                const current = await this.findCurrentByWhere(where, { db: tx });

                if (current) {
                    const ownPkValue = current[this.pk];
                    this.logger.logDebug(
                        `'upsert': record found for pk '${String(ownPkValue)}' — delegating to 'update'`,
                    );
                    return this.updateCore(
                        { [this.pk]: ownPkValue } as unknown as VSRepoWhere<T>,
                        update,
                        { ...options, db: tx },
                        current,
                    );
                }

                this.logger.logDebug("'upsert': no record found for the given 'where' — delegating to 'create'");
                return this.create(create, { ...options, db: tx });
            });
        } catch (error) {
            throw mapDrizzleError(error, "upsert", this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Shared implementation behind `incrementOne`/`decrementOne`/`multiplyOne`/`divideOne`. */
    private async atomicUpdate(
        operation: string,
        field: NumericKeys<T>,
        toExpression: (column: any, value: unknown) => unknown,
        value: unknown,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        const start = this.logger.startPerformLog(`run ${operation}`);

        try {
            return await this.runTransactional(options?.db, async tx => {
                const current = await this.getQueryBuilder(tx).findFirst({
                    where: (await this.resolveFindWhere(where, { db: tx, limit: 1 })).where,
                    columns: { [this.pk]: true },
                });

                if (!current) {
                    throw new VSRepoAdapterError(
                        `'${operation}' found no record matching the given 'where'.`,
                        AdapterErrorCode.NOT_FOUND,
                        null,
                    );
                }

                const ownPkValue = (current as PlainObject)[this.pk];
                const pkColumn = (this.table as PlainObject)[this.pk];
                const column = (this.table as PlainObject)[field as string];

                await tx
                    .update(this.table)
                    .set({ [field]: toExpression(column, value) })
                    .where(eq(pkColumn, ownPkValue));

                // Post-write read: re-queries the full row (honoring `select`/`relations`/
                // `order`) after the UPDATE ran, so `$onUpdate`/UPDATE-trigger columns and
                // relations come back current — same update-then-read contract as `updateCore`.
                const readArg = await this.resolveReadArgs({ [this.pk]: ownPkValue } as VSRepoWhere<T>, {
                    ...options,
                    db: tx,
                });
                this.logger.logDebug(`Resolved Drizzle arg for '${operation}' (field '${String(field)}')`, {
                    readArg,
                    value,
                });

                const result = await this.getQueryBuilder(tx).findFirst(readArg);

                if (!result) {
                    throw new VSRepoAdapterError(
                        `'${operation}' updated no records matching the given 'where'.`,
                        AdapterErrorCode.NOT_FOUND,
                        null,
                    );
                }

                return result as T;
            });
        } catch (error) {
            throw mapDrizzleError(error, operation, this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Atomically increments a numeric field by `value` on the record matching `where`.
     *
     * Translates to `UPDATE ... SET field = field + value` — evaluated server-side.
     *
     * @publicApi
     */
    incrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("incrementOne", field, (column, v) => sql`${column} + ${v}`, value, where, options);
    }

    /**
     * Atomically decrements a numeric field by `value` on the record matching `where`.
     *
     * Translates to `UPDATE ... SET field = field - value` — evaluated server-side.
     *
     * @publicApi
     */
    decrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("decrementOne", field, (column, v) => sql`${column} - ${v}`, value, where, options);
    }

    /**
     * Atomically multiplies a numeric field by `value` on the record matching `where`.
     *
     * Translates to `UPDATE ... SET field = field * value` — evaluated server-side.
     *
     * @publicApi
     */
    multiplyOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("multiplyOne", field, (column, v) => sql`${column} * ${v}`, value, where, options);
    }

    /**
     * Atomically divides a numeric field by `value` on the record matching `where`.
     *
     * Translates to `UPDATE ... SET field = field / value` — evaluated server-side.
     *
     * @publicApi
     */
    divideOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("divideOne", field, (column, v) => sql`${column} / ${v}`, value, where, options);
    }

    /** Shared implementation behind `sum`/`average`/`min`/`max`. */
    private async aggregate(
        operation: string,
        fn: (column: any) => any,
        field: NumericKeys<T>,
        where: VSRepoWhere<T> | undefined,
        options: AdapterMethodOptions<T> | undefined,
    ): Promise<number | null> {
        const start = this.logger.startPerformLog(`run ${operation}`);

        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));
            const column = (this.table as unknown as PlainObject)[field as string];
            this.logger.logDebug(`Resolved Drizzle condition for '${operation}' (field '${String(field)}')`, { where });

            const [row] = await (executor as any)
                .select({ value: fn(column) })
                .from(this.table)
                .where(condition);
            const raw = row?.value;

            if (raw === null || raw === undefined) return null;
            return typeof raw === "number" ? raw : Number(raw);
        } catch (error) {
            throw mapDrizzleError(error, operation, this.dialect);
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Returns the sum of `field` across all records matching `where` (or all records if `where` is omitted).
     *
     * Returns `null` over an empty result set (mirrors SQL `SUM()` behavior).
     *
     * @publicApi
     */
    sum(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        return this.aggregate("sum", sumFn, field, where, options);
    }

    /**
     * Returns the average of `field` across all records matching `where`.
     *
     * Returns `null` over an empty result set.
     *
     * @publicApi
     */
    average(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        return this.aggregate("average", avg, field, where, options);
    }

    /**
     * Returns the minimum value of `field` across all records matching `where`.
     *
     * Returns `null` over an empty result set.
     *
     * @publicApi
     */
    min(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        return this.aggregate("min", minFn, field, where, options);
    }

    /**
     * Returns the maximum value of `field` across all records matching `where`.
     *
     * Returns `null` over an empty result set.
     *
     * @publicApi
     */
    max(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        return this.aggregate("max", maxFn, field, where, options);
    }
}
