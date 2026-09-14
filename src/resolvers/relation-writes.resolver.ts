/**
 * Resolves the nested-relation part of a `create`/`update` payload into
 * actual Drizzle statements, run against `tx` (always a transaction, so a
 * failure partway through leaves nothing half-written) — the imperative
 * equivalent of what `VSRepoPrisma7Adapter`'s `data.parser.ts` builds
 * declaratively via Prisma's nested-write API (`create`/`connectOrCreate`/
 * `upsert`/`disconnect`/`delete`/`deleteMany`), which Drizzle has no
 * equivalent of. Behavior mirrors that adapter's rules 1:1 (see its
 * `data.parser.ts` docstring) — minus `mtm`, which this adapter's
 * `AdapterRelation` doesn't model.
 *
 * A payload field is split, by the configured relation's FK side, into:
 *  - `fkHere` relations (`mto`, and `oto` when the FK lives on *this*
 *    table) — the FK column is part of *this* table's own row, so these
 *    MUST be resolved and merged into the row's data BEFORE it's inserted/
 *    updated (`resolveFkHereFields`).
 *  - `fkThere` relations (`otm`, and `oto` when the FK lives on the
 *    *related* table) — the FK column lives on the related row and points
 *    back via this table's pk, so these can only be resolved AFTER this
 *    table's own row exists / its pk is known (`resolveFkThereFields`).
 *
 * Nested creates only go one level deep: a related record's own payload is
 * inserted as-is (its scalar fields), it is NOT recursively checked for
 * further relation fields of its own — this adapter's `relations` config
 * only describes the *owning* table's relations, not the whole schema graph
 * (unlike Prisma, which resolves nested writes against its full schema).
 */

import { and, eq, notInArray } from "drizzle-orm";
import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { DrizzleTransactionLike } from "../types/drizzle-transaction-like.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import { ResolvedRelation } from "../types/resolved-relation.type.js";

/** Sentinel returned by `resolveFkHereField` for "leave this field out of the write entirely". */
const SKIP = Symbol("skip");

function omitKey(item: PlainObject, key: string): PlainObject {
    const clone = { ...item };
    delete clone[key];
    return clone;
}

export type SplitPayload = {
    /** This table's own scalar fields (relation fields and, on updates, the pk, are excluded). */
    scalarFields: PlainObject;
    /** Configured relations whose FK column lives on *this* table (`mto`, `oto` + `fkHere`). */
    fkHereEntries: [string, ResolvedRelation, unknown][];
    /** Configured relations whose FK column lives on the *related* table (`otm`, `oto` + `fkThere`). */
    fkThereEntries: [string, ResolvedRelation, unknown][];
};

/** Splits a raw `DeepPartial<T>` payload into own scalar fields vs. relation writes to resolve separately. */
export function splitWritePayload(
    obj: PlainObject,
    relations: Map<string, ResolvedRelation> | undefined,
    pkName: string,
    excludePk: boolean,
): SplitPayload {
    const scalarFields: PlainObject = {};
    const fkHereEntries: [string, ResolvedRelation, unknown][] = [];
    const fkThereEntries: [string, ResolvedRelation, unknown][] = [];

    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue;

        const relation = relations?.get(key);

        if (!relation) {
            if (excludePk && key === pkName) continue;
            scalarFields[key] = value;
            continue;
        }

        if (relation.fkHere) {
            fkHereEntries.push([key, relation, value]);
        } else {
            fkThereEntries.push([key, relation, value]);
        }
    }

    return { scalarFields, fkHereEntries, fkThereEntries };
}

