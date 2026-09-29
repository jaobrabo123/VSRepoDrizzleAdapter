// Testes de SQL cru e placeholders do `DrizzleAdapter` através de uma
// `VSRepository` real: `query()` com string (placeholder nativo do dialeto),
// `query()` com um fragmento `VSSql`, `@QueryMethod` com `spreadArgs`,
// `withDb(tx)` dentro de uma transação, e o `vsPlaceholders: true` (SQL escrito
// com `?1`, `?2`, ... traduzido pro dialeto via `getPlaceholder()` do adapter).
// Requer um Postgres real (ver `vsrepository-integration.spec.ts`).
//
// NOTA sobre `@QueryMethod`: mesma convenção de
// `vsrepository-integration.spec.ts` — os decorators são aplicados de forma
// imperativa (`QueryMethod()(Classe.prototype, "nome")`) em vez de
// `@QueryMethod() declare nome: ...`; o efeito em runtime é idêntico.

import { Param, SQL } from "drizzle-orm";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import {
    AdapterErrorCode,
    DbArg,
    QueryMethod,
    VSLogLevel,
    VSRepoAdapterError,
    VSSql,
    VSRepository,
    withDb,
} from "vsrepo";
import { Role } from "../dev/enum/role.enum.js";
import { DrizzleAdapter } from "../src/drizzle.adapter.js";
import { DrizzleDbLike } from "../src/types/drizzle-db-like.type.js";
import { DrizzleOrmTypes } from "../src/types/drizzle-orm-types.type.js";
import cleanDbHelper from "./helpers/clean-db.helper.js";
import { createFakeDb, createFakePostgresDb, createFakeSqliteDb } from "./helpers/fake-db.helper.js";
import { createUser } from "./helpers/fixtures.js";
import { db } from "../dev/drizzle/db.js";
import { userTable } from "../dev/drizzle/schema.js";
import { User } from "../dev/entities.js";

type MyOrmTypes = DrizzleOrmTypes<typeof db>;

/**
 * Repositório com `vsPlaceholders: true` — o SQL dos `@QueryMethod`s é escrito
 * com `?1`, `?2`, ... e o `VSRepository` traduz cada placeholder pro dialeto do
 * adapter (`$1`, `$2`, ... no postgres) via `adapter.getPlaceholder()`.
 */
class RawUserRepository extends VSRepository<User, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, { queryKey: "userTable", table: userTable }),
            vsPlaceholders: true,
            logLevel: VSLogLevel.ERROR,
        });
    }
}

/** Assinaturas dos métodos registrados abaixo via `QueryMethod()`. */
type RawUserRepositoryType = RawUserRepository & {
    /** `spreadArgs`: os argumentos são posicionais (`?1` = 1º argumento). */
    findByEmailRaw(email: string): Promise<{ id: string; name: string }[]>;
    /** `spreadArgs` + `modifying: true`; o `db` é opcional e vem via `withDb(tx)`. */
    insertUser(name: string, role: Role, email: string, passwordHash: string, db?: DbArg): Promise<number>;
};

QueryMethod('SELECT id, name FROM "User" WHERE email = ?1', { spreadArgs: true })(
    RawUserRepository.prototype,
    "findByEmailRaw",
);
QueryMethod('INSERT INTO "User" (name, role, email, "passwordHash") VALUES (?1, ?2, ?3, ?4)', {
    modifying: true,
    spreadArgs: true,
})(RawUserRepository.prototype, "insertUser");

/** Repositório **sem** `vsPlaceholders` — o SQL usa o placeholder nativo (`$1`). */
class NativeUserRepository extends VSRepository<User, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, { queryKey: "userTable", table: userTable }),
            logLevel: VSLogLevel.ERROR,
        });
    }
}

