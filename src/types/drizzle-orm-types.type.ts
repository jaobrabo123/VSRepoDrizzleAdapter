import { DrizzleDbLike } from "./drizzle-db-like.type.js";

/**
 * @publicApi
 */
export type DrizzleOrmTypes<T extends DrizzleDbLike> = {
    dbClient: T;
    dbTransaction: Parameters<Parameters<T["transaction"]>[0]>[0];
};
