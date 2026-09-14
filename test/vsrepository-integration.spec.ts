// Testes de integração do `DrizzleAdapter` usado através de uma `VSRepository`
// real (não instanciado isolado, como em `drizzle-adapter.spec.ts`) — mesmo
// espírito do `vsrepository-integration.test.ts` de `VSRepoPrisma7Adapter`.
// Requer um Postgres real (ver `drizzle-adapter.spec.ts`).
//
// NOTA sobre `@DynamicMethod`/`@QueryMethod`: como esses decorators são
// aplicados sobre um campo `declare` (sem implementação em runtime), e o
// TS deste projeto roda via `tsx`/`vitest` sem um passo de build que
// materialize `declare` fields, aplicamos os decorators de forma imperativa
// (`Decorator()(Classe.prototype, "nome")`) em vez de `@Decorator() declare
// nome: ...` — o efeito em runtime é idêntico, só muda a sintaxe.

import {
    DynamicMethod,
    MethodOptions,
    QueryMethod,
    QueryMethodArg,
    VSLogLevel,
    VSRepoAdapterError,
    VSRepository,
} from "vsrepo";
import { DrizzleAdapter } from "../src/drizzle.adapter.js";
import { DrizzleOrmTypes } from "../src/types/drizzle-orm-types.type.js";
import cleanDbHelper from "./helpers/clean-db.helper.js";
import { createAddress, createCategory, createPost, createUser } from "./helpers/fixtures.js";
import { db } from "../dev/drizzle/db.js";
import { Address, Post, User } from "../dev/entities.js";
import { addressTable, categoryTable, postTable, userTable } from "../dev/drizzle/schema.js";

type MyOrmTypes = DrizzleOrmTypes<typeof db>;

/**
 * Repositório concreto de `User`, com `relations` (write) configuradas pro
 * adapter resolver: `address` (oto, FK em `Address.userId` — fkThere) e `posts` (otm).
 */
class UserRepository extends VSRepository<User, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter<User>(db, {
                queryKey: "userTable",
                table: userTable,
                dialect: "postgresql",
                relations: {
                    address: {
                        mode: "oto",
                        restriction: "set",
                        table: addressTable,
                        fkThere: "userId",
                        nullable: true,
                    },
                    posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" },
                },
            }),
            pkName: "id",
            logLevel: VSLogLevel.ERROR,
        });
    }
}

type UserMethodOptions = MethodOptions<User, MyOrmTypes>;

/**
 * Assinaturas dos métodos registrados abaixo via `DynamicMethod()`/`QueryMethod()`
 * — ver NOTA no topo do arquivo sobre a aplicação imperativa dos decorators.
 */
type UserRepositoryType = UserRepository & {
    /** Dynamic method: equivalente a `findOne({ email })`. */
    findOneByEmail(email: string, options?: UserMethodOptions): Promise<User | null>;
    /** Dynamic method: `findMany` com `name` filtrado por `contains`. */
    findByNameContains(name: string, options?: UserMethodOptions): Promise<User[]>;
    /** Dynamic method: `count` com `name` filtrado por igualdade. */
    countByName(name: string): Promise<number>;
    /** Query method (`modifying: false`): SELECT bruto parametrizado. */
    findByEmailRaw(arg: QueryMethodArg<[email: string]>): Promise<{ id: string; name: string }[]>;
    /** Query method (`modifying: true`): UPDATE bruto, resolve pra linhas afetadas. */
    renameUserById(arg: QueryMethodArg<[name: string, id: string]>): Promise<number>;
};

DynamicMethod()(UserRepository.prototype, "findOneByEmail");
DynamicMethod()(UserRepository.prototype, "findByNameContains");
DynamicMethod()(UserRepository.prototype, "countByName");
QueryMethod('SELECT id, name FROM "User" WHERE email = $1')(UserRepository.prototype, "findByEmailRaw");
QueryMethod('UPDATE "User" SET name = $1 WHERE id = $2', { modifying: true })(
    UserRepository.prototype,
    "renameUserById",
);

/**
 * Repositório concreto de `Post`, configurado com `category` (mto, nullable)
 * — complementa o `oto`/`otm` já cobertos pelo `UserRepository` acima.
 */
class PostRepository extends VSRepository<Post, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter<Post>(db, {
                queryKey: "postTable",
                table: postTable,
                dialect: "postgresql",
                relations: {
                    category: {
                        mode: "mto",
                        restriction: "set",
                        table: categoryTable,
                        fkHere: "categoryId",
                        nullable: true,
                    },
                },
            }),
            pkName: "id",
            logLevel: VSLogLevel.ERROR,
        });
    }
}

