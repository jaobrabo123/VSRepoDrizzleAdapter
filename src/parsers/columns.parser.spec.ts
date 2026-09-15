import { VSRepoSelect } from "vsrepo";
import { parseColumns } from "./columns.parser.js";
import { User } from "../../dev/entities.js";
import { RelationsResolver } from "../types/relations-resolver.type.js";
import { createFlatRelationsResolver } from "../resolvers/relations-resolver.resolver.js";

describe("parseColumns", () => {
    const relations = createFlatRelationsResolver(new Set(["posts", "address"]));

    it("should be defined", () => {
        expect(parseColumns).toBeDefined();
    });

    it("should return only columns if the select has only scalars fields", () => {
        const select: VSRepoSelect<User> = {
            id: true,
            email: true,
            name: true,
        };

        const result = parseColumns(select, relations);

        expect(result).toEqual({
            with: undefined,
            columns: {
                id: true,
                email: true,
                name: true,
            },
        });
    });

    it("should return columns empty and 'with' with the nested columns if the select has only nested selects", () => {
        const select: VSRepoSelect<User> = {
            address: {
                city: true,
                state: true,
            },
            posts: {
                content: true,
                title: true,
            },
        };

        const result = parseColumns(select, relations);

        expect(result).toEqual({
            with: {
                address: {
                    columns: {
                        city: true,
                        state: true,
                    },
                },
                posts: {
                    columns: {
                        content: true,
                        title: true,
                    },
                },
            },
            columns: {},
        });
    });

    it("should return columns empty and 'with' with the nested relations as 'true' if the select has only nested relations marked as true", () => {
        const select: VSRepoSelect<User> = {
            address: true,
            posts: true,
        };

        const result = parseColumns(select, relations);

        expect(result).toEqual({
            with: {
                address: true,
                posts: true,
            },
            columns: {},
        });
    });

    it("should return columns and 'with' with nested columns if the select has scalars and nested fields selected", () => {
        const select: VSRepoSelect<User> = {
            address: {
                city: true,
                state: true,
            },
            email: true,
            name: true,
        };

        const result = parseColumns(select, relations);

        expect(result).toEqual({
            with: {
                address: {
                    columns: {
                        city: true,
                        state: true,
                    },
                },
            },
            columns: {
                email: true,
                name: true,
            },
        });
    });

    it("should return columns and 'with' with nested realtions as 'true' if the select has scalars and nested relations marked as true", () => {
        const select: VSRepoSelect<User> = {
            address: true,
            posts: true,
            email: true,
            name: true,
        };

        const result = parseColumns(select, relations);

        expect(result).toEqual({
            with: {
                address: true,
                posts: true,
            },
            columns: {
                email: true,
                name: true,
            },
        });
    });

    it("should return a deep 'with' with the nested columns if the select has deep nested relations columns", () => {
        const select: VSRepoSelect<User> = {
            address: true,
            posts: {
                content: true,
                title: true,
                category: {
                    id: true,
                    name: true,
                },
            },
        };

        const result = parseColumns(select, relations);

        expect(result).toEqual({
            columns: {},
            with: {
                address: true,
                posts: {
                    columns: {
                        content: true,
                        title: true,
                    },
                    with: {
                        category: {
                            columns: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });
    });

    // Observação documentada no README (seção "relations nas options (leitura)"):
    // relations marcadas como `true` só são passadas para o campo `with` se elas
    // foram reconhecidas pelo `RelationsResolver` passado (`relations`); com um
    // resolver "flat" (sem `relationsSchema` — construído a partir do `relations`
    // de write do constructor), uma relation DE uma relation marcada como `true`
    // (sem especificar os campos) é entendida como uma column, porque o resolver
    // não tem como saber quais são as relations do "posts", só as do nível atual.
    // Ver os testes de recursão abaixo (com um `RelationsResolver` construído a
    // partir de um `relationsSchema`, via `createRelationsResolver`).

    it("relation-de-relation marcada 'true' vira column quando o resolver é flat (sem relationsSchema)", () => {
        const select: VSRepoSelect<User> = {
            posts: {
                title: true,
                category: true,
            },
        };

        const result = parseColumns(select, relations);

        expect(result).toEqual({
            columns: {},
            with: {
                posts: {
                    columns: {
                        title: true,
                        category: true,
                    },
                },
            },
        });
    });

    it("relation-de-relation marcada 'true' vai para 'with' quando o resolver sabe recursar (relationsSchema)", () => {
        const postsRelations: RelationsResolver = {
            keys: new Set(["category"]),
            next: () => undefined,
        };
        const userRelations: RelationsResolver = {
            keys: new Set(["posts", "address"]),
            next: key => (key === "posts" ? postsRelations : undefined),
        };

        const select: VSRepoSelect<User> = {
            posts: {
                title: true,
                category: true,
            },
        };

        const result = parseColumns(select, userRelations);

        expect(result).toEqual({
            columns: {},
            with: {
                posts: {
                    columns: {
                        title: true,
                    },
                    with: {
                        category: true,
                    },
                },
            },
        });
    });

    it("recursa mais de um nível quando cada resolver expõe o próximo via 'next'", () => {
        const categoryRelations: RelationsResolver = {
            keys: new Set(["tags"]),
            next: () => undefined,
        };
        const postsRelations: RelationsResolver = {
            keys: new Set(["category"]),
            next: key => (key === "category" ? categoryRelations : undefined),
        };
        const userRelations: RelationsResolver = {
            keys: new Set(["posts"]),
            next: key => (key === "posts" ? postsRelations : undefined),
        };

        const select = {
            posts: {
                category: {
                    tags: true,
                },
            },
        };

        const result = parseColumns(select, userRelations);

        expect(result).toEqual({
            columns: {},
            with: {
                posts: {
                    columns: {},
                    with: {
                        category: {
                            columns: {},
                            with: {
                                tags: true,
                            },
                        },
                    },
                },
            },
        });
    });

    it("funciona sem nenhum resolver (undefined) — toda relation marcada 'true' vira column", () => {
        const select: VSRepoSelect<User> = {
            posts: true,
            email: true,
        };

        const result = parseColumns(select);

        expect(result).toEqual({
            with: undefined,
            columns: {
                posts: true,
                email: true,
            },
        });
    });
});
