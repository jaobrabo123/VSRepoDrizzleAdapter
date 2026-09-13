import { SupportedDialects } from "../types/supported-dialects.type.js";

export function resolveRawResult(dialect: SupportedDialects, result: any, modifying: boolean): unknown {
    switch (dialect) {
        case "postgresql":
        case "cockroach":
            return modifying ? (result.rowCount ?? 0) : result.rows; // assume node-postgres

        case "sqlite":
            return modifying ? (result.changes ?? 0) : result; // assume better-sqlite3
    }
}
