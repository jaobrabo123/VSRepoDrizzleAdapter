/**
 * Deep-merges, IN MEMORY, a fetched `result` with the
 * `obj` payload passed to `merge()` — same behavior as
 * `VSRepoPrisma7Adapter`'s `mergeEntities`. It's on the caller to decide what
 * to do with the returned value (e.g. pass it to `save` next).
 *
 * Without `relations`, this is a plain recursive object merge (arrays are
 * concatenated). With `relations`:
 *  - to-one (`mto`/`oto`) fields are merged directly with the existing
 *    related object, or replaced by `null` when `obj` explicitly sends `null`;
 *  - to-many (`otm`/`mtm`) fields match `result[key]`'s items against
 *    `obj[key]`'s by the relation's `relatedPk`: an item whose pk matches an
 *    existing one is merged into it; one that doesn't is appended. Existing
 *    items that aren't mentioned in `obj[key]` are kept — `merge` never
 *    removes anything.
 */

import { PlainObject } from "../types/plain-object.type.js";
import { ResolvedRelation } from "../types/resolved-relation.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

function deepMergeValue(target: unknown, source: unknown): unknown {
    if (Array.isArray(target) && Array.isArray(source)) {
        return [...target, ...source];
    }

    if (isPlainObject(target) && isPlainObject(source)) {
        return deepMergePlain(target as PlainObject, source as PlainObject);
    }

    return source;
}

function deepMergePlain(target: PlainObject, source: PlainObject): PlainObject {
    const merged: PlainObject = { ...target };

    for (const [key, value] of Object.entries(source)) {
        if (value === undefined) continue;
        merged[key] = key in target ? deepMergeValue(target[key], value) : value;
    }

    return merged;
}

function mergeToManyRelation(target: PlainObject[], source: PlainObject[], relatedPk: string): PlainObject[] {
    const targetByPk = new Map<unknown, PlainObject>();
    const targetWithoutPk: PlainObject[] = [];

    for (const item of target) {
        if (item[relatedPk] !== undefined) {
            targetByPk.set(item[relatedPk], item);
        } else {
            targetWithoutPk.push(item);
        }
    }

    const sourceWithoutPk: PlainObject[] = [];

    for (const item of source) {
        if (item[relatedPk] === undefined) {
            sourceWithoutPk.push(item);
            continue;
        }

        const existing = targetByPk.get(item[relatedPk]);
        targetByPk.set(item[relatedPk], existing ? deepMergePlain(existing, item) : item);
    }

    return [...targetByPk.values(), ...targetWithoutPk, ...sourceWithoutPk];
}

export function mergeEntities<T extends PlainObject, U extends PlainObject>(
    result: T,
    obj: U,
    relations?: Map<string, ResolvedRelation>,
): U & T {
    if (!relations) {
        return deepMergePlain(result, obj) as unknown as U & T;
    }

    const merged: PlainObject = { ...result };

    for (const [key, field] of Object.entries(obj)) {
        if (field === undefined) continue;

        const relation = relations.get(key);

        if (!relation) {
            merged[key] = field;
            continue;
        }

        if (relation.mode !== "otm" && relation.mode !== "mtm" && isPlainObject(merged[key])) {
            merged[key] = field === null ? null : deepMergePlain(merged[key], field as PlainObject);
            continue;
        }

        if ((relation.mode === "otm" || relation.mode === "mtm") && Array.isArray(merged[key])) {
            merged[key] = mergeToManyRelation(merged[key], field as PlainObject[], relation.relatedPk);
            continue;
        }

        merged[key] = field;
    }

    return merged as unknown as U & T;
}
