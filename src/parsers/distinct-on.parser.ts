/**
 * Converts `findMany`'s `distinct: (keyof T)[]` option into what
 * `db.selectDistinctOn` needs: the `on` column list, plus the `ORDER BY`
 * that has to go with it.
 *
 * PostgreSQL requires `SELECT DISTINCT ON (...)`'s leading `ORDER BY`
 * expressions to match the `DISTINCT ON` columns exactly, in the same
 * order — so this builds the *entire* ordering itself, in two steps:
 *  1. The `distinct` columns first, each ascending unless the caller's own
 *     `order` gives that same field an explicit direction — this is what
 *     decides which row "wins" a distinct group (e.g. `distinct: ["userId"]`
 *     + `order: { createdAt: "desc" }` keeps each user's most recent row).
 *  2. Any remaining fields from the caller's `order` that aren't already
 *     covered by step 1, appended as further tie-breakers, in the order
 *     given.
 *
 * Used only by `DrizzleAdapter`'s pk-prefetch (see `resolveFindWhere`'s
 * docs) — the same "prefetch pks via a core `select`, then run the
 * relational query filtered by pk" strategy already used there for
 * `_every`/`_none`, since the relational query API has no
 * `distinct`/`selectDistinctOn` of its own.
 */

import { asc, desc, getTableName, Table, type SQL } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { AdapterErrorCode, Ordering, SortDirection, VSRepoAdapterError } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";

function isSortDirection(value: unknown): value is SortDirection {
    return value === "asc" || value === "desc" || value === "ASC" || value === "DESC";
}

/** Flattens `order` (single or chained) into a `field -> direction` map — first declared direction wins. */
function collectOrderDirections<T>(order: Ordering<T> | undefined | null): Map<string, SortDirection> {
    const directions = new Map<string, SortDirection>();
    if (!order) return directions;

    const list = Array.isArray(order) ? order : [order];
    for (const field of list) {
        for (const [key, value] of Object.entries(field as PlainObject)) {
            if (isSortDirection(value) && !directions.has(key)) directions.set(key, value);
        }
    }

    return directions;
}

export type ParsedDistinctOn = { columns: PgColumn[]; orderBy: SQL[] };

/**
 * Builds the `on` column list and full `ORDER BY` for `db.selectDistinctOn`.
 *
 * Throws `VSRepoAdapterError`:
 *  - (`INVALID_DATA`) when `distinct` is empty.
 *  - (`FIELD_NOT_FOUND`) when a `distinct` field isn't a real column on the table.
 */
export function parseDistinctOn<T>(
    table: Table,
    distinct: (keyof T)[],
    order: Ordering<T> | undefined | null,
): ParsedDistinctOn {
    if (distinct.length === 0) {
        throw new VSRepoAdapterError(
            "'distinct' must include at least one field.",
            AdapterErrorCode.INVALID_DATA,
            null,
        );
    }

    const tableColumns = table as unknown as PlainObject;
    const directions = collectOrderDirections(order);
    const seen = new Set<string>();
    const columns: PgColumn[] = [];
    const orderBy: SQL[] = [];

    for (const field of distinct) {
        const key = field as string;
        const column = tableColumns[key];
        if (!column) {
            throw new VSRepoAdapterError(
                `Unknown field '${key}' in 'distinct': no column with that name on table '${getTableName(table)}'.`,
                AdapterErrorCode.FIELD_NOT_FOUND,
                null,
            );
        }

        columns.push(column);
        orderBy.push(directions.get(key)?.toLowerCase() === "desc" ? desc(column) : asc(column));
        seen.add(key);
    }

    if (order) {
        const list = Array.isArray(order) ? order : [order];
        for (const field of list) {
            for (const [key, value] of Object.entries(field as PlainObject)) {
                if (seen.has(key) || !isSortDirection(value)) continue;

                const column = tableColumns[key];
                if (!column) continue;

                orderBy.push(value.toLowerCase() === "desc" ? desc(column) : asc(column));
                seen.add(key);
            }
        }
    }

    return { columns, orderBy };
}
