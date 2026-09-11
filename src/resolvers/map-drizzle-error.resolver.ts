import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { DrizzleQueryError, TransactionRollbackError } from "drizzle-orm";
import { SupportedDialects } from "../types/supported-dialects.type.js";

/** Duck-typed shape of the handful of native driver error properties this mapper reads. */
type DriverLikeError = {
    code?: string | number;
    number?: number;
    message?: string;
};

/**
 * Postgres/CockroachDB SQLSTATE -> AdapterErrorCode (both are wire-compatible,
 * so the same table applies to node-postgres and postgres.js).
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const POSTGRES_SQLSTATE_MAP: Record<string, AdapterErrorCode> = {
    "23505": AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
    "23503": AdapterErrorCode.FOREIGN_KEY_VIOLATION,
    "23502": AdapterErrorCode.NOT_NULL_VIOLATION,
    "23514": AdapterErrorCode.CHECK_VIOLATION,
    "23000": AdapterErrorCode.CONSTRAINT_VIOLATION,
    "22001": AdapterErrorCode.VALUE_TOO_LONG,
    "22P02": AdapterErrorCode.CONVERSION_ERROR,
    "42601": AdapterErrorCode.INVALID_QUERY,
    "42703": AdapterErrorCode.TABLE_OR_COLUMN_NOT_FOUND,
    "42P01": AdapterErrorCode.TABLE_OR_COLUMN_NOT_FOUND,
    "40P01": AdapterErrorCode.DEADLOCK,
    "40001": AdapterErrorCode.TRANSACTION_CONFLICT,
    "55P03": AdapterErrorCode.LOCK_TIMEOUT,
    "57014": AdapterErrorCode.TIMEOUT,
    "28000": AdapterErrorCode.INVALID_CREDENTIALS,
    "28P01": AdapterErrorCode.INVALID_CREDENTIALS,
    "3D000": AdapterErrorCode.CONNECTION_FAILED,
};

/**
 * MySQL/SingleStore error code -> AdapterErrorCode (assumes `mysql2`, the
 * officially supported driver for these dialects).
 * @see https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html
 */
const MYSQL_CODE_MAP: Record<string, AdapterErrorCode> = {
    ER_DUP_ENTRY: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
    ER_NO_REFERENCED_ROW: AdapterErrorCode.FOREIGN_KEY_VIOLATION,
    ER_NO_REFERENCED_ROW_2: AdapterErrorCode.FOREIGN_KEY_VIOLATION,
    ER_ROW_IS_REFERENCED: AdapterErrorCode.FOREIGN_KEY_VIOLATION,
    ER_ROW_IS_REFERENCED_2: AdapterErrorCode.FOREIGN_KEY_VIOLATION,
    ER_BAD_NULL_ERROR: AdapterErrorCode.NOT_NULL_VIOLATION,
    ER_CHECK_CONSTRAINT_VIOLATED: AdapterErrorCode.CHECK_VIOLATION,
    ER_DATA_TOO_LONG: AdapterErrorCode.VALUE_TOO_LONG,
    ER_TRUNCATED_WRONG_VALUE: AdapterErrorCode.CONVERSION_ERROR,
    ER_PARSE_ERROR: AdapterErrorCode.INVALID_QUERY,
    ER_NO_SUCH_TABLE: AdapterErrorCode.TABLE_OR_COLUMN_NOT_FOUND,
    ER_BAD_FIELD_ERROR: AdapterErrorCode.TABLE_OR_COLUMN_NOT_FOUND,
    ER_LOCK_DEADLOCK: AdapterErrorCode.DEADLOCK,
    ER_LOCK_WAIT_TIMEOUT: AdapterErrorCode.LOCK_TIMEOUT,
    ER_ACCESS_DENIED_ERROR: AdapterErrorCode.INVALID_CREDENTIALS,
    PROTOCOL_CONNECTION_LOST: AdapterErrorCode.CONNECTION_CLOSED,
    ETIMEDOUT: AdapterErrorCode.TIMEOUT,
    ECONNREFUSED: AdapterErrorCode.CONNECTION_FAILED,
};

/**
 * SQLite result code -> AdapterErrorCode (assumes `better-sqlite3`, the
 * officially supported driver for this dialect).
 * @see https://www.sqlite.org/rescode.html
 */
