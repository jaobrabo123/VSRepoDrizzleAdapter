import { Table } from "drizzle-orm";
import { KeysOfType, Primitive } from "vsrepo";

/**
 * Configuration for a single relation field in the adapter's write resolution.
 *
 * Unlike Prisma's adapter (which uses `pk` + `connectOrCreate`), the Drizzle adapter
 * works directly with foreign keys (`fkHere`/`fkThere`), since Drizzle has no
 * built-in nested-write API and writes are resolved imperatively.
 *
 * - `restriction` — `"add"` (append only) or `"set"` (replace: also removes items not in the payload). Always required — there's no Drizzle-schema equivalent to derive it from, it's purely a write-behavior choice.
 * - `mode` — the relation cardinality: `"otm"` (one-to-many), `"mto"` (many-to-one), or `"oto"` (one-to-one).
 * - `table` — the Drizzle `Table` object for the related entity.
 * - `fkHere` — FK column on **this** table (used for `mto`; for `oto` when the FK lives on this side).
 * - `fkThere` — FK column on the **related** table (used for `otm`; for `oto` when the FK lives on the related side).
 * - `nullable` — whether sending `null` is allowed for to-one relations (`oto`/`mto`). Defaults to `false` (not nullable) when omitted.
 *
 * `mode`/`table`/`fkHere`/`fkThere` are only optional at the type level
 * because they can be *derived* — when the constructor's `relationsSchema`
 * is configured, `validateRelations` fills in whatever the Drizzle schema
 * already knows for that field, and whatever you
 * supply here overrides the derived value field-by-field. Without
 * `relationsSchema`, nothing is derived: the same fields are still required
 * in practice, just checked at construction time (`VSRepoAdapterError`,
 * `INVALID_ADAPTER_CONFIG`) rather than by the type checker.
 *
 * `nullable` is optional and it defaults to `false`. Whether `null` should
 * delete/disconnect a related row is a data-safety decision, so it always
 * has to be set explicitly by hand.
 *
 * @publicApi
 */
export type AdapterRelation<T, K> = {
    restriction: "set" | "add";
    mode?: "otm" | "mto" | "oto";
    table?: Table;
    fkHere?: KeysOfType<T, Primitive>;
    fkThere?: KeysOfType<K, Primitive>;
    nullable?: boolean;
};
