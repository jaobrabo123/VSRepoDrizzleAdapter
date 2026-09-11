import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { Column, getTableName, Table } from "drizzle-orm";
import { SupportedDialects } from "../types/supported-dialects.type.js";
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
): { pk: string; uniqueFields: string[]; allFields: string[] } {
    let pk: string | undefined;
    let tableConfig: TableConfig;
    const allFields: string[] = [];

    const uniqueFieldsSet = new Set<string>();

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

            uniqueFieldsSet.add(colmunName);
        }
    }

    for (const column of tableConfig.columns) {
        const colmunName = column.name;

        if (column.primary) {
            pk = colmunName;
            uniqueFieldsSet.add(colmunName);
        } else if (column.isUnique) {
            uniqueFieldsSet.add(colmunName);
        }

        allFields.push(colmunName);
    }

    if (!pk) {
        throw new VSRepoAdapterError(
            `Table '${getTableName(table)}' has no primary key defined. VSRepoDrizzleAdapter requires every table to declare a primary key.`,
            AdapterErrorCode.INVALID_ADAPTER_CONFIG,
            null,
        );
    }

    return { pk, uniqueFields: [...uniqueFieldsSet], allFields };
}