describe("SQL cru e placeholders através de uma VSRepository real (integração com Postgres)", () => {
    let userRepository: RawUserRepositoryType;
    let nativeUserRepository: NativeUserRepository;

    beforeEach(async () => {
        await cleanDbHelper();
        userRepository = new RawUserRepository() as RawUserRepositoryType;
        nativeUserRepository = new NativeUserRepository();
    });

    describe("@QueryMethod com 'spreadArgs' e 'vsPlaceholders'", () => {
        it("findByEmailRaw roda um SELECT com '?1' e devolve as linhas", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const result = await userRepository.findByEmailRaw("ana@example.com");

            expect(result).toHaveLength(1);
            expect(result[0]?.id).toBe(user.id);
            expect(result[0]?.name).toBe("Ana");
        });

        it("insertUser ('modifying: true') insere a linha e devolve a contagem de linhas afetadas", async () => {
            const affected = await userRepository.insertUser(
                "Bruno",
                Role.ADMIN,
                "bruno@example.com",
                "hashed-password",
            );

            expect(affected).toBe(1);

            const [stored] = await userRepository.findByEmailRaw("bruno@example.com");
            expect(stored?.name).toBe("Bruno");
        });
    });

    describe("withDb(tx) fazendo o '@QueryMethod' rodar na transação", () => {
        it("o insert é desfeito quando o callback da transação rejeita", async () => {
            await expect(
                userRepository.transaction(async tx => {
                    const affected = await userRepository.insertUser(
                        "Joao",
                        Role.USER,
                        "joao@example.com",
                        "hashed-password",
                        withDb(tx),
                    );
                    expect(affected).toBe(1);

                    throw new Error("falha proposital");
                }),
            ).rejects.toThrow("falha proposital");

            expect(await userRepository.total()).toBe(0);
        });

        it("o insert é confirmado quando o callback da transação resolve", async () => {
            await userRepository.transaction(async tx => {
                await userRepository.insertUser("Joao", Role.USER, "joao@example.com", "hashed-password", withDb(tx));
            });

            expect(await userRepository.total()).toBe(1);
        });
    });

    describe("query() com fragmento 'VSSql' (independente de dialecto)", () => {
        it("parametriza os valores interpolados e devolve as linhas", async () => {
            await createUser({ email: "ana@example.com", name: "Ana" });
            await createUser({ email: "bruno@example.com", name: "Bruno" });

            const result = await userRepository.query<{ name: string }[]>(
                VSSql.sql`SELECT name FROM "User" WHERE email = ${"ana@example.com"}`,
            );

            expect(result).toEqual([{ name: "Ana" }]);
        });

        it("'VSSql.join' monta a lista de valores de um 'IN (...)' (prefix/suffix)", async () => {
            const ana = await createUser({ email: "ana@example.com", name: "Ana" });
            const bruno = await createUser({ email: "bruno@example.com", name: "Bruno" });
            await createUser({ email: "carla@example.com", name: "Carla" });

            // `prefix`/`suffix` são os parênteses do `IN (...)` — cada elemento
            // vira um parâmetro próprio.
            const result = await userRepository.query<{ name: string }[]>(
                VSSql.sql`SELECT name FROM "User"
                    WHERE email IN (${VSSql.join([ana.email, bruno.email])})
                    ORDER BY name`,
            );

            expect(result.map(row => row.name)).toEqual(["Ana", "Bruno"]);
        });
    });

    describe("query() com o placeholder nativo do dialeto (sem 'vsPlaceholders')", () => {
        it("um SELECT com '$1' devolve as linhas", async () => {
            await createUser({ email: "ana@example.com", name: "Ana" });

            const result = await nativeUserRepository.query<{ name: string }[]>(
                'SELECT name FROM "User" WHERE email = $1',
                { args: ["ana@example.com"] },
            );

            expect(result).toEqual([{ name: "Ana" }]);
        });

        it("'singleResult: true' colapsa o array no primeiro elemento (ou null)", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const found = await nativeUserRepository.query<{ name: string } | null>(
                'SELECT name FROM "User" WHERE id = $1',
                { args: [user.id], singleResult: true },
            );
            const missing = await nativeUserRepository.query<{ name: string } | null>(
                'SELECT name FROM "User" WHERE id = $1',
                { args: [crypto.randomUUID()], singleResult: true },
            );

            expect(found?.name).toBe("Ana");
            expect(missing).toBeNull();
        });

        it("'modifying: true' numa statement de escrita devolve a contagem de linhas afetadas", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const affected = await nativeUserRepository.query<number>('UPDATE "User" SET name = $1 WHERE id = $2', {
                args: ["Ana Paula", user.id],
                modifying: true,
            });

            expect(affected).toBe(1);
            expect((await nativeUserRepository.getOrThrow(user.id)).name).toBe("Ana Paula");
        });
    });
});

describe("DrizzleAdapter.getPlaceholder() (unidade, sem banco)", () => {
    it("devolve '$1', '$2', ... no postgres (base 1)", () => {
        const adapter = new DrizzleAdapter(createFakeDb(["userTable"]), { table: userTable, queryKey: "userTable" });

        expect(adapter.getPlaceholder(0)).toBe("$1");
        expect(adapter.getPlaceholder(1)).toBe("$2");
        expect(adapter.getPlaceholder(2)).toBe("$3");
    });

    it("devolve '?' no sqlite, independentemente do índice", () => {
        const sqliteUsers = sqliteTable("users", { id: sqliteText().primaryKey() });

        const adapter = new DrizzleAdapter(createFakeDb(["sqliteUsers"]), {
            table: sqliteUsers,
            queryKey: "sqliteUsers",
        });

        expect(adapter.getPlaceholder(0)).toBe("?");
        expect(adapter.getPlaceholder(3)).toBe("?");
    });
});