const SQLITE_CODE_MAP: Record<string, AdapterErrorCode> = {
    SQLITE_CONSTRAINT_UNIQUE: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
    SQLITE_CONSTRAINT_PRIMARYKEY: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
    SQLITE_CONSTRAINT_FOREIGNKEY: AdapterErrorCode.FOREIGN_KEY_VIOLATION,
    SQLITE_CONSTRAINT_NOTNULL: AdapterErrorCode.NOT_NULL_VIOLATION,
    SQLITE_CONSTRAINT_CHECK: AdapterErrorCode.CHECK_VIOLATION,
    SQLITE_CONSTRAINT: AdapterErrorCode.CONSTRAINT_VIOLATION,
    SQLITE_BUSY: AdapterErrorCode.LOCK_TIMEOUT,
    SQLITE_LOCKED: AdapterErrorCode.LOCKED,
    SQLITE_MISUSE: AdapterErrorCode.INVALID_QUERY,
    SQLITE_CANTOPEN: AdapterErrorCode.CONNECTION_FAILED,
};

/**
 * SQL Server error number -> AdapterErrorCode (assumes the `mssql` package,
 * the officially supported driver for this dialect). Not exhaustive — only
 * the most common, actionable errors are listed.
 * @see https://learn.microsoft.com/sql/relational-databases/errors-events/database-engine-events-and-errors
 */
const MSSQL_NUMBER_MAP: Record<number, AdapterErrorCode> = {
    2627: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
    2601: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
    547: AdapterErrorCode.CONSTRAINT_VIOLATION,
    515: AdapterErrorCode.NOT_NULL_VIOLATION,
    8152: AdapterErrorCode.VALUE_TOO_LONG,
    245: AdapterErrorCode.CONVERSION_ERROR,
    207: AdapterErrorCode.TABLE_OR_COLUMN_NOT_FOUND,
    208: AdapterErrorCode.TABLE_OR_COLUMN_NOT_FOUND,
    1205: AdapterErrorCode.DEADLOCK,
    1222: AdapterErrorCode.LOCK_TIMEOUT,
    18456: AdapterErrorCode.INVALID_CREDENTIALS,
};

function resolveCodeFromDriverError(
    dialect: SupportedDialects,
    error: DriverLikeError,
): AdapterErrorCode | undefined {
    switch (dialect) {
        case "postgresql":
        case "cockroach":
            return typeof error.code === "string" ? POSTGRES_SQLSTATE_MAP[error.code] : undefined;

        case "mysql":
        case "singlestore":
            return typeof error.code === "string" ? MYSQL_CODE_MAP[error.code] : undefined;

        case "sqlite":
            return typeof error.code === "string" ? SQLITE_CODE_MAP[error.code] : undefined;

        case "mssql":
            return typeof error.number === "number" ? MSSQL_NUMBER_MAP[error.number] : undefined;
    }
}

/**
 * Converts any error caught around a Drizzle call into a `VSRepoAdapterError`,
 * so `DrizzleAdapter` never lets a raw Drizzle/driver error escape. Already
 * wrapped errors — e.g. bubbling up from a nested adapter call, or a
 * config/usage error thrown by the adapter itself (see `resolveFieldsConfig`)
 * — are returned as-is instead of being wrapped a second time.
 *
 * @param error - The raw error caught around a Drizzle call.
 * @param operation - Name of the adapter method that failed, used in the message.
 * @param dialect - Dialect configured for this adapter instance, used to pick the right native error code table.
 */
export function mapDrizzleError(error: unknown, operation: string, dialect: SupportedDialects): VSRepoAdapterError {
    if (error instanceof VSRepoAdapterError) return error;

    if (error instanceof TransactionRollbackError) {
        return new VSRepoAdapterError(
            `'${operation}' was rolled back intentionally via 'tx.rollback()'`,
            AdapterErrorCode.UNKNOWN,
            error,
        );
    }

    // DrizzleQueryError wraps the native driver error in `cause` — unwrap it so
    // the dialect-specific code tables above can read the real driver fields.
    const driverError: DriverLikeError =
        error instanceof DrizzleQueryError && error.cause ? (error.cause as DriverLikeError) : (error as DriverLikeError);

    const code = resolveCodeFromDriverError(dialect, driverError);

    return new VSRepoAdapterError(
        `'${operation}' failed: ${driverError?.message ?? "unknown error"}`,
        code ?? AdapterErrorCode.UNKNOWN,
        error,
    );
}