/**
 * Repositório concreto de `Address`, configurado com `user` (oto, FK em
 * `Address.userId` — fkHere, e não-nullable, já que a coluna é `NOT NULL`)
 * — complementa o `oto`/`fkThere` já coberto pelo `UserRepository` acima.
 */
class AddressRepository extends VSRepository<Address, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter<Address>(db, {
                queryKey: "addressTable",
                table: addressTable,
                dialect: "postgresql",
                relations: {
                    user: { mode: "oto", restriction: "set", table: userTable, fkHere: "userId" },
                },
            }),
            pkName: "id",
            logLevel: VSLogLevel.ERROR,
        });
    }
}

describe("DrizzleAdapter usado através de uma VSRepository real (integração com Postgres)", () => {
    let userRepository: UserRepositoryType;
    let postRepository: PostRepository;
    let addressRepository: AddressRepository;

    beforeEach(async () => {
        await cleanDbHelper();
        userRepository = new UserRepository() as UserRepositoryType;
        postRepository = new PostRepository();
        addressRepository = new AddressRepository();
    });

    describe("CRUD básico via VSRepository (get/save/patch/remove/...)", () => {
        it("get/getOrThrow buscam pela PK, delegando pro adapter", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            expect((await userRepository.get(user.id))?.name).toBe("Ana");
            expect((await userRepository.getOrThrow(user.id)).name).toBe("Ana");
        });

        it("get retorna 'null' e getOrThrow rejeita ('VSRepoAdapterError') quando a PK não existe", async () => {
            expect(await userRepository.get(crypto.randomUUID())).toBeNull();
            await expect(userRepository.getOrThrow(crypto.randomUUID())).rejects.toThrow(VSRepoAdapterError);
        });

        it("getList busca várias PKs de uma vez", async () => {
            const a = await createUser({ email: "a@example.com", name: "A" });
            const b = await createUser({ email: "b@example.com", name: "B" });
            await createUser({ email: "c@example.com", name: "C" });

            const result = await userRepository.getList([a.id, b.id]);

            expect(result.map(u => u.name).sort()).toEqual(["A", "B"]);
        });

        it("getAll respeita 'order' e 'pagination'", async () => {
            await createUser({ email: "c@example.com", name: "Carlos" });
            await createUser({ email: "a@example.com", name: "Ana" });
            await createUser({ email: "b@example.com", name: "Bia" });

            const result = await userRepository.getAll({
                order: { name: "ASC" },
                pagination: { offset: 0, limit: 2 },
            });

            expect(result.map(u => u.name)).toEqual(["Ana", "Bia"]);
        });

        it("save cria quando o objeto não tem pk, e atualiza (upsert) quando tem", async () => {
            const created = await userRepository.save({
                email: "ana@example.com",
                name: "Ana",
                passwordHash: "x",
            });
            expect(created.id).toBeDefined();

            const updated = await userRepository.save({ id: created.id, name: "Ana Paula" });
            expect(updated.name).toBe("Ana Paula");
            expect(await userRepository.total()).toBe(1);
        });

        it("saveList salva vários registros numa única operação (transação interna)", async () => {
            const existing = await createUser({ email: "existente@example.com", name: "Antigo" });

            const result = await userRepository.saveList([
                { email: "novo@example.com", name: "Novo", passwordHash: "x" },
                { id: existing.id, name: "Atualizado" },
            ]);

            expect(result).toHaveLength(2);
            expect(await userRepository.total()).toBe(2);
        });

        it("patch atualiza só os campos enviados", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const result = await userRepository.patch(user.id, { name: "Ana Paula" });

            expect(result.name).toBe("Ana Paula");
            expect(result.email).toBe("ana@example.com");
        });

        it("remove apaga o registro pela pk e o retorna", async () => {
            const user = await createUser({ email: "ana@example.com" });

            const result = await userRepository.remove(user.id);

            expect(result.id).toBe(user.id);
            expect(await userRepository.has(user.id)).toBe(false);
        });

        it("removeList apaga vários registros e retorna o count", async () => {
            const a = await createUser({ email: "a@example.com" });
            const b = await createUser({ email: "b@example.com" });
            await createUser({ email: "c@example.com" });

            const result = await userRepository.removeList([a.id, b.id]);

            expect(result.count).toBe(2);
            expect(await userRepository.total()).toBe(1);
        });

        it("merge busca a pk e devolve o merge em memória, sem persistir nada", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const merged = await userRepository.merge(user.id, { name: "Ana Paula" });

            expect(merged?.name).toBe("Ana Paula");
            expect((await userRepository.get(user.id))?.name).toBe("Ana");
        });

        it("total conta todos os registros, e has verifica existência pela pk", async () => {
            await createUser({ email: "a@example.com" });
            const b = await createUser({ email: "b@example.com" });

            expect(await userRepository.total()).toBe(2);
            expect(await userRepository.has(b.id)).toBe(true);
            expect(await userRepository.has(crypto.randomUUID())).toBe(false);
        });
    });

    describe("relação 'oto' com 'fkThere' (address) através da VSRepository", () => {
        it("save com Address aninhado cria os dois registros (create, sem pk)", async () => {
            const result = await userRepository.save(
                {
                    email: "ana@example.com",
                    name: "Ana",
                    passwordHash: "x",
                    address: { city: "Recife", state: "PE" },
                },
                { relations: { address: true } },
            );

            expect(result.address?.city).toBe("Recife");
        });

        it("patch enviando 'address: null' apaga o Address (restriction 'set')", async () => {
            const user = await createUser({ email: "ana@example.com" });
            await createAddress(user.id);

            await userRepository.patch(user.id, { address: null });

            const found = await userRepository.get(user.id, { relations: { address: true } });
            expect(found?.address).toBeNull();
        });
    });

    describe("relação 'oto' com 'fkHere' (user) através da VSRepository (AddressRepository)", () => {
        it("save com 'user' aninhado (sem pk) cria o User ANTES do Address e vincula via 'userId'", async () => {
            const result = await addressRepository.save(
                {
                    city: "Recife",
                    state: "PE",
                    user: { email: "ana@example.com", name: "Ana", passwordHash: "x" },
                },
                { relations: { user: true } },
            );

            expect(result.user.email).toBe("ana@example.com");

            const found = await addressRepository.get(result.id, { relations: { user: true } });
            expect(found?.user?.id).toBe(result.user.id);
        });

        it("patch conectando um User já existente (com pk) ATUALIZA seus dados, sem criar um segundo User", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });
            const address = await createAddress(user.id, { city: "Recife", state: "PE" });

            const result = await addressRepository.patch(
                address.id,
                { user: { id: user.id, name: "Ana Paula" } },
                { relations: { user: true } },
            );

            expect(result.user.id).toBe(user.id);
            expect(result.user.name).toBe("Ana Paula");
            expect(await userRepository.total()).toBe(1); // não duplicou o usuário
        });

        it("patch enviando 'user: null' lança erro, pois a relação não é nullable ('Address.userId' é NOT NULL)", async () => {
            const user = await createUser({ email: "ana@example.com" });
            const address = await createAddress(user.id, { city: "Recife", state: "PE" });

            await expect(addressRepository.patch(address.id, { user: null as any })).rejects.toThrow(
                VSRepoAdapterError,
            );

            expect(await userRepository.total()).toBe(1); // nada foi apagado
        });
    });

    describe("relação 'otm' (posts) através da VSRepository", () => {
        it("save com Posts aninhados (restriction 'add') cria o User e os Posts vinculados", async () => {
            const result = await userRepository.save(
                {
                    email: "ana@example.com",
                    name: "Ana",
                    passwordHash: "x",
                    posts: [{ title: "Post 1", content: "..." }],
                },
                { relations: { posts: true } },
            );

            expect(result.posts).toHaveLength(1);
        });

        it("patch com 'restriction: add' acumula Posts em vez de substituir", async () => {
            const user = await createUser({ email: "ana@example.com" });
            await createPost(user.id, { title: "Post existente" });

            await userRepository.patch(user.id, { posts: [{ title: "Post novo", content: "..." }] });

            const found = await userRepository.get(user.id, { relations: { posts: true } });
            expect(found?.posts.map((p: Post) => p.title).sort()).toEqual(["Post existente", "Post novo"]);
        });
    });

    describe("relação 'mto' (category) através de PostRepository", () => {
        it("save conecta uma Category existente via fkHere ('categoryId')", async () => {
            const author = await createUser({ email: "autor@example.com" });
            const category = await createCategory({ name: "Tutoriais" });

            const result = await postRepository.save(
                {
                    title: "Post",
                    content: "...",
                    userId: author.id,
                    category: { id: category.id, name: "Tutoriais" },
                },
                { relations: { category: true } },
            );

            expect(result.category?.name).toBe("Tutoriais");
        });
    });

    describe("@DynamicMethod através da VSRepository", () => {
        it("findOneByEmail busca um registro por igualdade, delegando pro adapter", async () => {
            await createUser({ email: "ana@example.com", name: "Ana" });

            expect((await userRepository.findOneByEmail("ana@example.com"))?.name).toBe("Ana");
            expect(await userRepository.findOneByEmail("inexistente@example.com")).toBeNull();
        });

        it("findByNameContains filtra vários registros pelo operador 'contains'", async () => {
            await createUser({ email: "carlos@example.com", name: "Carlos" });
            await createUser({ email: "ana@example.com", name: "Ana" });

            const result = await userRepository.findByNameContains("arl");

            expect(result.map(u => u.name)).toEqual(["Carlos"]);
        });

        it("countByName conta quantos registros batem com o nome informado", async () => {
            await createUser({ email: "a@example.com", name: "Duplicado" });
            await createUser({ email: "b@example.com", name: "Duplicado" });
            await createUser({ email: "c@example.com", name: "Outro" });

            expect(await userRepository.countByName("Duplicado")).toBe(2);
            expect(await userRepository.countByName("Ninguém")).toBe(0);
        });
    });

    describe("@QueryMethod através da VSRepository", () => {
        it("findByEmailRaw (modifying: false) roda um SELECT bruto parametrizado", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const result = await userRepository.findByEmailRaw({ args: ["ana@example.com"] });

            expect(result).toHaveLength(1);
            expect(result[0]?.id).toBe(user.id);
            expect(result[0]?.name).toBe("Ana");
        });

        it("renameUserById (modifying: true) roda um UPDATE bruto e resolve pra contagem de linhas afetadas", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const affected = await userRepository.renameUserById({ args: ["Ana Paula", user.id] });

            expect(affected).toBe(1);
            expect((await userRepository.getOrThrow(user.id)).name).toBe("Ana Paula");
        });
    });

    describe("transaction() compartilhando o client entre UserRepository e PostRepository", () => {
        it("confirma as escritas de ambos os repositórios quando o callback resolve", async () => {
            await userRepository.transaction(async tx => {
                const user = await userRepository.save(
                    { email: "ana@example.com", name: "Ana", passwordHash: "x" },
                    { db: tx },
                );
                await postRepository.save({ title: "Post", content: "...", userId: user.id }, { db: tx });
            });

            expect(await userRepository.total()).toBe(1);
            expect(await postRepository.total()).toBe(1);
        });

        it("desfaz as escritas de ambos os repositórios quando o callback rejeita", async () => {
            await expect(
                userRepository.transaction(async tx => {
                    const user = await userRepository.save(
                        { email: "ana@example.com", name: "Ana", passwordHash: "x" },
                        { db: tx },
                    );
                    await postRepository.save({ title: "Post", content: "...", userId: user.id }, { db: tx });

                    throw new Error("falha proposital");
                }),
            ).rejects.toThrow("falha proposital");

            expect(await userRepository.total()).toBe(0);
            expect(await postRepository.total()).toBe(0);
        });
    });

    describe("atômicos e agregados através da VSRepository (Post.views)", () => {
        it("increment soma 'value' ao campo, delegando pro adapter", async () => {
            const author = await createUser({ email: "autor@example.com" });
            const post = await createPost(author.id, { views: 10 });

            const result = await postRepository.increment(post.id, "views", 5);

            expect(result.views).toBe(15);
        });

        it("sum calcula a soma sobre os registros que casam com o where", async () => {
            const author = await createUser({ email: "autor@example.com" });
            await createPost(author.id, { views: 10 });
            await createPost(author.id, { views: 20 });

            expect(await postRepository.sum("views", {})).toBe(30);
        });
    });

    describe("erros do adapter propagados como 'VSRepoAdapterError' através da VSRepository", () => {
        it("getOrThrow propaga 'NOT_FOUND'", async () => {
            await expect(userRepository.getOrThrow(crypto.randomUUID())).rejects.toThrow(VSRepoAdapterError);
        });

        it("save com email duplicado propaga o erro de unique constraint do adapter", async () => {
            await createUser({ email: "duplicado@example.com" });

            await expect(
                userRepository.save({ email: "duplicado@example.com", name: "X", passwordHash: "x" }),
            ).rejects.toThrow(VSRepoAdapterError);
        });
    });
});