async function resolveFkHereField(
    tx: DrizzleTransactionLike,
    relation: ResolvedRelation,
    field: PlainObject | null,
    currentFkValue: unknown,
): Promise<unknown> {
    const relatedTable = relation.table as unknown as PlainObject;
    const pkColumn = relatedTable[relation.relatedPk];

    if (field === null) {
        if (!relation.nullable) {
            throw new VSRepoAdapterError(
                `You cannot provide null for a to-one relation when it is not nullable.`,
                AdapterErrorCode.INVALID_DATA,
                null,
            );
        }
        if (relation.mode === "mto") return null;

        // relation.mode === "oto"
        if (relation.restriction === "set" && currentFkValue != undefined) {
            await (tx as any).delete(relation.table).where(eq(pkColumn, currentFkValue));
        }

        return null;
    }

    const pkValue = field[relation.relatedPk];

    if (pkValue === undefined) {
        const [created] = await (tx as any)
            .insert(relation.table)
            .values(field)
            .returning({ [relation.relatedPk]: (relation.table as any)[relation.relatedPk] });
        return created[relation.relatedPk];
    }

    const existing = await (tx as any)
        .select({ pk: pkColumn })
        .from(relation.table)
        .where(eq(pkColumn, pkValue))
        .limit(1);

    if (existing.length === 0) {
        await (tx as any).insert(relation.table).values(field);
    } else if (relation.restriction === "set") {
        const dataWithoutPk = omitKey(field, relation.relatedPk);
        if (Object.keys(dataWithoutPk).length > 0) {
            await (tx as any).update(relation.table).set(dataWithoutPk).where(eq(pkColumn, pkValue));
        }
    }

    return pkValue;
}

/** Resolves every `fkHere` relation field, merging the results straight into `scalarFields`. */
export async function resolveFkHereFields(
    tx: DrizzleTransactionLike,
    entries: [string, ResolvedRelation, unknown][],
    scalarFields: PlainObject,
    currentRow: PlainObject | undefined,
): Promise<void> {
    for (const [key, relation, value] of entries) {
        if (value !== null && typeof value !== "object") {
            throw new VSRepoAdapterError(
                `Field '${key}': expected an object or 'null' for a to-one relation, got '${typeof value}'.`,
                AdapterErrorCode.INVALID_DATA,
                null,
            );
        }

        const currentFkValue = currentRow?.[relation.fkHere as string];
        const resolved = await resolveFkHereField(tx, relation, value as PlainObject | null, currentFkValue);

        if (resolved !== SKIP) {
            scalarFields[relation.fkHere as string] = resolved;
        }
    }
}

/**
 * Resolves one `fkThere` relation field (`otm`, or `oto` with the FK there)
 * against `ownPkValue` (this table's own, already-known, pk value) — see
 * module docstring for why this can only run once that pk is known.
 */
async function resolveOtmField(
    tx: DrizzleTransactionLike,
    relation: ResolvedRelation,
    items: PlainObject[],
    ownPkValue: unknown,
): Promise<void> {
    const relatedTable = relation.table as unknown as PlainObject;
    const fkColumn = relatedTable[relation.fkThere as string];
    const pkColumn = relatedTable[relation.relatedPk];

    const withoutPk = items.filter(item => item[relation.relatedPk] === undefined);
    const withPk = items.filter(item => item[relation.relatedPk] !== undefined);

    // Every pk that ends up part of this write — whether freshly generated (`withoutPk`) or
    // given up front (`withPk`) — has to be tracked BEFORE the `restriction: "set"` cleanup
    // below runs, or it'll treat a row inserted a moment ago as something to delete right away.
    const connectedIds: unknown[] = [];

    for (const item of withoutPk) {
        const [insertedRow] = await (tx as any)
            .insert(relation.table)
            .values({ ...item, [relation.fkThere as string]: ownPkValue })
            .returning({ [relation.relatedPk]: (relation.table as any)[relation.relatedPk] });

        if (insertedRow?.[relation.relatedPk] !== undefined) {
            connectedIds.push(insertedRow[relation.relatedPk]);
        }
    }

    for (const item of withPk) {
        const pkValue = item[relation.relatedPk];
        connectedIds.push(pkValue);

        const existing = await (tx as any)
            .select({ pk: pkColumn })
            .from(relation.table)
            .where(eq(pkColumn, pkValue))
            .limit(1);

        if (existing.length === 0) {
            await (tx as any).insert(relation.table).values({ ...item, [relation.fkThere as string]: ownPkValue });
            continue;
        }

        const setData =
            relation.restriction === "set"
                ? { ...omitKey(item, relation.relatedPk), [relation.fkThere as string]: ownPkValue }
                : { [relation.fkThere as string]: ownPkValue };

        await (tx as any).update(relation.table).set(setData).where(eq(pkColumn, pkValue));
    }

    if (relation.restriction === "set") {
        const condition =
            connectedIds.length > 0
                ? and(eq(fkColumn, ownPkValue), notInArray(pkColumn, connectedIds))!
                : eq(fkColumn, ownPkValue);

        await (tx as any).delete(relation.table).where(condition);
    }
}

