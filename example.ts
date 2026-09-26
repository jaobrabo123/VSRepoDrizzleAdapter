/**
 * Exemplo do `DrizzleAdapter` (o `VSRepoAdapter` do `vsrepo`) em uso real,
 * com o `VSRepository` do `vsrepo` sobre um Postgres.
 *
 * Antes de rodar:
 *   1. aponte `DATABASE_URL` no `.env` (veja `.env.example`);
 *   2. aplique as migrations: `bunx drizzle-kit migrate`.
 *
 * Depois: `bun run example` (ou `npx tsx example.ts`).
 *
 * O schema e a conexão usados aqui (`dev/drizzle/*`, `dev/entities.ts`) são os
 * mesmos dos testes — um schema mínimo de `User` <-> `Address`/`Post`, com
 * `User` 1-1 `Address` e 1-N `Post`.
 *
 * Cada seção abaixo é autocontada e numerada.
 */

import { DrizzleAdapter, DrizzleOrmTypes } from "./src/index.js";
import { DynamicMethod, MethodOptions, VSLogLevel, VSRepository } from "vsrepo";
import { db, relations } from "./dev/drizzle/db.js";
import { postTable, userTable } from "./dev/drizzle/schema.js";
import { Post, User } from "./dev/entities.js";
import { Role } from "./dev/enum/role.enum.js";

/**
 * Amarra os tipos do `dbClient`/`dbTransaction` do `VSRepository` aos tipos
 * reais do Drizzle — é o que faz `options.db` e o `tx` do `transaction()`
 * aparecerem tipados.
 */
type MyOrmTypes = DrizzleOrmTypes<typeof db>;

/**
 * Repositório de `User`. A config do `relations` no construtor descreve como
 * os campos de relação são resolvidos nas **escritas** (`save`/`patch`/...) e no **merge**;
 * com `relationsSchema` (o `defineRelations()` do Drizzle) o `mode`/`table`/
 * `fkHere`/`fkThere` de cada relação são derivados do schema e só sobra escrever
 * `restriction` e `nullable`.
 */
class UserRepository extends VSRepository<User, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, {
                table: userTable,
                queryKey: "userTable",
                relationsSchema: relations,
                relations: {
                    // 1-N: o `userId` mora em `Post` (fkThere), então cada post
                    // aninhado no payload é inserido já apontando pro usuário.
                    posts: { restriction: "add" },
                    // 1-1: o `userId` mora em `Address` (fkThere). Com `nullable` + `restriction: "set"`,
                    // mandar `address: null` apaga o endereço.
                    address: { restriction: "set", nullable: true },
                },
                // logLevel: VSLogLevel.DEBUG,  // descomente pra ver cada query resolvida
            }),
            logLevel: VSLogLevel.INFO, // o padrão é WARN
        });
    }

    /**
     * Método dinâmico: o nome é interpretado em tempo de construção e vira uma
     * chamada real (`findOne({ email })`). Nenhum SQL é escrito à mão. Como
     * qualquer método do `VSRepository`, ele aceita `options` — e é a assinatura
     * declarada aqui que define quais argumentos ele recebe.
     */
    @DynamicMethod()
    declare findOneByEmail: (email: string, options?: MethodOptions<User, MyOrmTypes>) => Promise<User | null>;
}

/**
 * Repositório de `Post` — existe aqui só para a transação e para os métodos
 * atômicos/Agregados da seção 6. `user` é N-1: o `userId` mora em `Post`
 * (fkHere), então o adapter garante o User antes de inserir o Post.
 */
class PostRepository extends VSRepository<Post, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, {
                table: postTable,
                queryKey: "postTable",
                relationsSchema: relations,
                relations: {
                    user: { restriction: "add" },
                },
            }),
            logLevel: VSLogLevel.INFO,
        });
    }
}

const userRepository = new UserRepository();
const postRepository = new PostRepository();

// Sufixo único por execução: o script pode ser rodado quantas vezes quiser sem
// esbarrar na unique de `User.email`.
const tag = crypto.randomUUID().slice(0, 8);
const email = `ana.${tag}@email.com`;

