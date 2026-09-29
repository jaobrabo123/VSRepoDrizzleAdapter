import { parseDrizzleWhere } from "./where.parser.js";
import { User } from "../../dev/entities.js";

describe("parseDrizzleWhere", () => {
    it("should be defined", () => {
        expect(parseDrizzleWhere).toBeDefined();
    });

    it("devolve 'undefined' para um where vazio", () => {
        expect(parseDrizzleWhere(undefined, "postgresql")).toBeUndefined();
        expect(parseDrizzleWhere(null, "postgresql")).toBeUndefined();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // `null` — o filtro que o `softRemoveKey` do `VSRepository` injeta em toda
    // leitura (`{ removedAt: null }`). Repassar o `null` cru quebrava o Drizzle:
    // a API relacional trata qualquer objeto como filtro de campo aninhado e
    // chama `Object.entries()` nele, e `typeof null === "object"`.
    // ─────────────────────────────────────────────────────────────────────────
    describe("null", () => {
        it("traduz 'null' em '{ isNull: true }' (e não em '{ eq: null }', que viraria '= NULL')", () => {
            expect(parseDrizzleWhere({ deletedAt: null }, "postgresql")).toEqual({ deletedAt: { isNull: true } });
        });

        it("traduz 'equals: null' em '{ isNull: true }'", () => {
            expect(parseDrizzleWhere({ deletedAt: { equals: null } }, "postgresql")).toEqual({
                deletedAt: { isNull: true },
            });
        });

        it("traduz 'not: null' em '{ NOT: { isNull: true } }' (o filtro de 'see: removed')", () => {
            expect(parseDrizzleWhere({ deletedAt: { not: null } }, "postgresql")).toEqual({
                deletedAt: { NOT: { isNull: true } },
            });
        });

        it("traduz 'not: { equals: null }' em '{ NOT: { isNull: true } }'", () => {
            expect(parseDrizzleWhere({ deletedAt: { not: { equals: null } } } as any, "postgresql")).toEqual({
                deletedAt: { NOT: { isNull: true } },
            });
        });

        it("traduz 'null' dentro de um operador de campo aninhado em relação ('_some')", () => {
            expect(parseDrizzleWhere({ posts: { _some: { deletedAt: null } } } as never, "postgresql")).toEqual({
                posts: { deletedAt: { isNull: true } },
            });
        });

        it("traduz 'null' dentro de um filtro de relação to-one ('_with')", () => {
            expect(parseDrizzleWhere({ author: { _with: { deletedAt: null } } } as never, "postgresql")).toEqual({
                author: { deletedAt: { isNull: true } },
            });
        });

        it("mantém 'null' separado de um valor real no mesmo where", () => {
            expect(parseDrizzleWhere({ id: "abc", deletedAt: null } as never, "postgresql")).toEqual({
                id: "abc",
                deletedAt: { isNull: true },
            });
        });

        it("traduz 'null' dentro de 'AND'/'OR'/'NOT' de raiz", () => {
            expect(parseDrizzleWhere({ NOT: { deletedAt: null } } as never, "postgresql")).toEqual({
                NOT: { deletedAt: { isNull: true } },
            });

            expect(parseDrizzleWhere({ OR: [{ deletedAt: null }, { id: "abc" }] } as never, "postgresql")).toEqual({
                OR: [{ deletedAt: { isNull: true } }, { id: "abc" }],
            });
        });

        it("traduz 'null' no mesmo filtro que já tem 'ignoreCase' (o 'likeKey' do sqlite não interfere)", () => {
            expect(parseDrizzleWhere({ name: { contains: "ana", ignoreCase: true } } as any, "sqlite")).toEqual({
                name: { like: "%ana%" },
            });

            expect(parseDrizzleWhere({ name: { contains: "ana", ignoreCase: true } } as any, "postgresql")).toEqual({
                name: { ilike: "%ana%" },
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Regressão: o resto do mapeamento não pode ter mudado.
    // ─────────────────────────────────────────────────────────────────────────
    describe("mapeamento dos demais formatos", () => {
        it("passa valores primitivos direto (shorthand de 'eq' do Drizzle)", () => {
            expect(parseDrizzleWhere({ name: "Ana", age: 30, active: true }, "postgresql")).toEqual({
                name: "Ana",
                age: 30,
                active: true,
            });
        });

        it("passa 'Date' direto", () => {
            const date = new Date("2026-01-01T00:00:00.000Z");

            expect(parseDrizzleWhere({ createdAt: date } as never, "postgresql")).toEqual({ createdAt: date });
        });

        it("trata array como shorthand de 'in'", () => {
            expect(parseDrizzleWhere({ name: ["Ana", "Bia"] }, "postgresql")).toEqual({
                name: { in: ["Ana", "Bia"] },
            });
        });

        it("mapeia 'between' pra 'gte' + 'lte'", () => {
            expect(parseDrizzleWhere({ age: { between: [18, 65] } }, "postgresql")).toEqual({
                age: { gte: 18, lte: 65 },
            });
        });

        it("mapeia 'startsWith'/'endsWith' pra 'like'", () => {
            expect(parseDrizzleWhere({ name: { startsWith: "An" } } as any, "postgresql")).toEqual({
                name: { like: "An%" },
            });
            expect(parseDrizzleWhere({ name: { endsWith: "na" } } as any, "postgresql")).toEqual({
                name: { like: "%na" },
            });
        });

        it("mapeia 'not' com valor simples pra 'NOT'", () => {
            expect(parseDrizzleWhere({ name: { not: "Ana" } }, "postgresql")).toEqual({ name: { NOT: "Ana" } });
        });

        it("mapeia 'not' com objeto de operadores recursivamente", () => {
            expect(parseDrizzleWhere({ name: { not: { contains: "ana" } } } as any, "postgresql")).toEqual({
                name: { NOT: { like: "%ana%" } },
            });
        });

        it("mescla 'AND' de raiz e 'NOT' em lista num único 'AND'", () => {
            expect(
                parseDrizzleWhere({ AND: [{ role: "admin" }], NOT: [{ active: false }] } as never, "postgresql"),
            ).toEqual({
                AND: [{ role: "admin" }, { NOT: { active: false } }],
            });
        });

        it("mapeia filtro de relação to-many ('_some') e to-one ('_with'/'_without')", () => {
            expect(parseDrizzleWhere({ posts: { _some: { title: "x" } } } as never, "postgresql")).toEqual({
                posts: { title: "x" },
            });

            expect(parseDrizzleWhere({ author: { _with: { id: "1" } } } as never, "postgresql")).toEqual({
                author: { id: "1" },
            });

            expect(parseDrizzleWhere({ author: { _without: { id: "1" } } } as never, "postgresql")).toEqual({
                author: { NOT: { id: "1" } },
            });
        });

        it("lança 'VSRepoAdapterError' (code 'NOT_SUPPORTED') em '_every'/'_none'", () => {
            expect(() => parseDrizzleWhere({ posts: { _every: { title: "x" } } } as never, "postgresql")).toThrow(
                /every.*none|every|none/i,
            );
        });

        it("ignora chaves com valor 'undefined'", () => {
            expect(parseDrizzleWhere({ name: "Ana", email: undefined }, "postgresql")).toEqual({ name: "Ana" });
        });

        it("aceita 'VSRepoWhere<User>' com os campos da entidade", () => {
            const where: import("vsrepo").VSRepoWhere<User> = { name: { startsWith: "An" } };

            expect(parseDrizzleWhere(where, "postgresql")).toEqual({ name: { like: "An%" } });
        });
    });
});
