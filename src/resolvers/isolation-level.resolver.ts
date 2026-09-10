import { TransactionIsolationLevel } from "vsrepo";
import { DrizzleIsolationLevel } from "../types/drizzle-isolation-level.type.js";

const isolationRecord: Record<TransactionIsolationLevel, DrizzleIsolationLevel> = {
    ReadCommitted: "read committed",
    ReadUncommitted: "read uncommitted",
    RepeatableRead: "repeatable read",
    Serializable: "serializable",
};

export function resolveIsolationLevel(vsrepoIsolation: TransactionIsolationLevel): DrizzleIsolationLevel {
    return isolationRecord[vsrepoIsolation];
}
