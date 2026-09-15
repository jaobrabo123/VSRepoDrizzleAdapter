import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { getColumns, getTableName, is, Table } from "drizzle-orm";
import { SupportedDialects } from "../types/supported-dialects.type.js";
import { PgTable } from "drizzle-orm/pg-core";
import { CockroachTable } from "drizzle-orm/cockroach-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

export function resolveTableConfig(
    table: Table,
    overwriteDialect?: SupportedDialects,
): { pk: string; dialect: SupportedDialects } {
    let pk: string | undefined;

    for (const column of Object.values(getColumns(table))) {
        if (column.primary) {
            pk = column.name;
            break;
        }
    }

    if (!pk) {
        throw new VSRepoAdapterError(
            `Table '${getTableName(table)}' has no primary key defined. VSRepoDrizzleAdapter requires every table to declare a primary key.`,
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    const dialect: SupportedDialects | null = overwriteDialect
        ? overwriteDialect
        : is(table, PgTable)
          ? "postgresql"
          : is(table, CockroachTable)
            ? "cockroach"
            : is(table, SQLiteTable)
              ? "sqlite"
              : null;

    if (!dialect) {
        throw new VSRepoAdapterError(
            `VSRepoDrizzleAdapter doesn't support your database dialect for table '${getTableName(table)}' — ` +
                "it only supports 'postgresql', 'cockroach' and 'sqlite'. If this table really is one of those " +
                "(e.g. built with a custom table factory that doesn't extend Drizzle's own 'PgTable'/" +
                "'CockroachTable'/'SQLiteTable'), pass 'dialect' explicitly in the constructor config to skip " +
                "detection.",
            AdapterErrorCode.NOT_SUPPORTED,
            null,
        );
    }

    return { pk, dialect };
}
