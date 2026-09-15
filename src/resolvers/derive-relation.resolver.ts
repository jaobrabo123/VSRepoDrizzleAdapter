import { is, Table, TablesRelationalConfig } from "drizzle-orm";

/** The subset of `AdapterRelation` that can be read straight off a Drizzle relation. */
export type DerivedRelation = {
    table: Table;
    mode: "otm" | "mto" | "oto";
    fkHere?: string;
    fkThere?: string;
    nullable?: boolean;
};

/**
 * Derives `table`/`mode`/`fkHere`/`fkThere`/`nullable` for one relation field
 * straight from a Drizzle `defineRelations()` schema — so the constructor's
 * `relations` config only has to spell out `restriction` (which has no
 * schema equivalent — it's a write-behavior choice) plus whatever field the
 * derivation gets wrong for that relation.
 *
 * Derivation rules, per `relationType`:
 *  - `"many"` -> always `mode: "otm"`; the FK lives on the related ("many")
 *    table, i.e. `fkThere` — Drizzle's own join columns already say so
 *    (`targetColumns`, since a "many" relation's `sourceColumns` are the
 *    parent-side key, usually the PK).
 *  - `"one"` -> `mode` is `"oto"` or `"mto"` depending on which side the FK
 *    physically lives on, told apart by which of the two join columns is a
 *    primary key (the referenced side) rather than the referencing FK:
 *    - `sourceColumns[0]` is a PK -> this table's own key is being
 *      referenced, so the FK is on the *related* table -> `oto` + `fkThere`
 *      (can only be one-to-one: a "one" relation whose FK lives on the
 *      other table only returns a single row if that FK is unique).
 *    - `targetColumns[0]` is a PK -> the FK is on *this* table -> `fkHere`,
 *      and `mode` becomes `oto` (source FK column is unique -> enforces
 *      1-1) or `mto` (not unique -> plain many-to-one) accordingly.
 *    - Neither is a PK -> ambiguous, can't derive safely.
 *    `nullable` is read off the physical FK column's `notNull` — not
 *    Drizzle's own `optional` flag on the relation, which defaults to
 *    `true` regardless of the column's actual constraint unless the schema
 *    author opts into `optional: false` by hand in `defineRelations()`, so
 *    it isn't a reliable signal here.
 *
 * Returns `undefined` when the relation can't be derived — not present in
 * `relationsSchema`, a composite-column join, a many-to-many `through`
 * relation, or the "neither side is a PK" case above. `AdapterRelation` has
 * no shape for composite/`through` relations either way, so those always
 * need a fully manual entry (`table`/`mode`/`fkHere`/`fkThere` supplied by
 * hand) regardless of `relationsSchema`.
 */
export function deriveRelation(
    relationsSchema: TablesRelationalConfig,
    tableKey: string,
    key: string,
): DerivedRelation | undefined {
    const relation = relationsSchema[tableKey]?.relations[key];
    if (!relation || relation.through) return undefined;

    const [sourceColumn, ...restSource] = relation.sourceColumns;
    const [targetColumn, ...restTarget] = relation.targetColumns;
    if (!sourceColumn || !targetColumn || restSource.length > 0 || restTarget.length > 0) return undefined;

    const targetTable = relationsSchema[relation.targetTableName]?.table;
    if (!is(targetTable, Table)) return undefined;

    if (relation.relationType === "many") {
        return { table: targetTable, mode: "otm", fkThere: targetColumn.name };
    }

    if (sourceColumn.primary) {
        return { table: targetTable, mode: "oto", fkThere: targetColumn.name, nullable: !targetColumn.notNull };
    }

    if (targetColumn.primary) {
        return {
            table: targetTable,
            mode: sourceColumn.isUnique ? "oto" : "mto",
            fkHere: sourceColumn.name,
            nullable: !sourceColumn.notNull,
        };
    }

    return undefined;
}
