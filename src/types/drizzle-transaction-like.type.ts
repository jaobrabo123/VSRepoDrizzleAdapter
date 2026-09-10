import { DrizzleDbLike } from "./drizzle-db-like.type.js";

/**
 * @publicApi
 */
export type DrizzleTransactionLike = DrizzleDbLike & { rollback(): never };
