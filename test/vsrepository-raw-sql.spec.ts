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

import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { DbArg, QueryMethod, VSLogLevel, VSSql, VSRepository, withDb } from "vsrepo";
import { Role } from "../dev/enum/role.enum.js";
import { DrizzleAdapter } from "../src/drizzle.adapter.js";
import { DrizzleOrmTypes } from "../src/types/drizzle-orm-types.type.js";
import cleanDbHelper from "./helpers/clean-db.helper.js";
import { createFakeDb } from "./helpers/fake-db.helper.js";
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
