import { DrizzleDbLike } from "./drizzle-db-like.type.js";

/**
 * Duck-typed shape of a Drizzle transaction client.
 *
 * Extends {@link DrizzleDbLike} with a `rollback()` method — the presence of
 * `rollback` is how the adapter distinguishes a transaction client from the root
 * database client (to decide whether to reuse an existing transaction or open a new one).
 *
 * @publicApi
 */
export type DrizzleTransactionLike = DrizzleDbLike & { rollback(): never };
