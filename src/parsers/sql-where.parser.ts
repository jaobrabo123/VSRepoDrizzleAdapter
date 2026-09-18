/**
 * Parser that converts a `VSRepoWhere<T>` into a drizzle-orm `SQL` condition,
 * for the methods that go through Drizzle's *core* query builder
 * (`db.update(table).where(...)`, `db.delete(table).where(...)`,
 * `db.select(...).from(table).where(...)`) instead of the relational query
 * API (`db.query[queryKey].findFirst/findMany`) — the relational API has its
 * own object-shaped `where` (see `where.parser.ts`), but `update`/`delete`/
 * `select` don't accept that shape; they need an actual `SQL` expression
 * built from `eq`/`and`/`or`/... .
 *
 * Supports the same filters as `where.parser.ts`:
 *  - Direct value / field operators / `between` / `not` / string filters —
 *    same semantics, built with the matching drizzle-orm operator function
 *    instead of being passed through as a plain object.
 *  - `_some` / `_every` / `_none` (to-many relation, `otm` and `mtm`): all
 *    three translated into `EXISTS`/`NOT EXISTS` correlated subqueries
 *    against the related table (`_every` via the classic "no row fails the
 *    filter" SQL trick — `NOT EXISTS (... WHERE join AND NOT filter)`,
 *    vacuously true for a parent with no related rows, matching Prisma's
 *    `every` semantics). `otm` joins on the related table's FK (`fkThere`);
 *    `mtm` goes through the `through` join table, via a correlated
 *    `EXISTS (SELECT 1 FROM through WHERE ... both FKs ...)` link.
 *    Unlike `where.parser.ts` (the relational-API parser), which can't
 *    express `_every`/`_none` at all, this parser supports all three
 *    uniformly — `DrizzleAdapter` uses that to give `findOne`/`findMany`/etc.
 *    `_every`/`_none` support too, via a pk-prefetch through this parser
 *    (see `where.parser.ts`'s `hasQuantifierFilter`).
 *  - `_with` / `_without` (to-one relation, `mto`/`oto`): also an `EXISTS`
 *    subquery, joined on whichever side (`fkHere`/`fkThere`) the relation
 *    puts the FK on; `_without` negates the nested filter (not the
 *    existence check — mirrors `where.parser.ts`'s `NOT`-wrapping).
 *  - Root-level `AND`/`OR`/`NOT`.
 *
 * Nested filters inside a relation body (`_some`/`_with`/`_without`) only
 * see the related table's own scalar columns — a relation field can't be
 * filtered another level deep, since resolving that would need the related
 * table's *own* relation config, which this adapter doesn't have (only `T`'s
 * relations are configured).
 */

import {
    and,
    eq,
    exists,
    getTableName,
    gt,
    gte,
    inArray,
    isNotNull,
    isNull,
    like,
    lt,
    lte,
    not,
    notInArray,
    or,
    sql,
    Table,
    type SQL,
} from "drizzle-orm";
import { AdapterErrorCode, VSRepoAdapterError, VSRepoWhere } from "vsrepo";
import { DrizzleDbLike } from "../types/drizzle-db-like.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import { ResolvedRelation } from "../types/resolved-relation.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

export type SqlWhereContext = {
    table: Table;
    pk: string;
    relations?: Map<string, ResolvedRelation>;
    db: DrizzleDbLike;
};

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

/** Converts a `VSRepoFieldOperators<V>` object into a single (possibly `AND`-combined) `SQL` condition. */
function buildFieldOperators(column: any, ops: PlainObject): SQL | undefined {
    const parts: SQL[] = [];
    const likeFn =
        ops.ignoreCase === true ? (column: any, pattern: string) => sql`lower(${column}) like lower(${pattern})` : like;

    for (const [key, val] of Object.entries(ops)) {
        if (val === undefined) continue;

        switch (key) {
            case "ignoreCase":
                break;

            case "equals":
                parts.push(val === null ? isNull(column) : eq(column, val));
                break;

            case "not": {
                if (val === null) {
                    parts.push(isNotNull(column));
                    break;
                }
                const inner =
                    isPlainObject(val) && isFieldOperatorObject(val)
                        ? buildFieldOperators(column, val)
                        : eq(column, val);
                if (inner) parts.push(not(inner));
                break;
            }

            case "in":
                parts.push(inArray(column, val as unknown[]));
                break;

            case "notIn":
                parts.push(notInArray(column, val as unknown[]));
                break;

            case "gt":
                parts.push(gt(column, val));
                break;
            case "gte":
                parts.push(gte(column, val));
                break;
            case "lt":
                parts.push(lt(column, val));
                break;
            case "lte":
                parts.push(lte(column, val));
                break;

            case "between": {
                const [min, max] = val as [any, any];
                if (min !== undefined) parts.push(gte(column, min));
                if (max !== undefined) parts.push(lte(column, max));
                break;
            }

            case "contains":
                parts.push(likeFn(column, `%${val}%`));
                break;
            case "startsWith":
                parts.push(likeFn(column, `${val}%`));
                break;
            case "endsWith":
                parts.push(likeFn(column, `%${val}`));
                break;
        }
    }

    if (parts.length === 0) return undefined;
    return parts.length === 1 ? parts[0] : and(...parts);
}

