import { Table } from "drizzle-orm";
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
import { DrizzleField } from "./types/drizzle-field.type.js";
import { SupportedDialects } from "./types/supported-dialects.type.js";
import { resolveFieldsConfig } from "./resolvers/fields-config.resolver.js";
import { DrizzleTransactionLike } from "./types/drizzle-transaction-like.type.js";
import { resolveIsolationLevel } from "./resolvers/isolation-level.resolver.js";
import { resolveRawSql } from "./resolvers/raw-sql.resolver.js";
import { resolveRawResult } from "./resolvers/raw-result.resolver.js";
import { mapDrizzleError } from "./resolvers/map-drizzle-error.resolver.js";
import { validateDrizzleAdapterConfig } from "./validators/validate-adapter-config.validator.js";
import { parseColumns } from "./parsers/columns.parser.js";
import { parseWith } from "./parsers/with.parser.js";
import { parseDrizzleWhere } from "./parsers/where.parser.js";
import { parseOrderBy } from "./parsers/order-by.parser.js";
import { PlainObject } from "./types/plain-object.type.js";

/**
 * @publicApi
 */
export class DrizzleAdapter<T, K extends DrizzleDbLike = DrizzleDbLike> extends VSRepoAdapter<T> {
    private readonly table: Table;
    private readonly db: DrizzleDbLike;
    private readonly dialect: SupportedDialects;
    private readonly pk: DrizzleField;
    private readonly uniqueFields: DrizzleField[];
    private readonly allFieldsRecord: Record<string, DrizzleField>;
    private readonly queryKey: keyof K["query"];

    constructor(db: K, config: DrizzleAdapterConfig<K>) {
        super();

        const validated = validateDrizzleAdapterConfig<K>(db, config);

        this.db = validated.db;
        this.table = validated.config.table;
        this.dialect = validated.config.dialect ?? "postgresql";
        this.queryKey = validated.config.queryKey;

        const fieldsConfig = resolveFieldsConfig(this.table, this.dialect);
        this.pk = fieldsConfig.pk;
        this.uniqueFields = fieldsConfig.uniqueFields;
        this.allFieldsRecord = fieldsConfig.allFields;
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
    private resolveReadArgs(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): PlainObject {
        options ??= {};

        let columns: PlainObject | undefined;
        let withArg: PlainObject | undefined;

        if (options.select) {
            const parsedSelect = parseColumns(options.select);
            columns = parsedSelect.columns;
            withArg = parsedSelect.with;
        } else if (options.relations) {
            withArg = parseWith(options.relations);
        }

        return {
            where: parseDrizzleWhere<T>(where),
            columns,
            with: withArg,
            orderBy: parseOrderBy<T>(options.order),
            limit: options.pagination?.limit,
            offset: options.pagination?.offset,
        };
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
            const arg = this.resolveReadArgs(where, options);
            const result = await this.getQueryBuilder(options?.db).findFirst(arg);

            return (result ?? null) as T | null;
        } catch (error) {
            throw mapDrizzleError(error, "findOne", this.dialect);
        }
    }

    async findOneOrThrow(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        try {
            const arg = this.resolveReadArgs(where, options);
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
            const arg = this.resolveReadArgs(where, options);
            return (await this.getQueryBuilder(options?.db).findMany(arg)) as T[];
        } catch (error) {
            throw mapDrizzleError(error, "findMany", this.dialect);
        }
    }
    save(obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        throw new Error("Method not implemented.");
    }
    saveMany(objs: DeepPartial<T>[], options?: AdapterMethodOptions<T>): Promise<T[]> {
        throw new Error("Method not implemented.");
    }
    create(objs: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        throw new Error("Method not implemented.");
    }
    createMany(
        objs: DeepPartial<T>[],
        options?: AdapterMethodOptions<T> & { ignoreConflicts?: boolean },
    ): Promise<CountResult> {
        throw new Error("Method not implemented.");
    }
    createManyReturning(
        objs: DeepPartial<T>[],
        options?: AdapterMethodOptions<T> & { ignoreConflicts?: boolean },
    ): Promise<T[]> {
        throw new Error("Method not implemented.");
    }
    delete(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        throw new Error("Method not implemented.");
    }
    deleteMany(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<CountResult> {
        throw new Error("Method not implemented.");
    }
    deleteManyReturning(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T[]> {
        throw new Error("Method not implemented.");
    }
    update(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        throw new Error("Method not implemented.");
    }
    updateMany(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<CountResult> {
        throw new Error("Method not implemented.");
    }
    updateManyReturning(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<T[]> {
        throw new Error("Method not implemented.");
    }
    count(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number> {
        throw new Error("Method not implemented.");
    }
    exists(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<boolean> {
        throw new Error("Method not implemented.");
    }
    merge<K>(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: AdapterMethodOptions<T>): Promise<K & T> {
        throw new Error("Method not implemented.");
    }
    upsert(
        where: VSRepoWhere<T>,
        create: DeepPartial<T>,
        update: DeepPartial<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        throw new Error("Method not implemented.");
    }
    incrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        throw new Error("Method not implemented.");
    }
    decrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        throw new Error("Method not implemented.");
    }
    multiplyOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        throw new Error("Method not implemented.");
    }
    divideOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        throw new Error("Method not implemented.");
    }
    sum(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        throw new Error("Method not implemented.");
    }
    average(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        throw new Error("Method not implemented.");
    }
    min(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        throw new Error("Method not implemented.");
    }
    max(field: NumericKeys<T>, where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<number | null> {
        throw new Error("Method not implemented.");
    }
}
