import { Table } from "drizzle-orm";
import { KeysOfType, Primitive } from "vsrepo";

/**
 * Configuration for a single relation field in the adapter's write resolution.
 *
 * Unlike Prisma's adapter (which uses `pk` + `connectOrCreate`), the Drizzle adapter
 * works directly with foreign keys (`fkHere`/`fkThere`), since Drizzle has no
 * built-in nested-write API and writes are resolved imperatively.
 *
 * `mode`/`table`/`fkHere`/`fkThere`/`through`/`throughFkHere`/`throughFkThere` are
 * only optional at the type level because they can be *derived* — when the
 * constructor's `relationsSchema` is configured, `validateRelations` fills in
 * whatever the Drizzle schema already knows for that field (including
 * `mtm`, when declared via Drizzle's `through()` join-column helper), and
 * whatever you supply here overrides the derived value field-by-field.
 * Without `relationsSchema`, nothing is derived: the same fields are still
 * required in practice, just checked at construction time
 * (`VSRepoAdapterError`, `INVALID_ADAPTER_CONFIG`) rather than by the type
 * checker.
 *
 * `nullable` is optional and it defaults to `false`. Whether `null` should
 * delete/disconnect a related row is a data-safety decision, so it always
 * has to be set explicitly by hand.
 *
 * @publicApi
 */
export type AdapterRelation<T, K> = {
    /**
     * `"add"` (append only) or `"set"` (replace: also removes items not in the payload — for `mtm`, "removes" means unlinking the join-table row,
     * never deleting the related record itself). Always required — there's no Drizzle-schema equivalent to derive it from, it's purely a write-behavior choice.
     */
    restriction: "set" | "add";
    /**
     * The relation cardinality: `"otm"` (one-to-many), `"mto"` (many-to-one), `"oto"` (one-to-one), or `"mtm"` (many-to-many, via a join/pivot table).
     */
    mode?: "otm" | "mto" | "oto" | "mtm";
    /**
     * The Drizzle `Table` object for the related entity.
     */
    table?: Table;
    /**
     * FK column on **this** table (used for `mto`; for `oto` when the FK lives on this side). Not used for `mtm`.
     */
    fkHere?: KeysOfType<T, Primitive>;
    /**
     * FK column on the **related** table (used for `otm`; for `oto` when the FK lives on the related side). Not used for `mtm`.
     */
    fkThere?: KeysOfType<K, Primitive>;
    /**
     * Whether sending `null` is allowed for to-one relations (`oto`/`mto`). Defaults to `false` (not nullable) when omitted. Not applicable to `otm`/`mtm`.
     */
    nullable?: boolean;
    /**
     * The join/pivot table between this table and the related table. Required for, and only used by, `mtm`.
     */
    through?: Table;
    /**
     * Column on `through` referencing **this** table's pk. Required for, and only used by, `mtm`.
     */
    throughFkHere?: string;
    /**
     * Column on `through` referencing the **related** table's pk (`table`'s pk). Required for, and only used by, `mtm`.
     */
    throughFkThere?: string;
};
