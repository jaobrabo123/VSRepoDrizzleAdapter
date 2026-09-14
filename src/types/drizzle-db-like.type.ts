import { DrizzleTransactionLike } from "./drizzle-transaction-like.type.js";
import { SQLWrapper } from "drizzle-orm";

type Fn = (...args: any[]) => any;

/**
 * Minimal duck-typed shape of a Drizzle database client (root instance).
 *
 * The adapter uses this type to accept any Drizzle client without coupling to a
 * specific dialect driver. It covers the core query builders (`select`, `insert`,
 * `update`, `delete`), the relational query API (`query`), raw SQL execution
 * (`execute`), and transaction management (`transaction`).
 *
 * @publicApi
 */
export type DrizzleDbLike = {
    select: Fn;
    insert: Fn;
    update: Fn;
    delete: Fn;
    query: Record<string, { findFirst: Fn; findMany: Fn }>;
    selectDistinct: (fields: object) => { from: (table: any) => any };
    execute: (query: SQLWrapper) => Promise<any>;
    transaction: <R>(fn: (tx: DrizzleTransactionLike) => Promise<R>, config?: any) => Promise<R>;
};
