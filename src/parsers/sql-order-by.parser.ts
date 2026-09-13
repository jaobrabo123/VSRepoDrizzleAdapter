/**
 * Converts an `Ordering<T>` into drizzle-orm `asc(column)`/`desc(column)`
 * entries for a *core* query builder `.orderBy(...)` call — used only by
 * `DrizzleAdapter`'s pk-prefetch fallback (see `resolveFindWhere`), which
 * runs a raw `db.select({pk}).from(table).where(...)` and therefore needs
 * real SQL ordering (to `LIMIT`/`OFFSET` correctly), unlike the relational
 * query API's own `orderBy.parser.ts`, which just builds the flat map that
 * API expects.
 *
 * Same restriction as `order-by.parser.ts`: ordering by a nested relation
 * field isn't supported (a raw select over the base table has no join to
 * order by) — throws `VSRepoAdapterError` (code `NOT_SUPPORTED`) instead of
 * silently ignoring it.
 */

import { asc, desc, Table, type SQL } from "drizzle-orm";
import { AdapterErrorCode, Ordering, SortDirection, VSRepoAdapterError } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

function isSortDirection(value: unknown): value is SortDirection {
    return value === "asc" || value === "desc" || value === "ASC" || value === "DESC";
}

function pushOrderByField(table: Table, order: PlainObject, acc: SQL[]): void {
    const tableColumns = table as unknown as PlainObject;

    for (const [key, value] of Object.entries(order)) {
        if (value === undefined) continue;

        if (!isSortDirection(value)) {
            if (isPlainObject(value)) {
                throw new VSRepoAdapterError(
                    `Ordering by a nested relation field ('${key}') isn't supported by this adapter.`,
                    AdapterErrorCode.NOT_SUPPORTED,
                    null,
                );
            }
            continue;
        }

        const column = tableColumns[key];
        if (!column) continue;

        acc.push(value.toString().toLowerCase() === "desc" ? desc(column) : asc(column));
    }
}

export function parseSqlOrderBy<T>(table: Table, order: Ordering<T> | undefined | null): SQL[] | undefined {
    if (order === undefined || order === null) return undefined;

    const acc: SQL[] = [];
    const list = Array.isArray(order) ? order : [order];
    for (const field of list) pushOrderByField(table, field as PlainObject, acc);

    return acc.length > 0 ? acc : undefined;
}
