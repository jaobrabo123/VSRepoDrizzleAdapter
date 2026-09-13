import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { getColumns, getTableName, Table } from "drizzle-orm";

export function resolveFieldsConfig(table: Table): { pk: string } {
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

    return { pk };
}
