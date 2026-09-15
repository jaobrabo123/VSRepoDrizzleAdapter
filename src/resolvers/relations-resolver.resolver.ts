import { TablesRelationalConfig } from "drizzle-orm";
import { RelationsResolver } from "../types/relations-resolver.type.js";

/**
 * Builds a `RelationsResolver` for `tableKey` out of a Drizzle
 * `defineRelations()` schema, walking `targetTableName` on demand so nested
 * `select`s can recognize relations-of-relations marked `true` at any depth
 * (not just the first level).
 *
 * Returns `undefined` when `tableKey` isn't present in `relationsSchema` —
 * `parseColumns` then falls back to treating every field as a column, same
 * as when no relations config is given at all.
 */
export function createRelationsResolver(
    relationsSchema: TablesRelationalConfig,
    tableKey: string,
): RelationsResolver | undefined {
    const entry = relationsSchema[tableKey];
    if (!entry) return undefined;

    return {
        keys: new Set(Object.keys(entry.relations)),
        next(key: string) {
            const relation = entry.relations[key];
            if (!relation) return undefined;
            return createRelationsResolver(relationsSchema, relation.targetTableName);
        },
    };
}

/**
 * Builds a single-level `RelationsResolver` out of a plain set of relation
 * field names — used when the constructor only has the write-only
 * `relations` config (no `relationsSchema`). There's no schema to recurse
 * into, so `next()` always returns `undefined`: a relation-of-relation
 * marked `true` is still treated as a column, matching the adapter's
 * previous behavior.
 */
export function createFlatRelationsResolver(keys: Set<string>): RelationsResolver {
    return { keys, next: () => undefined };
}
