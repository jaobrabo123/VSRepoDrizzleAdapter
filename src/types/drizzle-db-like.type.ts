import { DrizzleTransactionLike } from "./drizzle-transaction-like.type.js";
import { SQLWrapper } from "drizzle-orm";

type Fn = (...args: any[]) => any;

/**
 * Minimal duck-typed shape of a Drizzle database client (root instance).
 *
 * @publicApi
 */
export type DrizzleDbLike = {
    select: Fn;
    insert: Fn;
    update: Fn;
    delete: Fn;
    query: Record<string, { findFirst: Fn; findMany: Fn }>;
    execute?: (query: SQLWrapper) => Promise<any>;
    run?: (query: SQLWrapper) => any;
    all?: (query: SQLWrapper) => any;
    transaction: <R>(fn: (tx: DrizzleTransactionLike) => Promise<R>, config?: any) => Promise<R>;
};
