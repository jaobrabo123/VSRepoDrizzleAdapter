import { RelationKeys } from "vsrepo";
import { AdapterRelation } from "./relation.type.js";

/**
 * @publicApi
 */
export type AdapterRelations<T> = Partial<{
    [P in RelationKeys<T>]: AdapterRelation<T, NonNullable<T[P]> extends Array<infer U> ? U : NonNullable<T[P]>>;
}>;