/** Builds the join condition between `ctx.table` and a relation's related table. */
function buildJoinCondition(relation: ResolvedRelation, ctx: SqlWhereContext): SQL {
    const relatedColumns = relation.table as unknown as PlainObject;
    const hereColumns = ctx.table as unknown as PlainObject;

    if (relation.fkHere) {
        // FK lives on ctx.table, pointing at the related table's pk.
        return eq(relatedColumns[relation.relatedPk], hereColumns[relation.fkHere]);
    }

    // FK lives on the related table, pointing at ctx.table's pk.
    return eq(relatedColumns[relation.fkThere as string], hereColumns[ctx.pk]);
}

function buildExists(table: Table, condition: SQL, ctx: SqlWhereContext): SQL {
    const subquery = (ctx.db.select({ one: sql`1` }) as any).from(table).where(condition);
    return exists(subquery);
}

/**
 * Builds the correlated-exists link between this table (`ctx.table`) and an
 * `mtm` relation's related table, going through the join `through` table —
 * there's no FK on either side of a many-to-many, only join rows. The result
 * is meant to sit inside the related table's `EXISTS` subquery as its "join":
 * `EXISTS (SELECT 1 FROM through WHERE through.fkHere = <ctx.table pk> AND
 * through.fkThere = <related table pk>)`, correlating to the related row's
 * pk from the enclosing subquery and to `ctx.table`'s pk from the outermost
 * query.
 */
function buildMtmLinkCondition(relation: ResolvedRelation, ctx: SqlWhereContext): SQL {
    const through = relation.through as unknown as PlainObject;
    const condition = and(
        eq(through[relation.throughFkHere as string], (ctx.table as unknown as PlainObject)[ctx.pk]),
        eq(through[relation.throughFkThere as string], (relation.table as unknown as PlainObject)[relation.relatedPk]),
    );
    return buildExists(relation.through as Table, condition!, ctx);
}

function buildRelationCondition(
    key: string,
    value: PlainObject,
    relation: ResolvedRelation,
    ctx: SqlWhereContext,
): SQL {
    const nestedCtx: SqlWhereContext = { ...ctx, table: relation.table, relations: undefined };

    if (isArrayRelationFilter(value)) {
        if (relation.mode !== "otm" && relation.mode !== "mtm") {
            throw new VSRepoAdapterError(
                `Field '${key}': '_some'/'_every'/'_none' can only be used on a to-many ('otm'/'mtm') relation.`,
                AdapterErrorCode.INVALID_DATA,
                null,
            );
        }

        // `otm` joins straight on the related table's FK; `mtm` has no FK on
        // either side, so the "join" is a correlated EXISTS through `through`.
        const join = relation.mode === "mtm" ? buildMtmLinkCondition(relation, ctx) : buildJoinCondition(relation, ctx);

        if (value._some !== undefined) {
            const nested = parsePlainWhere(value._some as PlainObject | undefined, nestedCtx);
            return buildExists(relation.table, nested ? and(join, nested)! : join, ctx);
        }

        if (value._none !== undefined) {
            const nested = parsePlainWhere(value._none as PlainObject | undefined, nestedCtx);
            return not(buildExists(relation.table, nested ? and(join, nested)! : join, ctx));
        }

        // `_every`: no related row may FAIL the filter — i.e. no row exists matching
        // (joined AND NOT filter). Vacuously true when there are no related rows at
        // all, same as Prisma's `every` semantics. An empty filter (`{}`/`undefined`)
        // means "every row trivially satisfies nothing", so the condition is just `true`.
        const nested = parsePlainWhere(value._every as PlainObject | undefined, nestedCtx);
        if (!nested) return sql`(1 = 1)`;
        return not(buildExists(relation.table, and(join, not(nested))!, ctx));
    }

    if (isObjectRelationFilter(value)) {
        if (relation.mode === "otm" || relation.mode === "mtm") {
            throw new VSRepoAdapterError(
                `Field '${key}': '_with'/'_without' can only be used on a to-one relation.`,
                AdapterErrorCode.INVALID_DATA,
                null,
            );
        }

        const isWithout = "_without" in value;
        const filter = (isWithout ? value._without : value._with) as PlainObject | undefined;
        const join = buildJoinCondition(relation, ctx);
        const nested = parsePlainWhere(filter, nestedCtx);

        const condition = nested ? and(join, isWithout ? not(nested) : nested)! : join;
        return buildExists(relation.table, condition, ctx);
    }

    // Fallback: nested to-one filter passed directly, without a `_with`/`_without` wrapper.
    if (relation.mode === "otm" || relation.mode === "mtm") {
        throw new VSRepoAdapterError(
            `Field '${key}': to-many relation filters require '_some', '_every', or '_none'.`,
            AdapterErrorCode.INVALID_DATA,
            null,
        );
    }

    const join = buildJoinCondition(relation, ctx);
    const nested = parsePlainWhere(value, nestedCtx);
    return buildExists(relation.table, nested ? and(join, nested)! : join, ctx);
}

