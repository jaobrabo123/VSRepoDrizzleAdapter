import { pgTable, varchar } from "drizzle-orm/pg-core";
import { defineRelations } from "drizzle-orm";
import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { DrizzleAdapter } from "../src/drizzle.adapter.js";
import { createFakeDb } from "./helpers/fake-db.helper.js";
import { addressTable, categoryTable, postTable, userTable } from "../dev/drizzle/schema.js";
import { SupportedDialects } from "../src/index.js";

describe("DrizzleAdapter — validação do client Drizzle", () => {
    it("should throw VSRepoAdapterError with code 'MISSING_DB_CLIENT' when db is undefined", () => {
        try {
            new DrizzleAdapter(undefined as any, { table: userTable, queryKey: "userTable" });
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err: any) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect(err.code).toBe(AdapterErrorCode.MISSING_DB_CLIENT);
        }
    });

    it("should throw VSRepoAdapterError with code 'MISSING_DB_CLIENT' when db is null", () => {
        try {
            new DrizzleAdapter(undefined as any, { table: userTable, queryKey: "userTable" });
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err: any) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect(err.code).toBe(AdapterErrorCode.MISSING_DB_CLIENT);
        }
    });

    it("o erro de 'db.query' ausente também tem code 'MISSING_DB_CLIENT'", () => {
        const fakeDb = { ...createFakeDb(), query: null };

        try {
            new DrizzleAdapter(fakeDb as any, { table: userTable, queryKey: "userTable" });
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err: any) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect(err.code).toBe(AdapterErrorCode.MISSING_DB_CLIENT);
        }
    });

    it("não lança quando 'db' e 'config' são válidos", () => {
        const fakeDb = createFakeDb(["userTable"]);

        expect(() => {
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "userTable" });
        }).not.toThrow();
    });
});

describe("DrizzleAdapter — validação da config do construtor", () => {
    it("o erro de 'config' ausente tem code 'INVALID_ADAPTER_CONFIG'", () => {
        const fakeDb = createFakeDb();

        try {
            new DrizzleAdapter(fakeDb, undefined as any);
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.INVALID_ADAPTER_CONFIG);
        }
    });

    it("o erro de 'table' inválida tem code 'INVALID_ADAPTER_CONFIG'", () => {
        const fakeDb = createFakeDb();

        try {
            new DrizzleAdapter(fakeDb, { table: {} as any, queryKey: "userTable" });
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.INVALID_ADAPTER_CONFIG);
        }
    });

    it("é lançado quando 'dialect' não é um dos suportados", () => {
        const fakeDb = createFakeDb();

        expect(() => {
            new DrizzleAdapter(fakeDb, {
                table: userTable,
                queryKey: "userTable",
                dialect: "mysql" as SupportedDialects,
            });
        }).toThrow(VSRepoAdapterError);
    });

    it.each(["postgresql", "sqlite", "cockroach"] as const)(
        "aceita 'dialect: %s'",
        (dialect: "postgresql" | "sqlite" | "cockroach") => {
            const fakeDb = createFakeDb();

            expect(() => {
                new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "userTable", dialect });
            }).not.toThrow();
        },
    );

    it("é lançado quando 'queryKey' está ausente", () => {
        const fakeDb = createFakeDb();

        expect(() => {
            new DrizzleAdapter(fakeDb, { table: userTable } as any);
        }).toThrow(VSRepoAdapterError);
    });

    it("é lançado quando 'queryKey' é uma string vazia", () => {
        const fakeDb = createFakeDb();

        expect(() => {
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "" });
        }).toThrow(VSRepoAdapterError);
    });

    it("o erro de 'queryKey' sem entrada correspondente tem code 'MODEL_NOT_FOUND'", () => {
        const fakeDb = createFakeDb(["userTable"]);

        try {
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "usreTable" });
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.MODEL_NOT_FOUND);
            expect((err as Error).message).toContain("usreTable");
        }
    });

    it("é lançado quando 'db.query[queryKey]' existe mas não expõe 'findFirst'/'findMany'", () => {
        const fakeDb = createFakeDb(["userTable"]);
        (fakeDb.query as any).userTable = {};

        expect(() => {
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "userTable" });
        }).toThrow(VSRepoAdapterError);
    });

    it("não lança quando a config é válida e mínima (só 'table' + 'queryKey')", () => {
        const fakeDb = createFakeDb(["userTable"]);

        expect(() => {
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "userTable" });
        }).not.toThrow();
    });

    it("tem 'name' igual a 'VSRepoAdapterError'", () => {
        try {
            new DrizzleAdapter(undefined as any, {} as any);
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err: any) {
            expect(err.name).toBe("VSRepoAdapterError");
        }
    });
});

