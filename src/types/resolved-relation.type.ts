import { Table } from "drizzle-orm";

/**
 * `AdapterRelation` after constructor-time validation: the related table's
 * own primary key (needed to tell a "connect/upsert existing" write apart
 * from a "create new" write) has already been resolved via
 * `resolveFieldsConfig`, so nothing downstream needs to re-derive it.
 *
 * `fkHere`/`fkThere` are narrowed to plain `string`s here (vs. the
 * `KeysOfType<T, Primitive>` used in `AdapterRelation`, which only exists to
 * give constructor-config authors autocomplete/type-safety).
 */
export type ResolvedRelation = {
    mode: "otm" | "mto" | "oto";
    restriction: "set" | "add";
    table: Table;
    /** Column of *this* adapter's table holding the FK — set for `mto`, and for `oto` when the FK lives here. */
    fkHere?: string;
    /** Column of the *related* table holding the FK — set for `otm`, and for `oto` when the FK lives there. */
    fkThere?: string;
    /** For `mto` only: whether the FK column accepts `null` (resolved as "disconnect"). */
    nullable?: boolean;
    /** Primary key column name of the related table. */
    relatedPk: string;
};
