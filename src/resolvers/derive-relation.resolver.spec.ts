import { defineRelations } from "drizzle-orm";
import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { addressTable, categoryTable, postTable, postTagTable, tagTable, userTable } from "../../dev/drizzle/schema.js";
import { deriveRelation } from "./derive-relation.resolver.js";

// Mesmo shape de dev/drizzle/db.ts, sem precisar de uma conexão real.
const relationsSchema = defineRelations(
    { userTable, postTable, addressTable, categoryTable, tagTable, postTagTable },
    r => ({
        addressTable: {
            user: r.one.userTable({ from: r.addressTable.userId, to: r.userTable.id }),
        },
        postTable: {
            category: r.one.categoryTable({ from: r.postTable.categoryId, to: r.categoryTable.id }),
            user: r.one.userTable({ from: r.postTable.userId, to: r.userTable.id }),
            tags: r.many.tagTable({
                from: r.postTable.id.through(r.postTagTable.postId),
                to: r.tagTable.id.through(r.postTagTable.tagId),
            }),
        },
        categoryTable: {
            posts: r.many.postTable(),
        },
        userTable: {
            address: r.one.addressTable(),
            posts: r.many.postTable(),
        },
        tagTable: {
            posts: r.many.postTable({
                from: r.tagTable.id.through(r.postTagTable.tagId),
                to: r.postTable.id.through(r.postTagTable.postId),
            }),
        },
    }),
);

describe("deriveRelation", () => {
    it("should be defined", () => {
        expect(deriveRelation).toBeDefined();
    });

    it("relation 'many' (userTable.posts) -> mode 'otm' + fkThere na tabela relacionada", () => {
        const derived = deriveRelation(relationsSchema, "userTable", "posts");

        expect(derived).toEqual({
            table: postTable,
            mode: "otm",
            fkThere: "userId",
        });
    });

    it("relation 'one' inferida/reversa (userTable.address) -> mode 'oto' + fkThere (FK na tabela relacionada)", () => {
        const derived = deriveRelation(relationsSchema, "userTable", "address");

        expect(derived).toEqual({
            table: addressTable,
            mode: "oto",
            fkThere: "userId",
        });
        expect(derived).not.toHaveProperty("nullable");
    });

    it("relation 'one' explícita com FK unique nesta tabela (addressTable.user) -> mode 'oto' + fkHere", () => {
        const derived = deriveRelation(relationsSchema, "addressTable", "user");

        expect(derived).toEqual({
            table: userTable,
            mode: "oto",
            fkHere: "userId",
        });
    });

    it("relation 'one' explícita com FK não-unique nesta tabela (postTable.user) -> mode 'mto' + fkHere", () => {
        const derived = deriveRelation(relationsSchema, "postTable", "user");

        expect(derived).toEqual({
            table: userTable,
            mode: "mto",
            fkHere: "userId",
        });
    });

    it("relation 'one' com FK nullable nesta tabela (postTable.category) -> 'nullable' continua fora do derivado", () => {
        const derived = deriveRelation(relationsSchema, "postTable", "category");

        expect(derived).toEqual({
            table: categoryTable,
            mode: "mto",
            fkHere: "categoryId",
        });
        expect(derived).not.toHaveProperty("nullable");
    });

    it("relation 'many' inferida/reversa (categoryTable.posts) -> mode 'otm' + fkThere", () => {
        const derived = deriveRelation(relationsSchema, "categoryTable", "posts");

        expect(derived).toEqual({
            table: postTable,
            mode: "otm",
            fkThere: "categoryId",
        });
    });

    it("retorna 'undefined' quando a tabela não existe em relationsSchema", () => {
        expect(deriveRelation(relationsSchema, "naoExiste", "posts")).toBeUndefined();
    });

    it("retorna 'undefined' quando a relation não existe nessa tabela", () => {
        expect(deriveRelation(relationsSchema, "userTable", "naoExiste")).toBeUndefined();
    });

    it("retorna 'undefined' pra FK composta (mais de uma coluna em sourceColumns/targetColumns)", () => {
        const orgTable = pgTable("org", { a: uuid(), b: uuid() });
        const memberTable = pgTable("member", { orgA: uuid(), orgB: uuid(), name: varchar() });

        const compositeSchema = defineRelations({ orgTable, memberTable }, r => ({
            memberTable: {
                org: r.one.orgTable({
                    from: [r.memberTable.orgA, r.memberTable.orgB],
                    to: [r.orgTable.a, r.orgTable.b],
                }),
            },
        }));

        expect(deriveRelation(compositeSchema, "memberTable", "org")).toBeUndefined();
    });

    it("relation 'many' com '.through(...)' (postTable.tags) -> mode 'mtm' + through/throughFkHere/throughFkThere", () => {
        const derived = deriveRelation(relationsSchema, "postTable", "tags");

        expect(derived).toEqual({
            table: tagTable,
            mode: "mtm",
            through: postTagTable,
            throughFkHere: "postId",
            throughFkThere: "tagId",
        });
    });

    it("relation 'mtm' no lado inverso (tagTable.posts) -> mesma tabela pivot, colunas invertidas", () => {
        const derived = deriveRelation(relationsSchema, "tagTable", "posts");

        expect(derived).toEqual({
            table: postTable,
            mode: "mtm",
            through: postTagTable,
            throughFkHere: "tagId",
            throughFkThere: "postId",
        });
    });

    it("retorna 'undefined' pra 'through' composto (mais de uma coluna em through.source/through.target)", () => {
        const memberTable = pgTable("member2", { id: uuid().primaryKey() });
        const labelTable = pgTable("label2", { id: uuid().primaryKey() });
        const memberLabelTable = pgTable("member_label2", {
            memberIdA: uuid(),
            memberIdB: uuid(),
            labelId: uuid(),
        });

        const compositeThroughSchema = defineRelations({ memberTable, labelTable, memberLabelTable }, r => ({
            memberTable: {
                labels: r.many.labelTable({
                    from: [
                        r.memberTable.id.through(r.memberLabelTable.memberIdA),
                        r.memberTable.id.through(r.memberLabelTable.memberIdB),
                    ],
                    to: r.labelTable.id.through(r.memberLabelTable.labelId),
                }),
            },
        }));

        expect(deriveRelation(compositeThroughSchema, "memberTable", "labels")).toBeUndefined();
    });
});
