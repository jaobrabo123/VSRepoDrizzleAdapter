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

/**
 * @publicApi
 */
export class DrizzleAdapter<T> extends VSRepoAdapter<T> {
    private readonly table: Table;
    private readonly db: DrizzleDbLike;
    private readonly dialect: SupportedDialects;
    private readonly pk: DrizzleField;
    private readonly uniqueFields: DrizzleField[];
    private readonly allFieldsRecord: Record<string, DrizzleField>;

    constructor(config: DrizzleAdapterConfig) {
        super();
        this.table = config.table;
        this.db = config.db;
        this.dialect = config.dialect ?? "postgresql";

        const fieldsConfig = resolveFieldsConfig(this.table, this.dialect);
        this.pk = fieldsConfig.pk;
        this.uniqueFields = fieldsConfig.uniqueFields;
        this.allFieldsRecord = fieldsConfig.allFields;
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

        return await this.db.transaction(fn, {
            isolationLevel: options?.isolationLevel && resolveIsolationLevel(options.isolationLevel),
        });
    }

    getDbClient(): DrizzleDbLike {
        return this.db;
    }

    async query<T = any>(rawQuery: string, options?: AdapterQueryOptions): Promise<T> {
        const executor = (options?.db as DrizzleTransactionLike | undefined) ?? this.db;
        const sqlQuery = resolveRawSql(this.dialect, rawQuery, options?.args);

        const result = await executor.execute(sqlQuery);

        return resolveRawResult(this.dialect, result, options?.modifying ?? false) as T;
    }

    findOne(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T | null> {
        throw new Error("Method not implemented.");
    }
    findOneOrThrow(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        throw new Error("Method not implemented.");
    }
    findMany(where: VSRepoWhere<T>, options?: AdapterMethodOptions<T> & { distinct?: (keyof T)[] }): Promise<T[]> {
        throw new Error("Method not implemented.");
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
