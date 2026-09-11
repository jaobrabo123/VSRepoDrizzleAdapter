import { TransactionIsolationLevel } from "vsrepo";

export type DrizzleIsolationLevel = "read uncommitted" | "read committed" | "repeatable read" | "serializable";

const isolationRecord: Record<TransactionIsolationLevel, DrizzleIsolationLevel> = {
    ReadCommitted: "read committed",
    ReadUncommitted: "read uncommitted",
    RepeatableRead: "repeatable read",
    Serializable: "serializable",
};

export function resolveIsolationLevel(vsrepoIsolation: TransactionIsolationLevel): DrizzleIsolationLevel {
    return isolationRecord[vsrepoIsolation];
}
