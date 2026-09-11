import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { Column, getTableName, Table } from "drizzle-orm";
import { SupportedDialects } from "../types/supported-dialects.type.js";
import { DrizzleField } from "../types/drizzle-field.type.js";
import { getTableConfig as getTableConfigSqlite } from "drizzle-orm/sqlite-core";
import { getTableConfig as getTableConfigPg, PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getTableConfigCockroach } from "drizzle-orm/cockroach-core";
import { getTableConfig as getTableConfigMysql } from "drizzle-orm/mysql-core";
import { getTableConfig as getTableConfigSinglestore } from "drizzle-orm/singlestore-core";
import { getTableConfig as getTableConfigMssql } from "drizzle-orm/mssql-core";

type TableConfig = {
    columns: { name: string; primary: boolean; isUnique: boolean }[];
    uniqueConstraints: { columns: Column[] }[];
};

export function resolveFieldsConfig(
    table: Table,
    dialect: SupportedDialects,
): { pk: DrizzleField; uniqueFields: DrizzleField[]; allFields: Record<string, DrizzleField> } {
    let pk: DrizzleField | undefined;
    let tableConfig: TableConfig;
    const allFields: Record<string, DrizzleField> = {};

    const uniqueFieldsMap = new Map<string, DrizzleField>();

    switch (dialect) {
        case "postgresql":
            tableConfig = getTableConfigPg(table as PgTable);
            break;
        case "mysql":
            tableConfig = getTableConfigMysql(table as PgTable);
            break;
        case "sqlite":
            tableConfig = getTableConfigSqlite(table as PgTable);
            break;
        case "singlestore":
            tableConfig = getTableConfigSinglestore(table as PgTable);
            break;
        case "mssql":
            tableConfig = getTableConfigMssql(table as PgTable);
            break;
        case "cockroach":
            tableConfig = getTableConfigCockroach(table as PgTable);
            break;
    }

    for (const constraint of tableConfig.uniqueConstraints) {
        for (const column of constraint.columns) {
            const colmunName = column.name;
            const col = (table as any)[colmunName] as Column;
            const field = {
                col,
                name: colmunName,
            };

            uniqueFieldsMap.set(colmunName, field);
        }
    }

    for (const column of tableConfig.columns) {
        const colmunName = column.name;
        const col = (table as any)[colmunName] as Column;
        const field = {
            col,
            name: colmunName,
        };

        if (column.primary) {
            pk = field;
            uniqueFieldsMap.set(colmunName, field);
        } else if (column.isUnique) {
            uniqueFieldsMap.set(colmunName, field);
        }

        allFields[colmunName] = field;
    }

    if (!pk) {
        throw new VSRepoAdapterError(
            `Table '${getTableName(table)}' has no primary key defined. VSRepoDrizzleAdapter requires every table to declare a primary key.`,
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    return { pk, uniqueFields: [...uniqueFieldsMap.values()], allFields };
}
