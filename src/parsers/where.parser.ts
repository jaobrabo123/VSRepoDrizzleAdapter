/**
 * Parser that converts a `VSRepoWhere<T>` (the application's "friendly"
 * filter format) into the `where` shape accepted by
 * `db.query[queryKey].findFirst/findMany` — Drizzle's rqbv2 relational query
 * API, built via `defineRelations`.
 *
 * Supports:
 *  - Direct value:              { name: "Ana" }                    -> { name: "Ana" } (Drizzle's own shorthand for `eq`)
 *  - Field operators:           { age: { gte: 18, lte: 65 } }       -> passed through as-is (Drizzle uses the same keys)
 *  - `between`:                 { age: { between: [18, 65] } }     -> { gte: 18, lte: 65 }
 *  - `not` (value or operator): { name: { not: "Ana" } }            -> { name: { NOT: "Ana" } }
 *                                { name: { not: { contains: "an" } } }
 *  - Strings:                   { name: { contains: "ana" } }      -> { like: "%ana%" }
 *                                { name: { contains: "ana", ignoreCase: true } } -> { ilike: "%ana%" }
 *  - To-many relation (array):  { posts: { _some: { title: "x" } } } -> { posts: { title: "x" } }
 *                                Drizzle's relational filter has no native `every`/`none` semantics for
 *                                to-many relations (only an implicit `some`/exists filter) — `_every`/`_none`
 *                                throw `VSRepoAdapterError` (code `NOT_SUPPORTED`) instead of silently
 *                                producing a wrong query.
 *  - To-one relation (object):  { author: { _with: { id: 1 } } }    -> { author: { id: 1 } }
 *                                { author: { _without: { id: 1 } } } -> { author: { NOT: { id: 1 } } }
 *  - Root-level logical ops:    { AND: [...], OR: [...], NOT: {...} }
 *                                `NOT` receiving a list (allowed by `VSRepoWhere`, but Drizzle's own `NOT`
 *                                only accepts a single nested filter) is translated into an `AND` of
 *                                individually-negated entries — "none of these match" — merging into any
 *                                `AND` already present at that level.
 */

import { AdapterErrorCode, VSRepoAdapterError, VSRepoWhere } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

/** Keys recognized as a `VSRepoFieldOperators` object. */
const FIELD_OPERATOR_KEYS = new Set([
    "equals",
    "not",
    "in",
    "notIn",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "contains",
    "startsWith",
    "endsWith",
    "ignoreCase",
]);

function isFieldOperatorObject(value: PlainObject): boolean {
    return Object.keys(value).some(key => FIELD_OPERATOR_KEYS.has(key));
}

function isArrayRelationFilter(value: PlainObject): boolean {
    return "_some" in value || "_every" in value || "_none" in value;
}

function isObjectRelationFilter(value: PlainObject): boolean {
    return "_with" in value || "_without" in value;
}

/** Converts a `VSRepoFieldOperators<V>` into a Drizzle relational field filter. */
function parseFieldOperators(value: PlainObject): PlainObject {
    const result: PlainObject = {};
    const likeKey = value.ignoreCase === true ? "ilike" : "like";

    for (const [key, val] of Object.entries(value)) {
        if (val === undefined) continue;

        switch (key) {
            case "ignoreCase":
                // handled above, via `likeKey` — not a Drizzle filter key on its own
                break;

            case "equals":
                result.eq = val;
                break;

            case "between": {
                const [min, max] = val as [any, any];
                if (min !== undefined) result.gte = min;
                if (max !== undefined) result.lte = max;
                break;
            }

            case "contains":
                result[likeKey] = `%${val}%`;
                break;

            case "startsWith":
                result[likeKey] = `${val}%`;
                break;

            case "endsWith":
                result[likeKey] = `%${val}`;
                break;

            case "not":
                result.NOT = isPlainObject(val) && isFieldOperatorObject(val) ? parseFieldOperators(val) : val;
                break;

            default:
                // gt/gte/lt/lte/in/notIn already match Drizzle's field filter keys 1:1
                result[key] = val;
        }
    }

    return result;
}