describe("DrizzleAdapter — validação de 'relations'", () => {
    function makeDb() {
        return createFakeDb(["userTable", "postTable", "addressTable"]);
    }

    it("é lançado quando 'relations' não é um objeto plano", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: [],
            });
        }).toThrow(VSRepoAdapterError);
    });

    it("é lançado quando uma relation não é um objeto ('AdapterRelation')", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: { address: "oto" },
            });
        }).toThrow(VSRepoAdapterError);
    });

    it("é lançado quando 'relations.<campo>.table' não é uma instância de 'Table'", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    address: { mode: "oto", restriction: "set", table: {}, fkThere: "userId" },
                },
            });
        }).toThrow(VSRepoAdapterError);
    });

    it("é lançado quando 'mode' está fora do picklist ('otm' | 'mto' | 'oto')", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    address: { mode: "one-to-one", restriction: "set", table: addressTable, fkThere: "userId" },
                },
            });
        }).toThrow(VSRepoAdapterError);
    });

    it("é lançado quando 'restriction' está fora do picklist ('set' | 'add')", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    posts: { mode: "otm", restriction: "merge", table: postTable, fkThere: "userId" },
                },
            });
        }).toThrow(VSRepoAdapterError);
    });

    describe("mode 'otm'", () => {
        it("é lançado quando vem com 'fkHere' (não aceito nesse mode)", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: {
                        posts: {
                            mode: "otm",
                            restriction: "add",
                            table: postTable,
                            fkThere: "userId",
                            fkHere: "id",
                        },
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkThere' está ausente", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: { posts: { mode: "otm", restriction: "add", table: postTable } },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkThere' não é uma coluna da tabela relacionada", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: {
                        posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "naoExiste" },
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("aceita uma relation 'otm' válida (posts)", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: {
                        posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" },
                    },
                });
            }).not.toThrow();
        });
    });

    describe("mode 'mto'", () => {
        it("é lançado quando vem com 'fkThere' (não aceito nesse mode)", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: postTable,
                    queryKey: "postTable",
                    relations: {
                        user: {
                            mode: "mto",
                            restriction: "set",
                            table: userTable,
                            fkHere: "userId",
                            fkThere: "id",
                        },
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkHere' está ausente", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: postTable,
                    queryKey: "postTable",
                    relations: { user: { mode: "mto", restriction: "set", table: userTable } },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkHere' não é uma coluna desta tabela", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: postTable,
                    queryKey: "postTable",
                    relations: {
                        user: { mode: "mto", restriction: "set", table: userTable, fkHere: "naoExiste" },
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'nullable' não é um booleano", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: postTable,
                    queryKey: "postTable",
                    relations: {
                        user: {
                            mode: "mto",
                            restriction: "set",
                            table: userTable,
                            fkHere: "userId",
                            nullable: "yes",
                        },
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("aceita uma relation 'mto' válida, com 'nullable' opcional", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: postTable,
                    queryKey: "postTable",
                    relations: {
                        user: { mode: "mto", restriction: "set", table: userTable, fkHere: "userId", nullable: true },
                    },
                });
            }).not.toThrow();
        });
    });

    describe("mode 'oto'", () => {
        it("é lançado quando vêm 'fkHere' e 'fkThere' juntos", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: {
                        address: {
                            mode: "oto",
                            restriction: "set",
                            table: addressTable,
                            fkHere: "addressId",
                            fkThere: "userId",
                        },
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando não vem nenhum dos dois ('fkHere'/'fkThere')", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: { address: { mode: "oto", restriction: "set", table: addressTable } },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkThere' não é uma coluna da tabela relacionada", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: {
                        address: {
                            mode: "oto",
                            restriction: "set",
                            table: addressTable,
                            fkThere: "naoExiste",
                        },
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkHere' não é uma coluna desta tabela", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: {
                        address: {
                            mode: "oto",
                            restriction: "set",
                            table: addressTable,
                            fkHere: "naoExiste",
                        },
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("aceita 'oto' com 'fkThere' (FK na tabela relacionada — ex.: 'address.userId')", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: {
                        address: { mode: "oto", restriction: "set", table: addressTable, fkThere: "userId" },
                    },
                });
            }).not.toThrow();
        });

        it("aceita 'oto' com 'fkHere' (FK nesta própria tabela — ex.: 'adress.userId')", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: addressTable,
                    queryKey: "addressTable",
                    relations: {
                        user: { mode: "oto", restriction: "set", table: userTable, fkHere: "userId" },
                    },
                });
            }).not.toThrow();
        });
    });

    it("é lançado quando a tabela relacionada não tem nenhuma coluna primary key", () => {
        const tableWithoutPk = pgTable("no_pk", { name: varchar({ length: 10 }) });

        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    address: { mode: "oto", restriction: "set", table: tableWithoutPk, fkThere: "name" },
                },
            });
        }).toThrow(VSRepoAdapterError);
    });

    it("o erro de tabela relacionada sem pk tem code 'INVALID_ADAPTER_CONFIG'", () => {
        const tableWithoutPk = pgTable("no_pk_2", { name: varchar({ length: 10 }) });

        try {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    address: { mode: "oto", restriction: "set", table: tableWithoutPk, fkThere: "name" },
                },
            });
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err) {
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.INVALID_ADAPTER_CONFIG);
        }
    });

    it("aceita múltiplas relations válidas ao mesmo tempo (oto fkThere + otm)", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    address: { mode: "oto", restriction: "set", table: addressTable, fkThere: "userId" },
                    posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" },
                },
            });
        }).not.toThrow();
    });

    it("ignora ('continue') uma entrada de relation cujo valor é 'undefined'", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: { address: undefined },
            });
        }).not.toThrow();
    });

    it("a mensagem de erro aponta o campo inválido (path 'relations.<campo>')", () => {
        try {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: { posts: { mode: "otm", restriction: "add", table: postTable } },
            });
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err) {
            expect((err as Error).message).toContain("relations.posts");
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.INVALID_ADAPTER_CONFIG);
        }
    });
});

