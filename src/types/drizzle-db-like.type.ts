import { DrizzleTransactionLike } from "./drizzle-transaction-like.type.js";
import { SQLWrapper } from "drizzle-orm";

type Fn = (...args: any[]) => any;

/**
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
