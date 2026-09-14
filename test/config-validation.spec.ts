import { pgTable, varchar } from "drizzle-orm/pg-core";
import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { DrizzleAdapter } from "../src/drizzle.adapter.js";
import { createFakeDb } from "./helpers/fake-db.helper.js";
import { addressTable, postTable, userTable } from "../dev/drizzle/schema.js";

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
        const fakeDb = { ...createFakeDb(), query: null as any };

        try {
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "userTable" });
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
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "userTable", dialect: "mysql" as any });
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
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "" as any });
        }).toThrow(VSRepoAdapterError);
    });

    it("o erro de 'queryKey' sem entrada correspondente tem code 'MODEL_NOT_FOUND'", () => {
        const fakeDb = createFakeDb(["userTable"]);

        try {
            new DrizzleAdapter(fakeDb, { table: userTable, queryKey: "usreTable" as any });
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
                relations: [] as any,
            });
        }).toThrow(VSRepoAdapterError);
    });

    it("é lançado quando uma relation não é um objeto ('AdapterRelation')", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: { address: "oto" } as any,
            });
        }).toThrow(VSRepoAdapterError);
    });

    it("é lançado quando 'relations.<campo>.table' não é uma instância de 'Table'", () => {
        expect(() => {
            new DrizzleAdapter(makeDb(), {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    address: { mode: "oto", restriction: "set", table: {} as any, fkThere: "userId" },
                } as any,
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
                } as any,
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
                } as any,
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
                        } as any,
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkThere' está ausente", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: { posts: { mode: "otm", restriction: "add", table: postTable } as any },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkThere' não é uma coluna da tabela relacionada", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: {
                        posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "naoExiste" as any },
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
                        } as any,
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkHere' está ausente", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: postTable,
                    queryKey: "postTable",
                    relations: { user: { mode: "mto", restriction: "set", table: userTable } as any },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando 'fkHere' não é uma coluna desta tabela", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: postTable,
                    queryKey: "postTable",
                    relations: {
                        user: { mode: "mto", restriction: "set", table: userTable, fkHere: "naoExiste" as any },
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
                            nullable: "yes" as any,
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
                        } as any,
                    },
                });
            }).toThrow(VSRepoAdapterError);
        });

        it("é lançado quando não vem nenhum dos dois ('fkHere'/'fkThere')", () => {
            expect(() => {
                new DrizzleAdapter(makeDb(), {
                    table: userTable,
                    queryKey: "userTable",
                    relations: { address: { mode: "oto", restriction: "set", table: addressTable } as any },
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
                            fkThere: "naoExiste" as any,
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
                            fkHere: "naoExiste" as any,
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
                    address: { mode: "oto", restriction: "set", table: tableWithoutPk, fkThere: "name" } as any,
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
                    address: { mode: "oto", restriction: "set", table: tableWithoutPk, fkThere: "name" } as any,
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