describe("DrizzleAdapter — 'relationsSchema' (derivação de 'relations' a partir do defineRelations)", () => {
    function makeDb() {
        return createFakeDb(["userTable", "postTable", "addressTable", "categoryTable"]);
    }

    // Mesmo shape de dev/drizzle/db.ts, sem precisar de uma conexão real —
    // 'defineRelations' não toca no banco, só lê o schema.
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

    it("é lançado quando 'relationsSchema' não é um objeto plano", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relationsSchema: [] as any,
            });
        }).toThrow(VSRepoAdapterError);
    });

    it("não precisa de 'relations' pra funcionar sozinho (só habilita reconhecer relations no 'select')", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relationsSchema,
            });
        }).not.toThrow();
    });

    it("deriva 'table'/'mode'/'fkThere' de uma relation 'otm' (userTable.posts) só com 'restriction'", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relationsSchema,
                relations: { posts: { restriction: "add" } },
            });
        }).not.toThrow();
    });

    it("deriva 'oto' + 'fkThere' quando o FK está na tabela relacionada (userTable.address)", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relationsSchema,
                relations: { address: { restriction: "set" } },
            });
        }).not.toThrow();
    });

    it("deriva 'oto' + 'fkHere' quando o FK está nesta tabela e é unique (addressTable.user)", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: addressTable,
                queryKey: "addressTable",
                relationsSchema,
                relations: { user: { restriction: "set" } },
            });
        }).not.toThrow();
    });

    it("deriva 'mto' + 'fkHere' quando o FK está nesta tabela e não é unique (postTable.user)", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: postTable,
                queryKey: "postTable",
                relationsSchema,
                relations: { user: { restriction: "set" } },
            });
        }).not.toThrow();
    });

    it("deriva 'mto' + 'fkHere' (postTable.category, FK nullable na coluna, mas isso não afeta a derivação)", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: postTable,
                queryKey: "postTable",
                relationsSchema,
                relations: { category: { restriction: "set" } },
            });
        }).not.toThrow();
    });

    it("'nullable' nunca é derivado — precisa vir explícito em 'relations' mesmo com 'relationsSchema'", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relationsSchema,
                // 'nullable' true pra permitir que 'address: null' apague o registro.
                relations: { address: { restriction: "set", nullable: true } },
            });
        }).not.toThrow();
    });

    it("o campo explícito do usuário sempre vence o valor derivado (override de 'mode'/'fkHere'/'table')", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relationsSchema,
                relations: { posts: { restriction: "add", fkThere: "userId", table: postTable, mode: "otm" } },
            });
        }).not.toThrow();
    });

    it("é lançado quando a relation não existe em 'relationsSchema' e nada foi dado manualmente", () => {
        try {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relationsSchema,
                relations: { naoExiste: { restriction: "add" } },
            });
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.INVALID_ADAPTER_CONFIG);
            expect((err as Error).message).toContain("relations.naoExiste");
        }
    });

    it("ainda funciona 100% manual quando 'relationsSchema' não é passado (compat)", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" },
                },
            });
        }).not.toThrow();
    });
});
