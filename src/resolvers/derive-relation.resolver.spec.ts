import { defineRelations } from "drizzle-orm";
import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { addressTable, categoryTable, postTable, userTable } from "../../dev/drizzle/schema.js";
import { deriveRelation } from "./derive-relation.resolver.js";

// Mesmo shape de dev/drizzle/db.ts, sem precisar de uma conexão real.
const relationsSchema = defineRelations({ userTable, postTable, addressTable, categoryTable }, r => ({
    addressTable: {
        user: r.one.userTable({ from: r.addressTable.userId, to: r.userTable.id }),
    },
    postTable: {
        category: r.one.categoryTable({ from: r.postTable.categoryId, to: r.categoryTable.id }),
        user: r.one.userTable({ from: r.postTable.userId, to: r.userTable.id }),
    },
    categoryTable: {
        posts: r.many.postTable(),
    },
    userTable: {
        address: r.one.addressTable(),
        posts: r.many.postTable(),
    },
}));

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

        expect(derived?.table).toBe(addressTable);
        expect(derived?.mode).toBe("oto");
        expect(derived?.fkHere).toBeUndefined();
        expect(derived?.fkThere).toBe("userId");
        // addressTable.userId é NOT NULL -> não-opcional.
        expect(derived?.nullable).toBe(false);
    });

    it("relation 'one' explícita com FK unique nesta tabela (addressTable.user) -> mode 'oto' + fkHere", () => {
        const derived = deriveRelation(relationsSchema, "addressTable", "user");

        expect(derived).toEqual({
            table: userTable,
            mode: "oto",
            fkHere: "userId",
            nullable: false,
        });
    });

    it("relation 'one' explícita com FK não-unique nesta tabela (postTable.user) -> mode 'mto' + fkHere", () => {
        const derived = deriveRelation(relationsSchema, "postTable", "user");

        expect(derived).toEqual({
            table: userTable,
            mode: "mto",
            fkHere: "userId",
            nullable: false,
        });
    });

    it("relation 'one' com FK nullable nesta tabela (postTable.category) -> 'nullable: true'", () => {
        const derived = deriveRelation(relationsSchema, "postTable", "category");

        expect(derived).toEqual({
            table: categoryTable,
            mode: "mto",
            fkHere: "categoryId",
            nullable: true,
        });
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
});
