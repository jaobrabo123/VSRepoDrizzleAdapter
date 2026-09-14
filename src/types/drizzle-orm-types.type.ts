import { DrizzleDbLike } from "./drizzle-db-like.type.js";

/**
 * Helper type that wires `VSRepository`'s ORM type parameters to Drizzle's
 * concrete client and transaction types.
 *
 * Pass this as the third generic argument to `VSRepository<T, PK, OrmTypes>` so
 * that `getDbClient()` returns your real Drizzle client type and `transaction()`
 * callbacks receive the correctly-typed transaction client.
 *
 * @example
 * ```typescript
 * type MyOrmTypes = DrizzleOrmTypes<typeof db>;
 * class UserRepo extends VSRepository<User, string, MyOrmTypes> { ... }
 * ```
 *
 * @publicApi
 */
export type DrizzleOrmTypes<T extends DrizzleDbLike> = {
    dbClient: T;
    dbTransaction: Parameters<Parameters<T["transaction"]>[0]>[0];
};