/**
 * `query()` (SQL cru) despacha pro método do client certo pra cada dialect:
 * `db.run`/`db.all` no `sqlite` e `db.execute` no `postgresql`/`cockroach`.
 * Clients SQLite reais não expõem `execute`, então o dispatch anterior
 * (sempre `db.execute`) quebrava com `TypeError: db.execute is not a
 * function` em toda chamada de SQL cru.
 *
 * Unidade, sem banco: o client é um fake no formato de cada driver (ver
 * `test/helpers/fake-db.helper.ts`).
 */
describe("DrizzleAdapter.query() — dispatch de SQL cru por dialect (unidade, sem banco)", () => {
    const sqliteUsers = sqliteTable("users", { id: sqliteText().primaryKey() });

    /** Adapter cujo dialect é derivado da própria tabela (`SQLiteTable` -> `sqlite`). */
    function sqliteAdapter(client: DrizzleDbLike) {
        return new DrizzleAdapter(client, { table: sqliteUsers, queryKey: "users" });
    }

    function postgresAdapter(client: DrizzleDbLike) {
        return new DrizzleAdapter(client, { table: userTable, queryKey: "userTable" });
    }

    it("sqlite: leitura vai por 'all' e devolve as linhas como o client as devolveu (sem unwrap)", async () => {
        const client = createFakeSqliteDb(["users"]);
        const rows = [{ id: "1" }, { id: "2" }];
        vi.mocked(client.all!).mockResolvedValue(rows);

        const result = await sqliteAdapter(client).query("SELECT id FROM users WHERE id = ?", {
            args: ["1"],
            modifying: false,
        });

        expect(client.all).toHaveBeenCalledTimes(1);
        expect(client.run).not.toHaveBeenCalled();
        // * client SQLite real não tem `execute` — e o adapter não deve nem tentar
        expect(client.execute).toBeUndefined();
        // * no postgres o retorno é desembrulhado (`result.rows`); no sqlite `all()` já
        // * devolve o array de linhas direto, então ele passa intacto
        expect(result).toBe(rows);
    });

    it("sqlite: statement modificadora vai por 'run' e devolve 'changes'", async () => {
        const client = createFakeSqliteDb(["users"]);
        vi.mocked(client.run!).mockResolvedValue({ changes: 2 });

        const result = await sqliteAdapter(client).query("DELETE FROM users WHERE id = ?", {
            args: ["1"],
            modifying: true,
        });

        expect(client.run).toHaveBeenCalledTimes(1);
        expect(client.all).not.toHaveBeenCalled();
        expect(client.execute).toBeUndefined();
        expect(result).toBe(2);
    });

    it("sqlite: 'run' sem 'changes' no retorno resolve pra 0", async () => {
        const client = createFakeSqliteDb(["users"]);
        vi.mocked(client.run!).mockResolvedValue({});

        const result = await sqliteAdapter(client).query("DELETE FROM users", { modifying: true });

        expect(result).toBe(0);
    });

    it("sqlite: o SQL resolvido chega ao 'all' como 'SQL' com o argumento linkado", async () => {
        const client = createFakeSqliteDb(["users"]);

        await sqliteAdapter(client).query("SELECT id FROM users WHERE id = ? AND name = ?", {
            args: ["1", "Ana"],
            modifying: false,
        });

        const [sqlArg] = vi.mocked(client.all!).mock.calls[0]!;
        expect(sqlArg).toBeInstanceOf(SQL);
        // * os valores dos args viram `Param`, na ordem, sem interpolação no texto
        const bound = (sqlArg as SQL).queryChunks.filter(chunk => chunk instanceof Param).map(chunk => chunk.value);
        expect(bound).toEqual(["1", "Ana"]);
    });

    it("postgresql: leitura vai por 'execute' e desembrulha 'rows'", async () => {
        const client = createFakePostgresDb(["userTable"]);
        const rows = [{ id: "1" }];
        vi.mocked(client.execute!).mockResolvedValue({ rows });

        const result = await postgresAdapter(client).query("SELECT id FROM users WHERE id = $1", {
            args: ["1"],
            modifying: false,
        });

        expect(client.execute).toHaveBeenCalledTimes(1);
        expect(client.run).toBeUndefined();
        expect(client.all).toBeUndefined();
        expect(result).toBe(rows);
    });

    it("postgresql: statement modificadora vai por 'execute' e devolve 'rowCount'", async () => {
        const client = createFakePostgresDb(["userTable"]);
        vi.mocked(client.execute!).mockResolvedValue({ rowCount: 3 });

        const result = await postgresAdapter(client).query("DELETE FROM users WHERE id = $1", {
            args: ["1"],
            modifying: true,
        });

        expect(client.execute).toHaveBeenCalledTimes(1);
        expect(result).toBe(3);
    });

    it("postgresql: 'execute' sem 'rowCount' no retorno resolve pra 0", async () => {
        const client = createFakePostgresDb(["userTable"]);
        vi.mocked(client.execute!).mockResolvedValue({});

        const result = await postgresAdapter(client).query("DELETE FROM users", { modifying: true });

        expect(result).toBe(0);
    });

    it("cockroach: usa 'execute', igual ao postgresql", async () => {
        const client = createFakePostgresDb(["userTable"]);
        const rows = [{ id: "1" }];
        vi.mocked(client.execute!).mockResolvedValue({ rows });

        const adapter = new DrizzleAdapter(client, {
            table: userTable,
            queryKey: "userTable",
            dialect: "cockroach",
        });

        const result = await adapter.query("SELECT id FROM users WHERE id = $1", { args: ["1"], modifying: false });

        expect(client.execute).toHaveBeenCalledTimes(1);
        expect(result).toBe(rows);
    });

    it("sqlite sem 'run': 'modifying' lança 'VSRepoAdapterError' (code 'NOT_SUPPORTED')", async () => {
        const client = createFakeSqliteDb(["users"]);
        delete client.run;

        await expect(sqliteAdapter(client).query("DELETE FROM users", { modifying: true })).rejects.toThrow(
            VSRepoAdapterError,
        );

        try {
            await sqliteAdapter(client).query("DELETE FROM users", { modifying: true });
        } catch (err) {
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.NOT_SUPPORTED);
            expect((err as VSRepoAdapterError).message).toContain("'run'");
        }
    });

    it("sqlite sem 'all': leitura lança 'VSRepoAdapterError' (code 'NOT_SUPPORTED')", async () => {
        const client = createFakeSqliteDb(["users"]);
        delete client.all;

        try {
            await sqliteAdapter(client).query("SELECT id FROM users");
            expect.unreachable("deveria ter lançado");
        } catch (err) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.NOT_SUPPORTED);
            expect((err as VSRepoAdapterError).message).toContain("'all'");
        }
    });

    it("postgresql sem 'execute': lança 'VSRepoAdapterError' (code 'NOT_SUPPORTED')", async () => {
        const client = createFakePostgresDb(["userTable"]);
        delete client.execute;

        try {
            await postgresAdapter(client).query("SELECT id FROM users");
            expect.unreachable("deveria ter lançado");
        } catch (err) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.NOT_SUPPORTED);
            expect((err as VSRepoAdapterError).message).toContain("'execute'");
        }
    });

    it("através de uma VSRepository real: '@QueryMethod' e 'query()' no sqlite também despacham pra 'run'/'all'", async () => {
        const client = createFakeSqliteDb(["users"]);
        vi.mocked(client.all!).mockResolvedValue([{ id: "1" }]);
        vi.mocked(client.run!).mockResolvedValue({ changes: 1 });

        class SqliteUserRepository extends VSRepository<{ id: string }, string> {
            constructor() {
                super({
                    adapter: new DrizzleAdapter(client, { table: sqliteUsers, queryKey: "users" }),
                    logLevel: VSLogLevel.ERROR,
                });
            }
        }

        type SqliteUserRepositoryType = SqliteUserRepository & {
            findByIdRaw(id: string): Promise<{ id: string }[]>;
            deleteByIdRaw(id: string): Promise<number>;
        };

        QueryMethod("SELECT id FROM users WHERE id = ?", { spreadArgs: true })(
            SqliteUserRepository.prototype,
            "findByIdRaw",
        );
        QueryMethod("DELETE FROM users WHERE id = ?", { spreadArgs: true, modifying: true })(
            SqliteUserRepository.prototype,
            "deleteByIdRaw",
        );

        const repository = new SqliteUserRepository() as SqliteUserRepositoryType;

        expect(await repository.findByIdRaw("1")).toEqual([{ id: "1" }]);
        expect(client.all).toHaveBeenCalledTimes(1);

        expect(await repository.deleteByIdRaw("1")).toBe(1);
        expect(client.run).toHaveBeenCalledTimes(1);

        expect(await repository.query("SELECT id FROM users")).toEqual([{ id: "1" }]);
        expect(client.all).toHaveBeenCalledTimes(2);
    });
});
