/**
 * Lets `parseColumns` recognize relation fields marked `true` in a `select`
 * — and recurse into relations-of-relations — without depending on Drizzle
 * types directly.
 *
 * Two adapters build this:
 *  - `createRelationsResolver` (from a Drizzle `defineRelations()` schema) —
 *    supports arbitrary-depth recursion, since each table's own relations
 *    are looked up on demand.
 *  - `createFlatRelationsResolver` (from the constructor's write-only
 *    `relations` config, when no `relationsSchema` was given) — only knows
 *    the current table's relation field names, so `next()` always returns
 *    `undefined` (matches the adapter's previous, single-level behavior).
 */
export type RelationsResolver = {
    /** Names of the current table's relation fields. */
    keys: Set<string>;
    /** Resolver for the table reached via relation field `key`, or `undefined` when it can't be resolved (unknown field, or no schema to recurse into). */
    next(key: string): RelationsResolver | undefined;
};
