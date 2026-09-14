// Testes de integração do `DrizzleAdapter` contra um Postgres real (mesmo
// espírito do `prisma7.adapter.test.ts` de `VSRepoPrisma7Adapter`). Requer
// `DATABASE_URL` apontando pra um banco com as migrations aplicadas
// (`npx drizzle-kit migrate`) — ver README/CI.
//
// O banco é limpo antes de cada teste (`beforeEach` -> `cleanDbHelper`), e
// cada teste cria os próprios registros via `test/helpers/fixtures.ts`
// (inserts diretos pelo client Drizzle, não pelo adapter), pra manter os
// testes do adapter independentes uns dos outros.

import { eq } from "drizzle-orm";
import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { Role } from "../dev/enum/role.enum.js";
import { DrizzleAdapter } from "../src/drizzle.adapter.js";
import cleanDbHelper from "./helpers/clean-db.helper.js";
import { createAddress, createCategory, createPost, createUser } from "./helpers/fixtures.js";
import { addressTable, categoryTable, postTable, userTable } from "../dev/drizzle/schema.js";
import { Address, Post, User } from "../dev/entities.js";
import { db } from "../dev/drizzle/db.js";

describe("DrizzleAdapter (integração com Postgres real)", () => {
    let userAdapter: DrizzleAdapter<User>;
    let addressAdapter: DrizzleAdapter<Address>;

    beforeEach(async () => {
        await cleanDbHelper();
        userAdapter = new DrizzleAdapter<User>(db, {
            queryKey: "userTable",
            table: userTable,
            dialect: "postgresql",
        });

        addressAdapter = new DrizzleAdapter<Address>(db, {
            queryKey: "addressTable",
            table: addressTable,
            dialect: "postgresql",
        });
    });

    it("should be defined", () => {
        expect(userAdapter).toBeDefined();
        expect(addressAdapter).toBeDefined();
    });

    describe("findOne / findOneOrThrow / findMany", () => {
        it("findOne encontra o registro pelo where", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });
            await createUser({ email: "bia@example.com", name: "Bia" });

            const result = await userAdapter.findOne({ email: "ana@example.com" });

            expect(result?.id).toBe(user.id);
            expect(result?.name).toBe("Ana");
            console.log(await userAdapter.count({}));
        });

        it("findOne retorna 'null' quando nada casa com o where", async () => {
            const result = await userAdapter.findOne({ email: "nao-existe@example.com" });
            expect(result).toBeNull();
        });

        it("findOne aplica operadores de where ('contains' + 'ignoreCase')", async () => {
            await createUser({ email: "ana@example.com", name: "Ana Paula" });

            const result = await userAdapter.findOne({ name: { contains: "ANA PAULA", ignoreCase: true } });

            expect(result?.name).toBe("Ana Paula");
        });

        it("findOne usa 'select' quando informado, retornando só os campos pedidos", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const result = await userAdapter.findOne({ id: user.id }, { select: { id: true, name: true } });

            expect(result).toEqual({ id: user.id, name: "Ana" });
        });

        it("findOne usa 'relations' (with) quando 'select' não é informado", async () => {
            const user = await createUser({ email: "ana@example.com" });
            await createPost(user.id, { title: "Post 1" });
            await createPost(user.id, { title: "Post 2" });

            const result = await userAdapter.findOne({ id: user.id }, { relations: { posts: true } });

            expect(result?.posts).toHaveLength(2);
            expect(result?.posts.map((p: Post) => p.title).sort()).toEqual(["Post 1", "Post 2"]);
        });

        it("findOneOrThrow retorna o registro quando existe", async () => {
            const user = await createUser({ email: "ana@example.com" });
            const result = await userAdapter.findOneOrThrow({ id: user.id });
            expect(result.id).toBe(user.id);
        });

        it("findOneOrThrow rejeita com 'VSRepoAdapterError' (code 'NOT_FOUND') quando não encontra nada", async () => {
            await expect(userAdapter.findOneOrThrow({ email: "nao-existe@example.com" })).rejects.toThrow(
                VSRepoAdapterError,
            );

            try {
                await userAdapter.findOneOrThrow({ email: "nao-existe@example.com" });
            } catch (err) {
                expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.NOT_FOUND);
            }
        });

        it("findMany retorna todos os registros que casam com o where, respeitando 'order' e paginação", async () => {
            await createUser({ email: "c@example.com", name: "Carlos" });
            await createUser({ email: "a@example.com", name: "Ana" });
            await createUser({ email: "b@example.com", name: "Bia" });

            const result = await userAdapter.findMany(
                {},
                { order: { name: "ASC" }, pagination: { offset: 0, limit: 2 } },
            );

            expect(result.map(u => u.name)).toEqual(["Ana", "Bia"]);
        });

        it("findMany lança 'VSRepoAdapterError' (code 'NOT_SUPPORTED') quando 'distinct' é informado", async () => {
            try {
                await userAdapter.findMany({}, { distinct: ["name"] });
            } catch (err) {
                expect(err).toBeInstanceOf(VSRepoAdapterError);
                expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.NOT_SUPPORTED);
            }
        });
    });

    describe("count / exists", () => {
        it("count retorna a quantidade de registros que casam com o where", async () => {
            await createUser({ email: "a@example.com" });
            await createUser({ email: "b@example.com" });

            expect(await userAdapter.count({})).toBe(2);
            expect(await userAdapter.count({ email: "a@example.com" })).toBe(1);
        });

        it("exists retorna 'true' quando existe pelo menos um registro, e 'false' caso contrário", async () => {
            await createUser({ email: "ana@example.com" });

            expect(await userAdapter.exists({ email: "ana@example.com" })).toBe(true);
            expect(await userAdapter.exists({ email: "nao-existe@example.com" })).toBe(false);
        });
    });

    describe("create / save / update / upsert (sem relations configuradas)", () => {
        it("create insere um novo registro e o retorna", async () => {
            const result = await userAdapter.create({
                email: "ana@example.com",
                name: "Ana",
                passwordHash: "x",
                role: Role.USER,
            });

            expect(result.id).toBeDefined();
            expect(result.email).toBe("ana@example.com");

            const [stored] = await db.select().from(userTable).where(eq(userTable.id, result.id));
            expect(stored?.name).toBe("Ana");
        });

        it("save sem pk cria um novo registro", async () => {
            const result = await userAdapter.save({
                email: "ana@example.com",
                name: "Ana",
                passwordHash: "x",
            });

            expect(result.email).toBe("ana@example.com");
            expect(await userAdapter.count({})).toBe(1);
        });

        it("save com pk atualiza o registro existente", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const result = await userAdapter.save({ id: user.id, name: "Ana Paula" });

            expect(result.name).toBe("Ana Paula");
            expect(await userAdapter.count({})).toBe(1);
        });

        it("update altera só os campos enviados, sem tocar nos demais", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const result = await userAdapter.update({ id: user.id }, { name: "Ana Paula" });

            expect(result.name).toBe("Ana Paula");
            expect(result.email).toBe("ana@example.com");
        });

        it("update lança 'VSRepoAdapterError' (code 'NOT_FOUND') quando nada casa com o where", async () => {
            await expect(userAdapter.update({ id: crypto.randomUUID() }, { name: "X" })).rejects.toThrow(
                VSRepoAdapterError,
            );
        });

        it("upsert cria quando não encontra nada, e atualiza quando encontra", async () => {
            const created = await userAdapter.upsert(
                { email: "ana@example.com" },
                { email: "ana@example.com", name: "Ana", passwordHash: "x" },
                { name: "Ana Atualizada" },
            );
            expect(created.name).toBe("Ana");

            const updated = await userAdapter.upsert(
                { email: "ana@example.com" },
                { email: "ana@example.com", name: "Ana", passwordHash: "x" },
                { name: "Ana Atualizada" },
            );
            expect(updated.name).toBe("Ana Atualizada");
            expect(updated.id).toBe(created.id);
            expect(await userAdapter.count({})).toBe(1);
        });
    });

    describe("relação 'oto' com 'fkThere' (User <-> Address, FK em 'Address.userId')", () => {
        beforeEach(() => {
            userAdapter = new DrizzleAdapter<User>(db, {
                queryKey: "userTable",
                table: userTable,
                relations: {
                    address: {
                        mode: "oto",
                        restriction: "set",
                        table: addressTable,
                        fkThere: "userId",
                        nullable: true,
                    },
                },
            });
        });

        it("create com um Address aninhado (sem pk) cria os dois registros", async () => {
            const result = await userAdapter.create(
                {
                    email: "ana@example.com",
                    name: "Ana",
                    passwordHash: "x",
                    address: { city: "Recife", state: "PE" },
                },
                { relations: { address: true } },
            );

            expect(result.address).toMatchObject({ city: "Recife", state: "PE" });

            const [stored] = await db.select().from(addressTable).where(eq(addressTable.userId, result.id));
            expect(stored).toBeDefined();
        });

        it("update enviando o Address como 'null' apaga o Address (restriction 'set', relação nullable)", async () => {
            const user = await createUser({ email: "ana@example.com" });
            await createAddress(user.id);

            await userAdapter.update({ id: user.id }, { address: null });

            const rows = await db.select().from(addressTable);
            expect(rows).toHaveLength(0);
        });

        it("update enviando 'address: null' quando a relação NÃO é nullable lança erro (não apaga nada)", async () => {
            const naoNullableAdapter = new DrizzleAdapter<User>(db, {
                queryKey: "userTable",
                table: userTable,
                relations: {
                    address: { mode: "oto", restriction: "set", table: addressTable, fkThere: "userId" },
                },
            });
            const user = await createUser({ email: "ana@example.com" });
            await createAddress(user.id);

            await expect(naoNullableAdapter.update({ id: user.id }, { address: null })).rejects.toThrow(
                VSRepoAdapterError,
            );

            const rows = await db.select().from(addressTable);
            expect(rows).toHaveLength(1); // nada foi apagado
        });

        it("update com Address aninhado SEM pk, quando o User já tem um Address vinculado, ATUALIZA o existente (não duplica nem some o vínculo)", async () => {
            const user = await createUser({ email: "ana@example.com" });
            const address = await createAddress(user.id, { city: "Recife", state: "PE" });

            const result = await userAdapter.update(
                { id: user.id },
                { address: { city: "Salvador", state: "BA" } },
                { relations: { address: true } },
            );

            expect(result.address?.id).toBe(address.id);
            expect(result.address?.city).toBe("Salvador");

            const rows = await db.select().from(addressTable);
            expect(rows).toHaveLength(1); // não duplicou
            expect(rows[0]?.city).toBe("Salvador");
        });

        it("update de um Address existente (com pk) faz upsert do Address aninhado, sem duplicar", async () => {
            const user = await createUser({ email: "ana@example.com" });
            const address = await createAddress(user.id, { city: "Recife" });

            await userAdapter.update(
                { id: user.id },
                {
                    address: { id: address.id, city: "Salvador", state: "BA" },
                },
            );

            const rows = await db.select().from(addressTable);
            expect(rows).toHaveLength(1);
            expect(rows[0]?.city).toBe("Salvador");
        });

        it("save com Address aninhado cria via 'create' (sem pk no User)", async () => {
            const result = await userAdapter.save(
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
    });

    describe("relação 'oto' com 'fkHere' (Address <-> User, FK em 'Address.userId')", () => {
        beforeEach(() => {
            addressAdapter = new DrizzleAdapter<Address>(db, {
                queryKey: "addressTable",
                table: addressTable,
                relations: {
                    user: { mode: "oto", restriction: "set", table: userTable, fkHere: "userId" },
                },
            });
        });

        it("create com um User aninhado (sem pk) cria o User ANTES do Adress e grava 'userId'", async () => {
            const result = await addressAdapter.create(
                {
                    city: "Recife",
                    state: "PE",
                    user: {
                        email: "ana@example.com",
                        name: "Ana",
                        passwordHash: "x",
                    },
                },
                { relations: { user: true } },
            );

            expect(result.user).toMatchObject({
                email: "ana@example.com",
                name: "Ana",
                passwordHash: "x",
            });

            const [storedAddress] = await db.select().from(addressTable);
            expect(storedAddress?.userId).toBe(result.user.id);
        });

        it("create conectando e atualizando (restriction set) um User JÁ EXISTENTE (com pk) não cria um segundo User", async () => {
            const exitingUser = await createUser({ email: "dono-original@example.com" });

            const result = await addressAdapter.create(
                {
                    city: "Recife",
                    state: "PE",
                    user: { id: exitingUser.id, email: "dono@example.com" },
                },
                { relations: { user: true } },
            );

            expect(result.user.id).toBe(exitingUser.id);
            expect(result.user.email).toBe("dono@example.com");

            const allUsers = await db.select().from(userTable);
            expect(allUsers).toHaveLength(1);
        });

        it("update enviando 'user: null' lança erro pois userId é NOT NULL", async () => {
            const user = await createUser({ email: "ana@example.com" });
            const address = await createAddress(user.id, { city: "Recife", state: "PE" });

            try {
                await addressAdapter.update({ id: address.id }, { user: null } as any, {
                    relations: { user: true },
                });
                throw new Error();
            } catch (err: any) {
                expect(err).toBeInstanceOf(VSRepoAdapterError);
            }

            const allUsers = await db.select().from(userTable);
            const allAddresses = await db.select().from(addressTable);
            expect(allUsers).toHaveLength(1);
            expect(allAddresses).toHaveLength(1);
        });

        it("update conectando um User já existente (com pk) ATUALIZA seus dados, sem duplicar (restriction 'set')", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });
            const address = await createAddress(user.id, { city: "Recife", state: "PE" });

            const result = await addressAdapter.update(
                { id: address.id },
                { user: { id: user.id, name: "Ana Paula" } },
                { relations: { user: true } },
            );

            expect(result.user.name).toBe("Ana Paula");

            const allUsers = await db.select().from(userTable);
            expect(allUsers).toHaveLength(1); // não duplicou o User
        });

        it("upsert cria o Address com o User aninhado (fkHere) quando não encontra nada", async () => {
            const created = await addressAdapter.upsert(
                { city: "Recife" },
                {
                    city: "Recife",
                    state: "PE",
                    user: { email: "ana@example.com", name: "Ana", passwordHash: "x" },
                },
                { city: "Recife Atualizado" },
                { relations: { user: true } },
            );

            expect(created.user.email).toBe("ana@example.com");

            const allUsers = await db.select().from(userTable);
            expect(allUsers).toHaveLength(1);
        });
    });

    describe("relação 'otm' (User <-> Post)", () => {
        beforeEach(() => {
            userAdapter = new DrizzleAdapter<User>(db, {
                queryKey: "userTable",
                table: userTable,
                relations: {
                    posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" },
                },
            });
        });

        it("create com Posts aninhados (sem pk) cria o User e os Posts vinculados a ele", async () => {
            const result = await userAdapter.create(
                {
                    email: "ana@example.com",
                    name: "Ana",
                    passwordHash: "x",
                    posts: [
                        { title: "Post 1", content: "..." },
                        { title: "Post 2", content: "..." },
                    ],
                },
                { relations: { posts: true } },
            );

            expect(result.posts).toHaveLength(2);

            const posts = await db.select().from(postTable);
            expect(posts.every(p => p.userId === result.id)).toBe(true);
        });

        it("update com restriction 'add' apenas ADICIONA Posts, sem remover os já existentes", async () => {
            const user = await createUser({ email: "ana@example.com" });
            await createPost(user.id, { title: "Post existente" });

            await userAdapter.update({ id: user.id }, { posts: [{ title: "Post novo", content: "..." }] });

            const posts = await db.select().from(postTable).where(eq(postTable.userId, user.id));
            expect(posts.map(p => p.title).sort()).toEqual(["Post existente", "Post novo"]);
        });

        it("update conectando um Post já existente (com pk) apenas re-vincula, sem duplicar", async () => {
            const user = await createUser({ email: "ana@example.com" });
            const otherUser = await createUser({ email: "outro@example.com" });
            const post = await createPost(otherUser.id, { title: "Post de outro" });

            await userAdapter.update({ id: user.id }, { posts: [{ id: post.id, title: "Post de outro" }] });

            const [stored] = await db.select().from(postTable).where(eq(postTable.id, post.id));
            expect(stored?.userId).toBe(user.id);

            const allPosts = await db.select().from(postTable);
            expect(allPosts).toHaveLength(1); // não duplicou
        });

        it("createMany lança 'VSRepoAdapterError' (code 'NOT_SUPPORTED') se um objeto trouxer o campo de relação", async () => {
            await expect(
                userAdapter.createMany([{ email: "ana@example.com", name: "Ana", passwordHash: "x", posts: [] }]),
            ).rejects.toThrow(VSRepoAdapterError);

            expect(await userAdapter.count({})).toBe(0);
        });
    });

    describe("relação 'mto' com restriction 'set' (Post -> Category, nullable)", () => {
        let postAdapter: DrizzleAdapter<Post>;
        let author: User;

        beforeEach(async () => {
            postAdapter = new DrizzleAdapter<Post>(db, {
                queryKey: "postTable",
                table: postTable,
                relations: {
                    category: {
                        mode: "mto",
                        restriction: "set",
                        table: categoryTable,
                        fkHere: "categoryId",
                        nullable: true,
                    },
                },
            });
            author = await createUser({ email: "autor@example.com" });
        });

        it("create conecta uma Category existente via fkHere ('categoryId')", async () => {
            const category = await createCategory({ name: "Tutoriais" });

            const result = await postAdapter.create(
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

        it("update enviando 'category: null' desconecta (categoryId nullable)", async () => {
            const category = await createCategory({ name: "Tutoriais" });
            const post = await createPost(author.id, { categoryId: category.id });

            await postAdapter.update({ id: post.id }, { category: null });

            const [stored] = await db.select().from(postTable).where(eq(postTable.id, post.id));
            expect(stored?.categoryId).toBeNull();
        });
    });

    describe("delete / deleteMany / deleteManyReturning", () => {
        it("delete remove o registro e o retorna", async () => {
            const user = await createUser({ email: "ana@example.com" });

            const result = await userAdapter.delete({ id: user.id });

            expect(result.id).toBe(user.id);
            expect(await userAdapter.count({})).toBe(0);
        });

        it("delete lança 'VSRepoAdapterError' (code 'NOT_FOUND') quando nada casa com o where", async () => {
            await expect(userAdapter.delete({ id: crypto.randomUUID() })).rejects.toThrow(VSRepoAdapterError);
        });

        it("deleteMany remove todos os registros que casam com o where e retorna o count", async () => {
            await createUser({ email: "a@example.com" });
            await createUser({ email: "b@example.com" });
            await createUser({ email: "c@example.com" });

            const result = await userAdapter.deleteMany({ email: { contains: "a" } });

            expect(result.count).toBeGreaterThan(0);
            expect(await userAdapter.count({})).toBe(3 - result.count);
        });

        it("deleteManyReturning apaga e devolve os registros apagados (com os dados, não só o pk)", async () => {
            await createUser({ email: "a@example.com", name: "Ana" });
            await createUser({ email: "b@example.com", name: "Bia" });

            const result = await userAdapter.deleteManyReturning({});

            expect(result).toHaveLength(2);
            expect(result.map(u => u.name).sort()).toEqual(["Ana", "Bia"]);
            expect(await userAdapter.count({})).toBe(0);
        });

        it("deleteManyReturning retorna '[]' (sem erro) quando nada casa com o where", async () => {
            const result = await userAdapter.deleteManyReturning({ email: "inexistente@example.com" });
            expect(result).toEqual([]);
        });
    });

    describe("updateMany / updateManyReturning", () => {
        it("updateMany atualiza todos os registros que casam com o where e retorna o count", async () => {
            await createUser({ email: "a@example.com", role: Role.USER });
            await createUser({ email: "b@example.com", role: Role.USER });

            const result = await userAdapter.updateMany({}, { role: Role.ADMIN });

            expect(result.count).toBe(2);
            const rows = await db.select().from(userTable);
            expect(rows.every(u => u.role === Role.ADMIN)).toBe(true);
        });

        it("updateManyReturning atualiza e devolve os registros atualizados", async () => {
            await createUser({ email: "a@example.com" });
            await createUser({ email: "b@example.com" });

            const result = await userAdapter.updateManyReturning({}, { role: Role.ADMIN });

            expect(result).toHaveLength(2);
            expect(result.every(u => u.role === Role.ADMIN)).toBe(true);
        });

        it("updateManyReturning retorna '[]' (sem erro) quando nada casa com o where", async () => {
            const result = await userAdapter.updateManyReturning(
                { email: "inexistente@example.com" },
                {
                    role: Role.ADMIN,
                },
            );
            expect(result).toEqual([]);
        });

        it("updateMany/updateManyReturning lançam 'NOT_SUPPORTED' se o payload trouxer um campo de relação configurada", async () => {
            userAdapter = new DrizzleAdapter<User>(db, {
                queryKey: "userTable",
                table: userTable,
                relations: { posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" } },
            });

            await expect(userAdapter.updateMany({}, { posts: [] })).rejects.toThrow(VSRepoAdapterError);
            await expect(userAdapter.updateManyReturning({}, { posts: [] })).rejects.toThrow(VSRepoAdapterError);
        });
    });

    describe("saveMany", () => {
        it("salva cada registro individualmente (cria os sem pk, atualiza os com pk), dentro de uma transação", async () => {
            const existing = await createUser({ email: "existente@example.com", name: "Antigo" });

            const result = await userAdapter.saveMany([
                { email: "novo@example.com", name: "Novo", passwordHash: "x" },
                { id: existing.id, name: "Atualizado" },
            ]);

            expect(result).toHaveLength(2);
            expect(await userAdapter.count({})).toBe(2);
        });

        it("desfaz a transação inteira quando um dos saves falha (email duplicado)", async () => {
            await createUser({ email: "duplicado@example.com" });

            await expect(
                userAdapter.saveMany([
                    { email: "novo@example.com", name: "Novo", passwordHash: "x" },
                    { email: "duplicado@example.com", name: "Vai falhar", passwordHash: "x" },
                ]),
            ).rejects.toThrow(VSRepoAdapterError);

            // O primeiro insert ('novo@example.com') foi desfeito junto com o segundo.
            expect(await userAdapter.count({})).toBe(1);
        });
    });

    describe("merge", () => {
        it("busca o registro e devolve o merge em memória, sem persistir nada", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const merged = await userAdapter.merge({ id: user.id }, { name: "Ana Paula" });

            expect(merged.name).toBe("Ana Paula");
            const [stored] = await db.select().from(userTable).where(eq(userTable.id, user.id));
            expect(stored?.name).toBe("Ana");
        });

        it("lança 'VSRepoAdapterError' (code 'NOT_FOUND') quando nenhum registro é encontrado", async () => {
            await expect(userAdapter.merge({ id: crypto.randomUUID() }, { name: "X" })).rejects.toThrow(
                VSRepoAdapterError,
            );
        });
    });

    describe("createMany / createManyReturning", () => {
        it("createMany cria vários registros de uma vez e retorna o count", async () => {
            const result = await userAdapter.createMany([
                { email: "a@example.com", name: "A", passwordHash: "x" },
                { email: "b@example.com", name: "B", passwordHash: "x" },
            ]);

            expect(result.count).toBe(2);
        });

        it("'ignoreConflicts: true' ignora duplicidades em vez de rejeitar", async () => {
            await createUser({ email: "a@example.com" });

            const result = await userAdapter.createMany(
                [
                    { email: "a@example.com", name: "Duplicado", passwordHash: "x" },
                    { email: "b@example.com", name: "B", passwordHash: "x" },
                ],
                { ignoreConflicts: true },
            );

            expect(result.count).toBeLessThanOrEqual(1);
            expect(await userAdapter.count({})).toBe(2);
        });

        it("createManyReturning cria vários registros de uma vez e devolve os criados", async () => {
            const result = await userAdapter.createManyReturning([
                { email: "a@example.com", name: "A", passwordHash: "x" },
                { email: "b@example.com", name: "B", passwordHash: "x" },
            ]);

            expect(result).toHaveLength(2);
            expect(result.map(u => u.email).sort()).toEqual(["a@example.com", "b@example.com"]);
        });

        it("'ignoreConflicts: true' em createManyReturning devolve só os registros efetivamente criados", async () => {
            await createUser({ email: "a@example.com" });

            const result = await userAdapter.createManyReturning(
                [
                    { email: "a@example.com", name: "Duplicado", passwordHash: "x" },
                    { email: "b@example.com", name: "B", passwordHash: "x" },
                ],
                { ignoreConflicts: true },
            );

            expect(result.map(u => u.email)).toEqual(["b@example.com"]);
            expect(await userAdapter.count({})).toBe(2);
        });
    });

    describe("métodos *Returning aplicam 'select'/'relations' das options (readArgs)", () => {
        let returningAdapter: DrizzleAdapter<User>;

        beforeEach(() => {
            returningAdapter = new DrizzleAdapter<User>(db, {
                queryKey: "userTable",
                table: userTable,
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
            });
        });

        it("createManyReturning aplica 'select', retornando só os campos pedidos", async () => {
            const result = await returningAdapter.createManyReturning(
                [
                    { email: "a@example.com", name: "A", passwordHash: "x" },
                    { email: "b@example.com", name: "B", passwordHash: "x" },
                ],
                { select: { id: true, email: true } },
            );

            expect(result).toHaveLength(2);
            expect(Object.keys(result[0]!).sort()).toEqual(["email", "id"]);
        });

        it("createManyReturning aplica 'relations' (eager load), mesmo sem nada aninhado no payload de criação", async () => {
            const result = await returningAdapter.createManyReturning(
                [{ email: "a@example.com", name: "A", passwordHash: "x" }],
                { relations: { posts: true } },
            );

            expect(result[0]!.posts).toEqual([]);
        });

        it("deleteManyReturning aplica 'select', retornando só os campos pedidos", async () => {
            await createUser({ email: "a@example.com", name: "Ana" });

            const result = await returningAdapter.deleteManyReturning({}, { select: { id: true, name: true } });

            expect(result).toHaveLength(1);
            expect(Object.keys(result[0]!).sort()).toEqual(["id", "name"]);
        });

        it("deleteManyReturning aplica 'relations' no retorno, e apaga os relacionados junto (cascade)", async () => {
            const user = await createUser({ email: "ana@example.com" });
            const address = await createAddress(user.id, { city: "Recife", state: "PE" });

            const result = await returningAdapter.deleteManyReturning(
                { id: user.id },
                {
                    relations: { address: true },
                },
            );

            expect(result).toHaveLength(1);
            expect(result[0]!.address?.id).toBe(address.id);
            expect(result[0]!.address?.city).toBe("Recife");

            const remainingAddresses = await db.select().from(addressTable);
            expect(remainingAddresses).toHaveLength(0); // apagado via 'onDelete: cascade' junto com o User
        });

        it("updateManyReturning aplica 'select', retornando só os campos pedidos", async () => {
            await createUser({ email: "a@example.com", role: Role.USER });
            await createUser({ email: "b@example.com", role: Role.USER });

            const result = await returningAdapter.updateManyReturning(
                {},
                { role: Role.ADMIN },
                { select: { id: true, role: true } },
            );

            expect(result).toHaveLength(2);
            expect(Object.keys(result[0]!).sort()).toEqual(["id", "role"]);
            expect(result.every(u => u.role === Role.ADMIN)).toBe(true);
        });

        it("updateManyReturning aplica 'relations' no retorno", async () => {
            const user = await createUser({ email: "ana@example.com" });
            await createAddress(user.id, { city: "Recife", state: "PE" });

            const result = await returningAdapter.updateManyReturning(
                { id: user.id },
                { role: Role.ADMIN },
                {
                    relations: { address: true },
                },
            );

            expect(result).toHaveLength(1);
            expect(result[0]!.address?.city).toBe("Recife");
        });
    });

    describe("query (raw)", () => {
        it("executa uma query somente-leitura por padrão ('modifying: false')", async () => {
            const user = await createUser({ email: "ana@example.com" });

            const result = await userAdapter.query<{ id: string; name: string }[]>(
                'SELECT id, name FROM "User" WHERE id = $1',
                { args: [user.id], modifying: false },
            );

            expect(result[0]?.name).toBe(user.name);
        });

        it("usa uma query de escrita quando 'modifying: true', e a alteração é persistida", async () => {
            const user = await createUser({ email: "ana@example.com", name: "Ana" });

            const affected = await userAdapter.query<number>('UPDATE "User" SET name = $1 WHERE id = $2', {
                args: ["Ana Paula", user.id],
                modifying: true,
            });

            expect(affected).toBe(1);
            const [stored] = await db.select().from(userTable).where(eq(userTable.id, user.id));
            expect(stored?.name).toBe("Ana Paula");
        });
    });

    describe("incrementOne / decrementOne / multiplyOne / divideOne (Post.views)", () => {
        let postAdapter: DrizzleAdapter<Post>;
        let author: User;

        beforeEach(async () => {
            postAdapter = new DrizzleAdapter<Post>(db, { queryKey: "postTable", table: postTable });
            author = await createUser({ email: "autor@example.com" });
        });

        it("incrementOne soma 'value' ao campo e retorna o registro já atualizado", async () => {
            const post = await createPost(author.id, { views: 10 });

            const result = await postAdapter.incrementOne("views", 5, { id: post.id });

            expect(result.views).toBe(15);
        });

        it("decrementOne subtrai 'value' do campo", async () => {
            const post = await createPost(author.id, { views: 10 });

            const result = await postAdapter.decrementOne("views", 3, { id: post.id });

            expect(result.views).toBe(7);
        });

        it("multiplyOne multiplica o campo por 'value'", async () => {
            const post = await createPost(author.id, { views: 4 });

            const result = await postAdapter.multiplyOne("views", 3, { id: post.id });

            expect(result.views).toBe(12);
        });

        it("divideOne divide o campo por 'value'", async () => {
            const post = await createPost(author.id, { views: 20 });

            const result = await postAdapter.divideOne("views", 4, { id: post.id });

            expect(result.views).toBe(5);
        });

        it("incrementOne lança 'VSRepoAdapterError' (code 'NOT_FOUND') quando nada casa com o where", async () => {
            await expect(postAdapter.incrementOne("views", 1, { id: crypto.randomUUID() })).rejects.toThrow(
                VSRepoAdapterError,
            );
        });
    });

    describe("sum / average / min / max (Post.views)", () => {
        let postAdapter: DrizzleAdapter<Post>;
        let author: User;

        beforeEach(async () => {
            postAdapter = new DrizzleAdapter<Post>(db, { queryKey: "postTable", table: postTable });
            author = await createUser({ email: "autor@example.com" });
        });

        it("sum retorna 'null' (não '0') quando nenhum registro casa com o where", async () => {
            const result = await postAdapter.sum("views", { title: "não existe" });
            expect(result).toBeNull();
        });

        it("sum/average/min/max calculam corretamente sobre os registros que casam com o where", async () => {
            await createPost(author.id, { views: 10 });
            await createPost(author.id, { views: 20 });
            await createPost(author.id, { views: 30 });

            expect(await postAdapter.sum("views", {})).toBe(60);
            expect(await postAdapter.average("views", {})).toBe(20);
            expect(await postAdapter.min("views", {})).toBe(10);
            expect(await postAdapter.max("views", {})).toBe(30);
        });
    });

    describe("transações e getDbClient", () => {
        it("getDbClient retorna o client raiz", () => {
            expect(userAdapter.getDbClient()).toBe(db);
        });

        it("runInTransaction confirma as escritas quando o callback resolve", async () => {
            await userAdapter.runInTransaction(async tx => {
                await userAdapter.create(
                    { email: "ana@example.com", name: "Ana", passwordHash: "x" },
                    {
                        db: tx,
                    },
                );
            });

            expect(await userAdapter.count({})).toBe(1);
        });

        it("runInTransaction desfaz as escritas quando o callback rejeita", async () => {
            await expect(
                userAdapter.runInTransaction(async tx => {
                    await userAdapter.create(
                        { email: "ana@example.com", name: "Ana", passwordHash: "x" },
                        {
                            db: tx,
                        },
                    );
                    throw new Error("falha proposital");
                }),
            ).rejects.toThrow();

            expect(await userAdapter.count({})).toBe(0);
        });

        it("saveMany reaproveita um client de transação já ativo ('options.db') em vez de abrir uma nova", async () => {
            await userAdapter.runInTransaction(async tx => {
                await userAdapter.saveMany(
                    [
                        { email: "a@example.com", name: "A", passwordHash: "x" },
                        { email: "b@example.com", name: "B", passwordHash: "x" },
                    ],
                    { db: tx },
                );
            });

            expect(await userAdapter.count({})).toBe(2);
        });
    });
});
