import { VSRepoSelect } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";

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
 *  - A relation field marked as `true` (e.g. `{ posts: true }`) is only moved
 *    to `with` when its key is present in `relationsKeysSet` (derived from the
 *    constructor's `relations` config). Otherwise it's treated as a scalar
 *    `columns` entry — which will make the query fail, since relation fields
 *    aren't database columns.
 *
 * Note: the recursive call below does NOT forward `relationsKeysSet`, so a
 * nested relation marked as `true` (a relation of a relation, without spelling
 * out its own fields) is ALWAYS treated as a column. To load a nested relation,
 * spell out at least one of its fields (e.g. `posts: { category: { id: true } }`),
 * or use the `relations` option instead of `select`.
 */
export function parseColumns<T>(select: VSRepoSelect<T>, relationsKeysSet?: Set<string>): ParsedColumns {
    const columns: PlainObject = {};
    let withResult: PlainObject | undefined;

    for (const [key, value] of Object.entries(select)) {
        if (value === undefined) continue;

        if (typeof value !== "boolean") {
            withResult ??= {};
            const nested = parseColumns(value as PlainObject);
            withResult[key] = nested.with
                ? { columns: nested.columns, with: nested.with }
                : { columns: nested.columns };
        } else {
            if (relationsKeysSet?.has(key)) {
                withResult ??= {};
                withResult[key] = value;
                continue;
            }
            columns[key] = value;
        }
    }

    return { columns, with: withResult };
}
