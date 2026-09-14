import { RelationKeys } from "vsrepo";
import { AdapterRelation } from "./relation.type.js";

/**
 * Map of relation field names to their {@link AdapterRelation} config.
 *
 * Only fields whose type is an object or array of objects (i.e. relation fields,
 * as determined by `RelationKeys<T>`) can appear as keys. Each entry describes
 * how the adapter should handle that relation field during write operations.
 *
 * @publicApi
 */
export type AdapterRelations<T> = Partial<{
    [P in RelationKeys<T>]: AdapterRelation<T, NonNullable<T[P]> extends Array<infer U> ? U : NonNullable<T[P]>>;
}>;
