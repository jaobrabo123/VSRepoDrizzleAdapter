import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { DrizzleQueryError, TransactionRollbackError } from "drizzle-orm";
import { SupportedDialects } from "../types/supported-dialects.type.js";

/** Duck-typed shape of the handful of native driver error properties this mapper reads. */
type DriverLikeError = {
    code?: string | number;
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

function resolveCodeFromDriverError(dialect: SupportedDialects, error: DriverLikeError): AdapterErrorCode | undefined {
    switch (dialect) {
        case "postgresql":
        case "cockroach":
            return typeof error.code === "string" ? POSTGRES_SQLSTATE_MAP[error.code] : undefined;

        case "sqlite":
            return typeof error.code === "string" ? SQLITE_CODE_MAP[error.code] : undefined;
    }
}

/**
 * Converts any error caught around a Drizzle call into a `VSRepoAdapterError`,
 * so `DrizzleAdapter` never lets a raw Drizzle/driver error escape. Already
 * wrapped errors — e.g. bubbling up from a nested adapter call, or a
 * config/usage error thrown by the adapter itself (see `resolveTableConfig`)
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
            AdapterErrorCode.TRANSACTION_ROLLED_BACK,
            error,
        );
    }

    // DrizzleQueryError wraps the native driver error in `cause` — unwrap it so
    // the dialect-specific code tables above can read the real driver fields.
    const driverError: DriverLikeError =
        error instanceof DrizzleQueryError && error.cause
            ? (error.cause as DriverLikeError)
            : (error as DriverLikeError);

    const code = resolveCodeFromDriverError(dialect, driverError);

    return new VSRepoAdapterError(
        `'${operation}' failed: ${driverError?.message ?? "unknown error"}`,
        code ?? AdapterErrorCode.UNKNOWN,
        error,
    );
}
