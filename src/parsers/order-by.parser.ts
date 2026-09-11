import { AdapterErrorCode, Ordering, SortDirection, VSRepoAdapterError } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

function isSortDirection(value: unknown): value is SortDirection {
    return value === "asc" || value === "desc" || value === "ASC" || value === "DESC";
}

function parseOrderByField(order: PlainObject): PlainObject {
    const result: PlainObject = {};

    for (const [key, value] of Object.entries(order)) {
        if (value === undefined) continue;

        if (isSortDirection(value)) {
            result[key] = value.toLowerCase();
            continue;
        }

        if (isPlainObject(value)) {
            // Drizzle's relational query `orderBy` only accepts a flat map of the
            // current table's own columns — ordering by a relation's field has to
            // be declared inside that relation's own `with` entry instead, so it
            // can't be resolved generically at this level.
            throw new VSRepoAdapterError(
                `Ordering by a nested relation field ('${key}') isn't supported at the top level of a Drizzle ` +
                    "relational query — nest the ordering inside that relation's own 'with' config instead.",
                AdapterErrorCode.NOT_SUPPORTED,
                null,
            );
        }

        result[key] = value;
    }

    return result;
}

/**
 * Converts an `Ordering<T>` into Drizzle's relational query `orderBy` shape
 * (a flat `{ column: "asc" | "desc" }` map). Chained orderings
 * (`Ordering<T>[]`) are merged into a single map, in declaration order —
 * later entries win on key collisions, same as re-declaring a key in a
 * plain object literal.
 */
export function parseOrderBy<T>(order: Ordering<T> | undefined | null): PlainObject | undefined {
    if (order === undefined || order === null) return undefined;

    if (!Array.isArray(order)) return parseOrderByField(order as PlainObject);

    return order.reduce<PlainObject>((acc, field) => ({ ...acc, ...parseOrderByField(field as PlainObject) }), {});
}