function buildFieldCondition(column: any, value: unknown): SQL | undefined {
    if (value === null) return isNull(column);

    if (value instanceof Date || typeof value !== "object") {
        return eq(column, value);
    }

    if (Array.isArray(value)) {
        return inArray(column, value);
    }

    return buildFieldOperators(column, value as PlainObject);
}

function parsePlainWhere(where: PlainObject | undefined | null, ctx: SqlWhereContext): SQL | undefined {
    if (where === undefined || where === null) return undefined;

    const tableColumns = ctx.table as unknown as PlainObject;
    const parts: SQL[] = [];

    for (const [key, value] of Object.entries(where)) {
        if (value === undefined) continue;

        const relation = ctx.relations?.get(key);
        if (relation) {
            parts.push(buildRelationCondition(key, value as PlainObject, relation, ctx));
            continue;
        }

        const column = tableColumns[key];
        if (column === undefined) {
            throw new VSRepoAdapterError(
                `Unknown field '${key}' in 'where': no column or configured relation with that name on table ` +
                    `'${getTableName(ctx.table)}'.`,
                AdapterErrorCode.FIELD_NOT_FOUND,
                null,
            );
        }

        const condition = buildFieldCondition(column, value);
        if (condition) parts.push(condition);
    }

    if (parts.length === 0) return undefined;
    return parts.length === 1 ? parts[0] : and(...parts);
}

function parseWhere(where: PlainObject | undefined | null, ctx: SqlWhereContext): SQL | undefined {
    if (where === undefined || where === null) return undefined;

    const parts: SQL[] = [];
    let orPart: SQL | undefined;
    const plainEntries: PlainObject = {};

    for (const [key, value] of Object.entries(where)) {
        if (value === undefined) continue;

        if (key === "AND") {
            const list = Array.isArray(value) ? value : [value];
            for (const v of list) {
                const c = parseWhere(v, ctx);
                if (c) parts.push(c);
            }
            continue;
        }

        if (key === "OR") {
            const list = Array.isArray(value) ? value : [value];
            const ors = list.map(v => parseWhere(v, ctx)).filter((c): c is SQL => c !== undefined);
            if (ors.length > 0) orPart = ors.length === 1 ? ors[0] : or(...ors);
            continue;
        }

        if (key === "NOT") {
            const list = Array.isArray(value) ? value : [value];
            for (const v of list) {
                const c = parseWhere(v, ctx);
                if (c) parts.push(not(c));
            }
            continue;
        }

        plainEntries[key] = value;
    }

    const plainCondition = parsePlainWhere(plainEntries, ctx);
    if (plainCondition) parts.push(plainCondition);
    if (orPart) parts.push(orPart);

    if (parts.length === 0) return undefined;
    return parts.length === 1 ? parts[0] : and(...parts);
}

/**
 * Use the second generic to type the return with a specific `SQL<...>`, if desired.
 */
export function parseSqlWhere<T>(where: VSRepoWhere<T> | undefined | null, ctx: SqlWhereContext): SQL | undefined {
    return parseWhere(where as PlainObject | undefined | null, ctx);
}