/** Converts `{ _some, _every, _none }` into the filter applied to a to-many relation field. */
function parseArrayRelationFilter(value: PlainObject): PlainObject {
    if (value._every !== undefined || value._none !== undefined) {
        throw new VSRepoAdapterError(
            "Drizzle's relational query API has no native 'every'/'none' filter for to-many relations (only an " +
                "implicit 'some'/exists filter, via '_some') — rewrite the filter using '_some', or fall back to " +
                "'query()' with raw SQL.",
            AdapterErrorCode.NOT_SUPPORTED,
            null,
        );
    }

    return parsePlainWhere(value._some) ?? {};
}

/** Converts `{ _with, _without }` into the filter applied to a to-one relation field. */
function parseObjectRelationFilter(value: PlainObject): PlainObject {
    if (value._with !== undefined) {
        return parsePlainWhere(value._with) ?? {};
    }
    if (value._without !== undefined) {
        return { NOT: parsePlainWhere(value._without) };
    }
    return {};
}

/** Decides how to interpret the value of a single where field. */
function parseFieldValue(value: unknown): unknown {
    // Primitive values (string, number, boolean, Date, null, bigint) pass through
    // as-is — Drizzle's own shorthand for `eq`.
    if (value === null || typeof value !== "object" || value instanceof Date) {
        return value;
    }

    // Plain arrays used as a shorthand for `in`, e.g. { status: ["A", "B"] }.
    if (Array.isArray(value)) {
        return { in: value };
    }

    const obj = value as PlainObject;

    if (isArrayRelationFilter(obj)) return parseArrayRelationFilter(obj);
    if (isObjectRelationFilter(obj)) return parseObjectRelationFilter(obj);
    if (isFieldOperatorObject(obj)) return parseFieldOperators(obj);

    // fallback: nested to-one filter passed directly, without a `_with`/`_without` wrapper
    return parsePlainWhere(obj);
}

/**
 * Converts a `VSRepoWherePlain<T>` (no root `AND`/`OR`/`NOT`) — used for the
 * body of relation filters (`_some`/`_every`/`_none`/`_with`/`_without`).
 */
function parsePlainWhere(where: PlainObject | undefined | null): PlainObject | undefined {
    if (where === undefined || where === null) return undefined;

    const result: PlainObject = {};

    for (const [key, value] of Object.entries(where)) {
        if (value === undefined) continue;
        result[key] = parseFieldValue(value);
    }

    return result;
}

/** Converts a full `VSRepoWhere<T>` (root level, with `AND`/`OR`/`NOT`) into a Drizzle relational filter. */
function parseWhere(where: PlainObject | undefined | null): PlainObject | undefined {
    if (where === undefined || where === null) return undefined;

    const result: PlainObject = {};
    // Collected separately (instead of writing straight into `result.AND`) so
    // that an explicit `AND` and a list-form `NOT` at the same level merge
    // correctly no matter which key is iterated first.
    let andList: PlainObject[] | undefined;

    for (const [key, value] of Object.entries(where)) {
        if (value === undefined) continue;

        if (key === "AND") {
            const list = Array.isArray(value) ? value : [value];
            andList = [...(andList ?? []), ...list.map(v => parseWhere(v)!)];
            continue;
        }

        if (key === "OR") {
            const list = Array.isArray(value) ? value : [value];
            result.OR = list.map(v => parseWhere(v));
            continue;
        }

        if (key === "NOT") {
            if (Array.isArray(value)) {
                andList = [...(andList ?? []), ...value.map(v => ({ NOT: parseWhere(v) }))];
            } else {
                result.NOT = parseWhere(value);
            }
            continue;
        }

        result[key] = parseFieldValue(value);
    }

    if (andList) result.AND = andList;

    return result;
}

/**
 * Use the second generic to type the return with the specific
 * `RelationsFilter<...>` for your table, if desired.
 */
export function parseDrizzleWhere<T, W = any>(where: VSRepoWhere<T> | undefined | null): W | undefined {
    return parseWhere(where as PlainObject | undefined | null) as W | undefined;
}
