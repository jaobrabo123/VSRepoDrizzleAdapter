import { VSRepoSelect } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { RelationsResolver } from "../types/relations-resolver.type.js";

/**
 * Result of parsing a `VSRepoSelect<T>` into Drizzle's relational query
 * config shape: scalar fields go into `columns`, relation fields selected
 * with a nested `VSRepoSelect` go into `with` (recursively parsed the same
 * way).
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
 *    to `with` when its key is present in `relations.keys` — otherwise it's
 *    treated as a scalar `columns` entry, which will make the query fail,
 *    since relation fields aren't database columns.
 *
 * `relations` (a `RelationsResolver`) is how the caller tells `parseColumns`
 * which fields of the *current* table are relations. When it was built from
 * a Drizzle `defineRelations()` schema (`createRelationsResolver`), calling
 * `relations.next(key)` before recursing into a nested select also resolves
 * *that* relation's own relations — so a relation-of-relation marked `true`
 * (e.g. `posts: { category: true }`) is recognized too, at any depth. When
 * `relations` was built from a flat set of field names instead
 * (`createFlatRelationsResolver`, used when the constructor only has the
 * write-only `relations` config and no `relationsSchema`), `next()` always
 * returns `undefined`, so a relation-of-relation marked `true` is still
 * treated as a column — spell out at least one of its fields to load it.
 */
export function parseColumns<T>(select: VSRepoSelect<T>, relations?: RelationsResolver): ParsedColumns {
    const columns: PlainObject = {};
    let withResult: PlainObject | undefined;

    for (const [key, value] of Object.entries(select)) {
        if (value === undefined) continue;

        if (typeof value !== "boolean") {
            withResult ??= {};
            const nested = parseColumns(value as PlainObject, relations?.next(key));
            withResult[key] = nested.with
                ? { columns: nested.columns, with: nested.with }
                : { columns: nested.columns };
        } else {
            if (relations?.keys.has(key)) {
                withResult ??= {};
                withResult[key] = value;
                continue;
            }
            columns[key] = value;
        }
    }

    return { columns, with: withResult };
}
