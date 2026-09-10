import { SupportedDialects } from "../types/supported-dialects.type.js";

export function resolveRawResult(dialect: SupportedDialects, result: any, modifying: boolean): unknown {
    switch (dialect) {
        case "postgresql":
        case "cockroach":
            return modifying ? (result.rowCount ?? 0) : result.rows; // assume node-postgres

        case "mysql":
        case "singlestore":
            return modifying ? (result.affectedRows ?? 0) : result; // assume mysql2

        case "sqlite":
            return modifying ? (result.changes ?? 0) : result; // assume better-sqlite3

        case "mssql":
            return modifying ? (result.rowsAffected?.[0] ?? 0) : result.recordset; // assume o pacote `mssql`
    }
}
