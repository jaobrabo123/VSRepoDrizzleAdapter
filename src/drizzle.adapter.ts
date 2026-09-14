import { avg, count as countFn, eq, max as maxFn, min as minFn, sql, sum as sumFn, Table } from "drizzle-orm";
import {
    AdapterErrorCode,
    AdapterMethodOptions,
    AdapterQueryOptions,
    CountResult,
    DeepPartial,
    NumericKeys,
    VSRepoAdapter,
    VSRepoAdapterError,
    VSRepoTransactionOptions,
    VSRepoWhere,
} from "vsrepo";
import { DrizzleAdapterConfig } from "./types/drizzle-adapter-config.type.js";
import { DrizzleDbLike } from "./types/drizzle-db-like.type.js";
import { SupportedDialects } from "./types/supported-dialects.type.js";
import { resolveFieldsConfig } from "./resolvers/fields-config.resolver.js";
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
import { PlainObject } from "./types/plain-object.type.js";
import { ResolvedRelation } from "./types/resolved-relation.type.js";
import { mergeEntities } from "./resolvers/merge-entities.resolver.js";
import { resolveFkHereFields, resolveFkThereFields, splitWritePayload } from "./resolvers/relation-writes.resolver.js";

/**
 * @publicApi
 */
export class DrizzleAdapter<T, K extends DrizzleDbLike = DrizzleDbLike> extends VSRepoAdapter<T> {
    private readonly table: Table;
    private readonly db: DrizzleDbLike;
    private readonly dialect: SupportedDialects;
    private readonly pk: string;
    private readonly queryKey: keyof K["query"];
    private readonly relations?: Map<string, ResolvedRelation>;
    private readonly relationsKeysSet?: Set<string>;

    constructor(db: K, config: DrizzleAdapterConfig<T, K>) {
        super();

        const validated = validateDrizzleAdapterConfig<T, K>(db, config);

        this.db = validated.db;
        this.table = validated.config.table;
        this.dialect = validated.config.dialect ?? "postgresql";
        this.queryKey = validated.config.queryKey;

        const fieldsConfig = resolveFieldsConfig(this.table);
        this.pk = fieldsConfig.pk;

        this.relations = validateRelations<T>(this.table, validated.config.relations);
        if (this.relations) {
            this.relationsKeysSet = new Set(Object.keys(this.relations));
        }
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
     */
    private async resolveReadArgs(
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
        single = false,
    ): Promise<PlainObject> {
        options ??= {};

        let columns: PlainObject | undefined;
        let withArg: PlainObject | undefined;

        if (options.select) {
            const parsedSelect = parseColumns(options.select, this.relationsKeysSet);
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
     */
    private async resolveFindWhere(
        where: VSRepoWhere<T>,
        opts?: { db?: unknown; order?: AdapterMethodOptions<T>["order"]; limit?: number; offset?: number },
    ): Promise<{ where: PlainObject | undefined; orderBy?: PlainObject; paginationApplied: boolean }> {
        if (!hasQuantifierFilter(where)) {
            return { where: parseDrizzleWhere<T>(where, this.dialect), paginationApplied: false };
        }

        const executor = (opts?.db as DrizzleDbLike | undefined) ?? this.db;
        const pkColumn = (this.table as unknown as PlainObject)[this.pk];
        const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));
        const sqlOrderBy = parseSqlOrderBy<T>(this.table, opts?.order);

        let qb = (executor as any).select({ pk: pkColumn }).from(this.table).where(condition);
        if (sqlOrderBy) qb = qb.orderBy(...sqlOrderBy);
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
     * data (no nested writes). Throws `VSRepoAdapterError` (code
     * `NOT_SUPPORTED`) instead of silently dropping the field, when a
     * configured relation field is present in the payload.
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
            return fn(db);
        }

        return ((db as DrizzleDbLike) ?? this.db).transaction(fn);
    }

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