/** Resolves one `oto` field whose FK lives on the related table. */
async function resolveOtoFkThereField(
    tx: DrizzleTransactionLike,
    relation: ResolvedRelation,
    field: PlainObject | null,
    ownPkValue: unknown,
): Promise<void> {
    const relatedTable = relation.table as unknown as PlainObject;
    const fkColumn = relatedTable[relation.fkThere as string];
    const pkColumn = relatedTable[relation.relatedPk];

    if (field === null) {
        if (!relation.nullable) {
            throw new VSRepoAdapterError(
                `You cannot provide null for a to-one relation when it is not nullable.`,
                AdapterErrorCode.INVALID_DATA,
                null,
            );
        }
        if (relation.restriction === "set") {
            await (tx as any).delete(relation.table).where(eq(fkColumn, ownPkValue));
        } else {
            await (tx as any)
                .update(relation.table)
                .set({ [fkColumn]: null })
                .where(eq(fkColumn, ownPkValue));
        }
        return;
    }

    const pkValue = field[relation.relatedPk];
    // let keepPk: unknown = pkValue;

    const resolveSetData = async (targetPk: unknown) => {
        const setData =
            relation.restriction === "set"
                ? { ...omitKey(field, relation.relatedPk), [relation.fkThere as string]: ownPkValue }
                : { [relation.fkThere as string]: ownPkValue };

        await (tx as any).update(relation.table).set(setData).where(eq(pkColumn, targetPk));
    };

    if (pkValue === undefined) {
        const [otoRel] = await (tx as any)
            .select({ pk: pkColumn })
            .from(relation.table)
            .where(eq(fkColumn, ownPkValue))
            .limit(1);

        if (!otoRel) {
            await (tx as any).insert(relation.table).values({ ...field, [relation.fkThere as string]: ownPkValue });
        } else {
            await resolveSetData(otoRel.pk);
        }

        // keepPk = insertedRow?.[relation.relatedPk];
    } else {
        const existing = await (tx as any)
            .select({ pk: pkColumn })
            .from(relation.table)
            .where(eq(pkColumn, pkValue))
            .limit(1);

        if (existing.length === 0) {
            await (tx as any).insert(relation.table).values({ ...field, [relation.fkThere as string]: ownPkValue });
        } else {
            await resolveSetData(pkValue);
        }
    }

    // ! Uncessary, since one-to-one relations never hasn't more than one objects related
    // if (relation.restriction === "set" && keepPk !== undefined) {
    //     // Removes any other stale row previously linked to this parent (1:1 cleanup) —
    //     // `keepPk` is either the given pk or the pk freshly generated by the insert above,
    //     // so a just-inserted row is never mistaken for a stale one to clean up.
    //     await (tx as any).delete(relation.table).where(and(eq(fkColumn, ownPkValue), ne(pkColumn, keepPk)));
    // }
}

/** Resolves every `fkThere` relation field, once `ownPkValue` (this table's own pk) is known. */
export async function resolveFkThereFields(
    tx: DrizzleTransactionLike,
    entries: [string, ResolvedRelation, unknown][],
    ownPkValue: unknown,
): Promise<void> {
    for (const [key, relation, value] of entries) {
        if (relation.mode === "otm") {
            if (!Array.isArray(value)) {
                throw new VSRepoAdapterError(
                    `Field '${key}': expected an array for a to-many relation, got '${typeof value}'.`,
                    AdapterErrorCode.INVALID_DATA,
                    null,
                );
            }
            await resolveOtmField(tx, relation, value as PlainObject[], ownPkValue);
            continue;
        }

        if (value !== null && typeof value !== "object") {
            throw new VSRepoAdapterError(
                `Field '${key}': expected an object or 'null' for a to-one relation, got '${typeof value}'.`,
                AdapterErrorCode.INVALID_DATA,
                null,
            );
        }

        await resolveOtoFkThereField(tx, relation, value as PlainObject | null, ownPkValue);
    }
}