// ---------------------------------------------------------------------------
// 1) Escrita com relations aninhadas
//    `address` e `posts` vêm no payload, e o adapter resolve tudo: cria o
//    Address e o Post, e liga os dois no User. O `relations` das options é o
//    lado de **leitura** — o que voltar já preenchido.
// ---------------------------------------------------------------------------
const user = await userRepository.save(
    {
        name: "Ana",
        email,
        role: Role.USER,
        passwordHash: "hashed-password",
        address: { city: "Recife", state: "PE" },
        posts: [{ title: "Primeiro post", content: "Conteúdo do primeiro post" }],
    },
    { relations: { address: true, posts: true } },
);

console.log("1) user criado:", {
    id: user.id,
    email: user.email,
    address: user.address,
    posts: user.posts.map(post => post.title),
});

// ---------------------------------------------------------------------------
// 2) Leitura com eager loading
//    O `relations` das options vira o `with` do Drizzle. (Se passar `select`, o
//    `relations` é ignorado — o `select` já cuida dos campos.)
// ---------------------------------------------------------------------------
const loaded = await userRepository.get(user.id, { relations: { address: true, posts: true } });

console.log("2) user lido:", {
    name: loaded?.name,
    address: loaded?.address?.city,
    posts: loaded?.posts.map(post => post.title),
});

// ---------------------------------------------------------------------------
// 3) Update parcial
//    Campos escalares por `pk`. Campo de relação também pode vir no payload —
//    `address: null` (com `nullable: true` + `restriction: "set"`) remove o endereço.
// ---------------------------------------------------------------------------
const patched = await userRepository.patch(user.id, { name: "Ana Paula" });

console.log("3) user atualizado:", { id: patched.id, name: patched.name });

// ---------------------------------------------------------------------------
// 4) Método dinâmico (`findOneByEmail` declarado na classe)
//    Ele aceita `options` como qualquer outro método — aqui, `relations` para já
//    trazer os posts junto.
// ---------------------------------------------------------------------------
const found = await userRepository.findOneByEmail(email, { relations: { posts: true } });

console.log("4) busca pelo email:", { found: found?.name, posts: found?.posts.length });

// ---------------------------------------------------------------------------
// 5) Transaction
//    `tx` é o client da transação: passar `{ db: tx }` faz a chamada participar
//    dela. O commit é o `resolve` do callback — o `rollback` é automático no
//    `throw`.
// ---------------------------------------------------------------------------
const post = await postRepository.transaction(async tx => {
    const createdPost = await postRepository.save(
        {
            title: "Post dentro da transação",
            content: "Se o callback resolver, esse post é persistido",
            // Nested `mto`: o adapter garante o User antes do Post e seta o
            // `userId`. Sem o `id` no payload, seria criado um User novo.
            user: { id: user.id },
        },
        { db: tx, relations: { user: true } },
    );

    // Qualquer repositório pode compartilhar a mesma transação.
    await userRepository.patch(user.id, { name: "Ana (editada na tx)" }, { db: tx });

    return createdPost;
});

console.log("5) post criado na transaction:", { id: post.id, title: post.title, user: post.user?.name });

// ---------------------------------------------------------------------------
// 6) Métodos atômicos e agregados
//    `increment` roda `SET views = views + 50` no servidor, e
//    `sum` agrega sobre os registros que casam com o `where` (todos, se o
//    `where` for omitido — aqui, só os posts deste usuário).
// ---------------------------------------------------------------------------
const incremented = await postRepository.increment(post.id, "views", 50);

console.log("6a) views após increment:", incremented.views);
console.log("6b) soma de views nos posts deste usuário:", await postRepository.sum("views", { userId: user.id }));

// ---------------------------------------------------------------------------
// 7) Limpeza — deixa o banco como estava, pra rodar o example de novo.
// ---------------------------------------------------------------------------
await postRepository.remove(post.id);
await userRepository.remove(user.id); // cascade apaga `Address` e `Post`

console.log("7) cleanup: users restantes =", await userRepository.total());
