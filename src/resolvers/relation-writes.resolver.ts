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

import { and, eq, ne, notInArray } from "drizzle-orm";
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

/**
 * Resolves one `fkHere` relation field (`mto`, or `oto` with the FK here)
 * into the value to put in this table's own `fkHere` column — creating,
 * connecting, or (on `restriction: "set"`) upserting the related record as
 * needed. Returns the `SKIP` sentinel when the field shouldn't be touched at
 * all (mirrors `data.parser.ts` returning `{}` for those same cases).
 *
 * `currentFkValue` is this table's own *current* value of the `fkHere`
 * column — only needed (and only passed on `update`) to find the
 * previously-linked related row when `restriction: "set"` + `field === null`
 * means "delete the related row that was here".
 */
async function resolveFkHereField(
    tx: DrizzleTransactionLike,
    relation: ResolvedRelation,
    field: PlainObject | null,
    currentFkValue: unknown,
): Promise<unknown | typeof SKIP> {
    const relatedTable = relation.table as unknown as PlainObject;
    const pkColumn = relatedTable[relation.relatedPk];

    if (field === null) {
        if (relation.mode === "mto" && relation.nullable) return null;

        if (relation.mode === "oto" && relation.restriction === "set") {
            if (currentFkValue !== undefined && currentFkValue !== null) {
                await (tx as any).delete(relation.table).where(eq(pkColumn, currentFkValue));
            }
            return null;
        }

        return SKIP;
    }

    const pkValue = field[relation.relatedPk];

    if (pkValue === undefined) {
        const [created] = await (tx as any).insert(relation.table).values(field).returning();
        return created[relation.relatedPk];
    }

    const existing = await (tx as any).select({ pk: pkColumn }).from(relation.table).where(eq(pkColumn, pkValue)).limit(1);

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

    for (const item of withoutPk) {
        await (tx as any).insert(relation.table).values({ ...item, [relation.fkThere as string]: ownPkValue });
    }

    const connectedIds: unknown[] = [];

    for (const item of withPk) {
        const pkValue = item[relation.relatedPk];
        connectedIds.push(pkValue);

        const existing = await (tx as any).select({ pk: pkColumn }).from(relation.table).where(eq(pkColumn, pkValue)).limit(1);

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
        if (relation.restriction === "set") {
            await (tx as any).delete(relation.table).where(eq(fkColumn, ownPkValue));
        }
        return;
    }

    const pkValue = field[relation.relatedPk];

    if (pkValue === undefined) {
        await (tx as any).insert(relation.table).values({ ...field, [relation.fkThere as string]: ownPkValue });
    } else {
        const existing = await (tx as any).select({ pk: pkColumn }).from(relation.table).where(eq(pkColumn, pkValue)).limit(1);

        if (existing.length === 0) {
            await (tx as any).insert(relation.table).values({ ...field, [relation.fkThere as string]: ownPkValue });
        } else {
            const setData =
                relation.restriction === "set"
                    ? { ...omitKey(field, relation.relatedPk), [relation.fkThere as string]: ownPkValue }
                    : { [relation.fkThere as string]: ownPkValue };

            await (tx as any).update(relation.table).set(setData).where(eq(pkColumn, pkValue));
        }
    }

    if (relation.restriction === "set" && pkValue !== undefined) {
        // Removes any other stale row previously linked to this parent (1:1 cleanup).
        // When `pkValue` is undefined (fresh insert, no pk given) there's nothing to
        // exclude by — left as a documented best-effort limitation (see module docstring).
        await (tx as any).delete(relation.table).where(and(eq(fkColumn, ownPkValue), ne(pkColumn, pkValue)));
    }
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