        try {
            return await this.db.transaction(fn, {
                isolationLevel: options?.isolationLevel && resolveIsolationLevel(options.isolationLevel),
            });
        } catch (error) {
            throw mapDrizzleError(error, "runInTransaction", this.dialect);
        }
    }

    getDbClient(): DrizzleDbLike {
        return this.db;
    }

    async query<R = any>(rawQuery: string, options?: AdapterQueryOptions): Promise<R> {
        const executor = (options?.db as DrizzleTransactionLike | undefined) ?? this.db;

        try {
            const sqlQuery = resolveRawSql(this.dialect, rawQuery, options?.args);
            const result = await executor.execute(sqlQuery);

            return resolveRawResult(this.dialect, result, options?.modifying ?? false) as R;
        } catch (error) {
            throw mapDrizzleError(error, "query", this.dialect);
        }
    }

    async findOne(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T | null> {
        try {
            const arg = await this.resolveReadArgs(where, options, true);
            const result = await this.getQueryBuilder(options?.db).findFirst(arg);

            return (result ?? null) as T | null;
        } catch (error) {
            throw mapDrizzleError(error, "findOne", this.dialect);
        }
    }

    async findOneOrThrow(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        try {
            const arg = await this.resolveReadArgs(where, options, true);
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
        }
    }

    async findMany(
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T> & { distinct?: (keyof T)[] },
    ): Promise<T[]> {
        if (options?.distinct !== undefined) {
            throw new VSRepoAdapterError(
                "This adapter doesn't support 'distinct' in 'findMany': Drizzle's relational query API " +
                    "(db.query[queryKey].findMany) has no 'distinct' option.",
                AdapterErrorCode.NOT_SUPPORTED,
                null,
            );
        }

        try {
            const arg = await this.resolveReadArgs(where, options);
            return (await this.getQueryBuilder(options?.db).findMany(arg)) as T[];
        } catch (error) {
            throw mapDrizzleError(error, "findMany", this.dialect);
        }
    }

    async save(obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        try {
            const objAny = obj as unknown as PlainObject;
            const pkValue = objAny[this.pk];

            if (pkValue === undefined) {
                return await this.create(obj, options);
            }

            return await this.runTransactional(options?.db, async tx => {
                const current = await this.findCurrentByWhere({ [this.pk]: pkValue } as unknown as VSRepoWhere<T>, {
                    db: tx,
                });

                if (current === null) {
                    return this.create(obj, { ...options, db: tx });
                }

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
        }
    }

    async saveMany(objs: DeepPartial<T>[], options?: AdapterMethodOptions<T>): Promise<T[]> {
        try {
            return await this.runTransactional(options?.db, tx =>
                Promise.all(objs.map(obj => this.save(obj, { ...options, db: tx }))),
            );
        } catch (error) {
            throw mapDrizzleError(error, "saveMany", this.dialect);
        }
    }

    async create(obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        try {
            return await this.runTransactional(options?.db, async tx => {
                const objAny = obj as unknown as PlainObject;

                const { scalarFields, fkHereEntries, fkThereEntries } = splitWritePayload(
                    objAny,
                    this.relations,
                    this.pk,
                    false,
                );

                await resolveFkHereFields(tx, fkHereEntries, scalarFields, undefined);

                const [created] = await (tx as any)
                    .insert(this.table)
                    .values(scalarFields)
                    .returning({ [this.pk]: (this.table as any)[this.pk] });
                const ownPkValue = created[this.pk];

                await resolveFkThereFields(tx, fkThereEntries, ownPkValue);

                const readArg = await this.resolveReadArgs(
                    { [this.pk]: ownPkValue } as unknown as VSRepoWhere<T>,
                    options,
                );
                const result = await this.getQueryBuilder(tx).findFirst(readArg);

                return result as T;
            });
        } catch (error) {
            throw mapDrizzleError(error, "create", this.dialect);
        }
    }

    async createMany(
        objs: DeepPartial<T>[],
        options?: AdapterMethodOptions<T> & { ignoreConflicts?: boolean },
    ): Promise<CountResult> {
        try {
            const data = objs.map(obj => this.stripRelationFields(obj as unknown as PlainObject));
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;

            let qb = (executor as any).insert(this.table).values(data);
            if (options?.ignoreConflicts) qb = qb.onConflictDoNothing();

            const result = await qb;
            const affected = resolveRawResult(this.dialect, result, true) as number;

            return { count: affected };
        } catch (error) {
            throw mapDrizzleError(error, "createMany", this.dialect);
        }
    }

    async createManyReturning(
        objs: DeepPartial<T>[],
        options?: AdapterMethodOptions<T> & { ignoreConflicts?: boolean },
    ): Promise<T[]> {
        try {
            const data = objs.map(obj => this.stripRelationFields(obj as unknown as PlainObject));
            return await this.runTransactional(options?.db, async tx => {
                let qb = tx.insert(this.table).values(data);
                if (options?.ignoreConflicts) qb = qb.onConflictDoNothing();

                const created = await qb.returning({ [this.pk]: (this.table as any)[this.pk] });

                const readArg = await this.resolveReadArgs(
                    { [this.pk]: { in: created.map((_: any) => _[this.pk]) } } as unknown as VSRepoWhere<T>,
                    options,
                );
                const result = await this.getQueryBuilder(tx).findMany(readArg);

                return result as T[];
            });
        } catch (error) {
            throw mapDrizzleError(error, "createManyReturning", this.dialect);
        }
    }

    async delete(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        try {
            return await this.runTransactional(options?.db, async tx => {
                const readArg = await this.resolveReadArgs(where, options, true);
                const current = await this.getQueryBuilder(tx).findFirst(readArg);

                if (!current) {
                    throw new VSRepoAdapterError(
                        "'delete' found no record matching the given 'where'.",
                        AdapterErrorCode.NOT_FOUND,
                        null,
                    );
                }

                const pkColumn = (this.table as unknown as PlainObject)[this.pk];
                await (tx as any).delete(this.table).where(eq(pkColumn, (current as PlainObject)[this.pk]));

                return current as T;
            });
        } catch (error) {
            throw mapDrizzleError(error, "delete", this.dialect);
        }
    }

    async deleteMany(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<CountResult> {
        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));

            const result = await (executor as any).delete(this.table).where(condition);
            const affected = resolveRawResult(this.dialect, result, true) as number;

            return { count: affected ?? 0 };
        } catch (error) {
            throw mapDrizzleError(error, "deleteMany", this.dialect);
        }
    }

    async deleteManyReturning(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T[]> {
        try {
            return await this.runTransactional(options?.db, async tx => {
                const condition = parseSqlWhere(where, this.getSqlWhereContext(tx));

                const deleted = await tx
                    .delete(this.table)
                    .where(condition)
                    .returning({ [this.pk]: (this.table as any)[this.pk] });

                const readArg = await this.resolveReadArgs(
                    { [this.pk]: { in: deleted.map((_: any) => _[this.pk]) } } as unknown as VSRepoWhere<T>,
                    options,
                );
                const result = await this.getQueryBuilder(tx).findMany(readArg);

                return result as T[];
            });
        } catch (error) {
            throw mapDrizzleError(error, "deleteManyReturning", this.dialect);
        }
    }

    async update(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        try {
            return await this.updateCore(where, obj, options);
        } catch (error) {
            throw mapDrizzleError(error, "update", this.dialect);
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

            await resolveFkHereFields(tx, fkHereEntries, scalarFields, resolved);

            if (Object.keys(scalarFields).length > 0) {
                const pkColumn = (this.table as unknown as PlainObject)[this.pk];
                await (tx as any).update(this.table).set(scalarFields).where(eq(pkColumn, ownPkValue));
            }

            await resolveFkThereFields(tx, fkThereEntries, ownPkValue);

            const readArg = await this.resolveReadArgs({ [this.pk]: ownPkValue } as unknown as VSRepoWhere<T>, options);
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

    async updateMany(
        where: VSRepoWhere<T>,
        obj: DeepPartial<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<CountResult> {
        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const data = this.stripRelationFields(obj as unknown as PlainObject);
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));

            const result = await (executor as any).update(this.table).set(data).where(condition);
            const affected = resolveRawResult(this.dialect, result, true) as number;

            return { count: affected ?? 0 };
        } catch (error) {
            throw mapDrizzleError(error, "updateMany", this.dialect);
        }
    }

    async updateManyReturning(
        where: VSRepoWhere<T>,
        obj: DeepPartial<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T[]> {
        try {
            const data = this.stripRelationFields(obj as unknown as PlainObject);
            return await this.runTransactional(options?.db, async tx => {
                const condition = parseSqlWhere(where, this.getSqlWhereContext(tx));

                const updated = await tx
                    .update(this.table)
                    .set(data)
                    .where(condition)
                    .returning({ [this.pk]: (this.table as any)[this.pk] });

                const readArg = await this.resolveReadArgs(
                    { [this.pk]: { in: updated.map((_: any) => _[this.pk]) } } as unknown as VSRepoWhere<T>,
                    options,
                );
                const result = await this.getQueryBuilder(tx).findMany(readArg);

                return result as T[];
            });
        } catch (error) {
            throw mapDrizzleError(error, "updateManyReturning", this.dialect);
        }
    }

    async count(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number> {
        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));

            const [row] = await (executor as any).select({ value: countFn() }).from(this.table).where(condition);
            return Number(row?.value ?? 0);
        } catch (error) {
            throw mapDrizzleError(error, "count", this.dialect);
        }
    }

    async exists(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<boolean> {
        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));

            const rows = await (executor as any)
                .select({ one: sql`1` })
                .from(this.table)
                .where(condition)
                .limit(1);
            return rows.length > 0;
        } catch (error) {
            throw mapDrizzleError(error, "exists", this.dialect);
        }
    }

    async merge<K>(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<K & T> {
        try {
            const readArg = await this.resolveReadArgs(where, options);
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
        }
    }

    async upsert(
        where: VSRepoWhere<T>,
        create: DeepPartial<T>,
        update: DeepPartial<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        try {
            return await this.runTransactional(options?.db, async tx => {
                const current = await this.findCurrentByWhere(where, { db: tx });

                if (current) {
                    const ownPkValue = current[this.pk];
                    return this.updateCore(
                        { [this.pk]: ownPkValue } as unknown as VSRepoWhere<T>,
                        update,
                        { ...options, db: tx },
                        current,
                    );
                }

                return this.create(create, { ...options, db: tx });
            });
        } catch (error) {
            throw mapDrizzleError(error, "upsert", this.dialect);
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
        try {
            return await this.runTransactional(options?.db, async tx => {
                const current = await this.getQueryBuilder(tx).findFirst({
                    where: (await this.resolveFindWhere(where, { db: tx, limit: 1 })).where,
                    // Only the pk is needed: atomic updates touch a single numeric
                    // column and never resolve relations — a full-row read here
                    // would ship the whole entity back to the client for nothing.
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
                const pkColumn = (this.table as unknown as PlainObject)[this.pk];
                const column = (this.table as unknown as PlainObject)[field as string];

                await (tx as any)
                    .update(this.table)
                    .set({ [field as string]: toExpression(column, value) })
                    .where(eq(pkColumn, ownPkValue));

                const readArg = await this.resolveReadArgs(
                    { [this.pk]: ownPkValue } as unknown as VSRepoWhere<T>,
                    options,
                );
                return (await this.getQueryBuilder(tx).findFirst(readArg)) as T;
            });
        } catch (error) {
            throw mapDrizzleError(error, operation, this.dialect);
        }
    }

    incrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("incrementOne", field, (column, v) => sql`${column} + ${v}`, value, where, options);
    }

    decrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("decrementOne", field, (column, v) => sql`${column} - ${v}`, value, where, options);
    }

    multiplyOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("multiplyOne", field, (column, v) => sql`${column} * ${v}`, value, where, options);
    }

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
        try {
            const executor = (options?.db as DrizzleDbLike | undefined) ?? this.db;
            const condition = parseSqlWhere(where, this.getSqlWhereContext(executor));
            const column = (this.table as unknown as PlainObject)[field as string];

            const [row] = await (executor as any)
                .select({ value: fn(column) })
                .from(this.table)
                .where(condition);
            const raw = row?.value;

            if (raw === null || raw === undefined) return null;
            return typeof raw === "number" ? raw : Number(raw);
        } catch (error) {
            throw mapDrizzleError(error, operation, this.dialect);
        }
    }

    sum(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        return this.aggregate("sum", sumFn, field, where, options);
    }

    average(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        return this.aggregate("average", avg, field, where, options);
    }

    min(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        return this.aggregate("min", minFn, field, where, options);
    }

    max(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        return this.aggregate("max", maxFn, field, where, options);
    }
}
