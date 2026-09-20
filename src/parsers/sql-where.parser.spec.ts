import { Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { addressTable, categoryTable, postTable, postTagTable, tagTable, userTable } from "../../dev/drizzle/schema.js";
import { ResolvedRelation } from "../types/resolved-relation.type.js";
import { parseSqlWhere, SqlWhereContext } from "./sql-where.parser.js";

// Offline drizzle instance — the adapter only ever *builds* queries with it here
// (`.toSQL()` needs no connection), so no DATABASE_URL is required for these tests.
const db = drizzle({} as never);

/** Compiles `condition` into a SQL string via `db.select().from(table).where(condition).toSQL()`. */
function toSql(condition: unknown, table: Table = postTable): string {
    const { sql } = (db as any)
        .select({ id: (table as any).id })
        .from(table)
        .where(condition)
        .toSQL();
    return sql;
}

function expectInvalidData(fn: () => unknown, messagePattern: RegExp): void {
    let thrown: unknown;
    try {
        fn();
    } catch (error: any) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(VSRepoAdapterError);
    expect((thrown as { code: AdapterErrorCode }).code).toBe(AdapterErrorCode.INVALID_DATA);
    expect((thrown as Error).message).toMatch(messagePattern);
}

/** `postTable` <-> `tagTable` many-to-many via `postTagTable` (matches dev/drizzle/db.ts). */
const postMtmTags: ResolvedRelation = {
    mode: "mtm",
    restriction: "set",
    table: tagTable,
    relatedPk: "id",
    through: postTagTable,
    throughFkHere: "postId",
    throughFkThere: "tagId",
};

/** `postTable` -> `categoryTable` many-to-one. */
const postMtoCategory: ResolvedRelation = {
    mode: "mto",
    restriction: "set",
    table: categoryTable,
    relatedPk: "id",
    fkHere: "categoryId",
    nullable: true,
};

/** `userTable` -> `postTable` one-to-many. */
const userOtmPosts: ResolvedRelation = {
    mode: "otm",
    restriction: "set",
    table: postTable,
    relatedPk: "id",
    fkThere: "userId",
};

/** `userTable` -> `addressTable` one-to-one (FK on the related table). */
const userOtoAddress: ResolvedRelation = {
    mode: "oto",
    restriction: "set",
    table: addressTable,
    relatedPk: "id",
    fkThere: "userId",
};

const postCtx: SqlWhereContext = {
    table: postTable,
    pk: "id",
    relations: new Map([
        ["tags", postMtmTags],
        ["category", postMtoCategory],
    ]),
    db: db as any,
};

const userCtx: SqlWhereContext = {
    table: userTable,
    pk: "id",
    relations: new Map([
        ["posts", userOtmPosts],
        ["address", userOtoAddress],
    ]),
    db: db as any,
};

describe("parseSqlWhere", () => {
    it("should be defined", () => {
        expect(parseSqlWhere).toBeDefined();
    });

    describe("mtm relation quantifiers", () => {
        it("should build an EXISTS-through-through subquery for _some", () => {
            const condition = parseSqlWhere({ tags: { _some: { name: "backend" } } } as never, postCtx);
            const sql = toSql(condition, postTable);

            expect(sql).toContain('"Tag"');
            expect(sql).toContain('"PostTag"');
            expect(sql).toContain('"PostTag"."postId" = "Post"."id"');
            expect(sql).toContain('"PostTag"."tagId" = "Tag"."id"');
            expect(sql).toContain('"Tag"."name" = ');
        });

        it("should negate the EXISTS for _none", () => {
            const condition = parseSqlWhere({ tags: { _none: { name: "backend" } } } as never, postCtx);
            const sql = toSql(condition, postTable);

            expect(sql).toContain("not (exists");
            expect(sql).toContain('"PostTag"');
        });

        it("should use the NOT EXISTS failing-row trick for _every with a filter", () => {
            const condition = parseSqlWhere({ tags: { _every: { name: { startsWith: "b" } } } } as never, postCtx);
            const sql = toSql(condition, postTable);

            expect(sql).toContain("not (exists");
            expect(sql).toContain('"PostTag"');
            expect(sql).toContain('not ("Tag"."name" like ');
        });

        it("should be vacuously true for _every with an empty filter", () => {
            const condition = parseSqlWhere({ tags: { _every: {} } } as never, postCtx);
            const sql = toSql(condition, postTable);

            expect(sql).toContain("(1 = 1)");
        });

        it("should still work when no relation column is filtered (bare _some)", () => {
            const condition = parseSqlWhere({ tags: { _some: {} } } as never, postCtx);
            const sql = toSql(condition, postTable);

            expect(sql).toContain('"PostTag"');
        });

        it("should throw INVALID_DATA for _with/_without (to-one only)", () => {
            expectInvalidData(
                () => parseSqlWhere({ tags: { _with: { name: "backend" } } } as never, postCtx),
                /'_with'\/'_without' can only be used on a to-one relation/,
            );
            expectInvalidData(
                () => parseSqlWhere({ tags: { _without: { name: "backend" } } } as never, postCtx),
                /'_with'\/'_without' can only be used on a to-one relation/,
            );
        });

        it("should throw INVALID_DATA for a bare (wrapper-less) to-many filter", () => {
            expectInvalidData(
                () => parseSqlWhere({ tags: { name: "backend" } } as never, postCtx),
                /to-many relation filters require '_some', '_every', or '_none'/,
            );
        });
    });

    describe("relation-mode guards", () => {
        it("should throw INVALID_DATA for _some on a to-one (mto) relation", () => {
            expectInvalidData(
                () => parseSqlWhere({ category: { _some: { name: "x" } } } as never, postCtx),
                /'_some'\/'_every'\/'_none' can only be used on a to-many \('otm'\/'mtm'\) relation/,
            );
        });

        it("should throw INVALID_DATA for _every on a to-one (oto) relation", () => {
            expectInvalidData(
                () => parseSqlWhere({ address: { _every: { city: "x" } } } as never, userCtx),
                /'_some'\/'_every'\/'_none' can only be used on a to-many \('otm'\/'mtm'\) relation/,
            );
        });
    });

    describe("otm regression", () => {
        it("should keep building the FK join for _some on an otm relation", () => {
            const condition = parseSqlWhere({ posts: { _some: { title: "x" } } } as never, userCtx);
            const sql = toSql(condition, userTable);

            expect(sql).toContain('"Post"');
            expect(sql).toContain('"Post"."userId" = "User"."id"');
            expect(sql).toContain('"Post"."title" = ');
        });
    });
});
