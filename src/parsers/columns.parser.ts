import { VSRepoSelect } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

/**
 * Result of parsing a `VSRepoSelect<T>` into Drizzle's relational query
 * config shape: scalar fields go into `columns`, relation fields selected
 * with a nested `VSRepoSelect` go into `with` (recursively parsed the same way).
 */
export type ParsedColumns = { columns: PlainObject; with?: PlainObject };

/**
 * Converts a `VSRepoSelect<T>` into Drizzle's `columns` (+ `with`, when the
 * select is nested) relational query config.
 *
 *  - Plain select (every value is a `boolean`, e.g. `{ name: true, email: true }`)
 *    -> only `columns` is filled, `with` stays `undefined`.
 *  - Nested select (a relation field selected with its own `VSRepoSelect`,
 *    e.g. `{ name: true, posts: { title: true } }`) -> the relation field is
 *    moved into `with` (as `{ columns, with }`, recursively parsed the same
 *    way) instead of `columns`.
 */
export function parseColumns<T>(select: VSRepoSelect<T>): ParsedColumns {
    const columns: PlainObject = {};
    let withResult: PlainObject | undefined;

    for (const [key, value] of Object.entries(select)) {
        if (value === undefined) continue;

        if (isPlainObject(value)) {
            withResult ??= {};
            const nested = parseColumns(value);
            withResult[key] = nested.with
                ? { columns: nested.columns, with: nested.with }
                : { columns: nested.columns };
        } else {
            columns[key] = value;
        }
    }

    return { columns, with: withResult };
}
