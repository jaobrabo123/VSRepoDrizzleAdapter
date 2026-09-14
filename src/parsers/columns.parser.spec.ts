import { VSRepoSelect } from "vsrepo";
import { parseColumns } from "./columns.parser.js";
import { User } from "../../dev/entities.js";

describe("parseColumns", () => {
    const relationsKeysSet = new Set(["posts", "address"]);

    it("should be defined", () => {
        expect(parseColumns).toBeDefined();
    });

    it("should return only columns if the select has only scalars fields", () => {
        const select: VSRepoSelect<User> = {
            id: true,
            email: true,
            name: true,
        };

        const result = parseColumns(select, relationsKeysSet);

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

        const result = parseColumns(select, relationsKeysSet);

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

        const result = parseColumns(select, relationsKeysSet);

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

        const result = parseColumns(select, relationsKeysSet);

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

        const result = parseColumns(select, relationsKeysSet);

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

        const result = parseColumns(select, relationsKeysSet);

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
    // foram configuradas no constructor (`relationsKeysSet`); e uma relation DE uma
    // relation marcada como `true` (sem especificar os campos) também é entendida
    // como uma column.
});
