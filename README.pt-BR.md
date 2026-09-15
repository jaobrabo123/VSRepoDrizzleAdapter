<div align="center">
  <img src="https://res.cloudinary.com/ddbfifdxd/image/upload/w_200,q_auto,f_auto/v1786386427/VS_logo_TextoAbaixo_yev4tq.png" alt="VSRepository Logo" width="200"/>

  <p style="margin-top: 12px;">
    <img src="https://img.shields.io/npm/v/@vsrepo/drizzle-adapter?style=flat-square" alt="npm version"/>
    <img src="https://img.shields.io/npm/l/@vsrepo/drizzle-adapter?style=flat-square" alt="npm license"/>
    <img src="https://img.shields.io/npm/dt/@vsrepo/drizzle-adapter?style=flat-square" alt="npm downloads"/>
    <img src="https://img.shields.io/badge/inspired%20by-JpaRepository-E73121?style=flat-square" alt="inspired by JpaRepository"/>
  </p>
</div>

# VSRepoDrizzleAdapter

[Read in English](./README.md)

> Implementação de `VSRepoAdapter` para o [VSRepository v2](https://github.com/jaobrabo123/VSRepository) usando [Drizzle ORM](https://orm.drizzle.team/). Traduz toda operação do `VSRepository` em chamadas do Drizzle — queries relacionais (`db.query`), query builders do core (`db.select`/`insert`/`update`/`delete`), e SQL raw via `db.execute` — resolvendo `VSRepoWhere`, `Ordering`, `select`/`relations` através de parsers dedicados e — quando uma config de `relations` é fornecida — resolvendo campos de relação em `create`/`update`/`upsert`/`save`/`merge` imperativamente, já que o Drizzle não tem uma API de nested-write nativa.

---

## Sumário

- [Instalação](#instalação)
- [Uso básico](#uso-básico)
- [Config do construtor](#config-do-construtor)
- [Relations](#relations)
  - [Os dois `relations`](#os-dois-relations)
  - [`relationsSchema`](#relationsschema)
  - [`relations` no construtor (escrita)](#relations-no-construtor-escrita)
    - [`mode`](#mode)
    - [`restriction`](#restriction)
    - [`fkHere`, `fkThere` e `nullable`](#fkhere-fkthere-e-nullable)
    - [Como cada método de escrita resolve relations](#como-cada-método-de-escrita-resolve-relations)
  - [`relations` nas options (leitura)](#relations-nas-options-leitura)
- [`merge`](#merge)
- [Métodos atômicos e de agregação](#métodos-atômicos-e-de-agregação)
- [`createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` não suportam nested writes](#createmanycreatemanyreturningupdatemanyupdatemanyreturning-não-suportam-nested-writes)
- [Comportamento por dialeto](#comportamento-por-dialeto)
- [Transactions](#transactions)
- [Limitações conhecidas](#limitações-conhecidas)
- [Requisitos](#requisitos)

---

## Instalação

```bash
npm install vsrepo drizzle-orm @vsrepo/drizzle-adapter
```

Tanto o `vsrepo` quanto o `@vsrepo/drizzle-adapter` já foram publicados no npm. Você também precisa de um driver de banco do Drizzle para o seu dialeto (ex: `pg`, `better-sqlite3`).

## Uso básico

```typescript
import { VSRepository, DynamicMethod, MethodOptions, DeepPartial } from "vsrepo";
import { DrizzleAdapter, DrizzleOrmTypes } from "@vsrepo/drizzle-adapter";
import { userTable, postTable, addressTable } from "./drizzle/schema";
import { db } from "./drizzle/db";

// Seu tipo de entidade — bate com a shape retornada pelas queries relacionais do Drizzle
type User = typeof userTable.$inferSelect & {
    posts?: Post[];
    address?: Address | null;
};

type MyOrmTypes = DrizzleOrmTypes<typeof db>;

class UserRepository extends VSRepository<User, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    posts: {
                        mode: "otm",
                        fkThere: "userId",
                        restriction: "add",
                        table: postTable,
                    },
                    address: {
                        mode: "oto",
                        fkThere: "userId",
                        restriction: "set",
                        table: addressTable,
                        nullable: true,
                    },
                },
            }),
            pkName: "id",
        });
    }

    @DynamicMethod()
    declare findOneByEmail: (email: string) => Promise<User | null>;

    @DynamicMethod()
    declare deleteByEmail: (email: string, options?: MethodOptions<User>) => Promise<User>;
}

const userRepository = new UserRepository();

const user = await userRepository.get({ id: "..." }, { relations: { posts: true } });
```

Aqui, o `relations` passado no `options` do método — com a forma `{ campo: true }` — diz ao adapter quais relations carregar via API de query relacional do Drizzle (`db.query[queryKey].findFirst/findMany` com `with`). Se você fornecer `select`, o `relations` é ignorado (a API relacional do Drizzle não combina `columns` e `with` de fontes diferentes). Não confunda com o `relations` da config do construtor, que descreve como campos de relação são resolvidos em payloads de escrita — a diferença é explicada em [Os dois `relations`](#os-dois-relations).

O `relations` do construtor acima está por extenso pra ficar claro o que cada campo faz. Se o seu `db` foi montado com o `defineRelations()` do Drizzle, a maior parte disso (`mode`/`table`/`fkHere`/`fkThere`/`nullable`) pode ser derivada automaticamente — ver [`relationsSchema`](#relationsschema).

`DrizzleOrmTypes<DB>` amarra os tipos de retorno de `getDbClient()`/`transaction()` do `VSRepository` aos seus tipos reais do Drizzle — ver [Transactions](#transactions).

## Config do construtor

```typescript
new DrizzleAdapter(db, {
    table: userTable,            // obrigatório — o objeto Table do Drizzle para esta entidade
    queryKey: "userTable",       // obrigatório — a chave em `db.query` para o query builder relacional desta tabela
    dialect: "postgresql",       // opcional — "postgresql" (default), "sqlite" ou "cockroach"
    relationsSchema: relations,  // opcional — o objeto retornado pelo defineRelations() do Drizzle; ver "relationsSchema" abaixo
    relations: { ... },          // opcional — ver "relations no construtor (escrita)" abaixo
});
```

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `table` | `Table` (de `drizzle-orm`) | Sim | A definição de tabela do Drizzle para a entidade. A primary key é auto-detectada a partir da config de colunas da tabela. |
| `queryKey` | `keyof db["query"]` | Sim | A chave usada para acessar `db.query[queryKey]` — a entrada de query relacional do Drizzle para esta tabela. |
| `dialect` | `"postgresql" \| "sqlite" \| "cockroach"` | Não | O dialeto SQL. Default: `"postgresql"`. Afeta a sintaxe de placeholders, `ILIKE` vs `LIKE`, e a interpretação de resultados raw. |
| `relationsSchema` | O objeto retornado por `defineRelations()` | Não | Habilita duas coisas: reconhecer campos de relação marcados `true` no `select` em qualquer profundidade, e derivar a maior parte do `relations` abaixo. Ver "`relationsSchema`" abaixo. |
| `relations` | `AdapterRelations<T>` | Não | Config de escrita de relations — ver abaixo. |

A config é validada no momento da construção — um `table`/`queryKey`/`dialect`/`relationsSchema`/`relations` inválido lança um `VSRepoAdapterError` apontando o campo problemático.

## Relations

### Os dois `relations`

O nome `relations` aparece em **dois lugares diferentes** da API, com **formas e propósitos diferentes** — fácil de confundir. Em resumo:

| | `relations` no **construtor** | `relations` nas **options** |
| --- | --- | --- |
| Onde você define | `new DrizzleAdapter(db, { relations: ... })` | `repository.get(where, { relations: ... })` — e demais métodos |
| Formato | Um objeto de **configuração** por campo: `{ restriction, mode?, table?, fkHere?/fkThere?, nullable? }` — tudo menos `restriction` pode ser derivado automaticamente, ver `relationsSchema` abaixo | Um objeto por campo **só com `true` ou sub-objeto**: `{ posts: true }` |
| Propósito | **Escrita** — quando um payload de `create`/`update`/`upsert`/`save`/`merge` tem campo de relação, diz como resolvê-lo imperativamente (inserir/atualizar/deletar linhas relacionadas, setar valores de FK) | **Leitura** — eager loading: quais relations trazer junto no resultado (vira uma cláusula `with` do Drizzle) |
| Precisa da outra? | Não — só afeta escritas/`merge` | Só no caso do `select`: um campo de relação marcado como `true` só é reconhecido como relação (enviado pro `with`) se o adapter conseguir identificar isso — via `relationsSchema` (qualquer profundidade) ou, na falta dele, o `relations` do construtor (só primeiro nível). A option `relations` em si é independente |

O `relations` do construtor governa o comportamento de escrita mesmo que você nunca passe `relations` nas options — mas o contrário só é parcialmente verdadeiro: a option `relations` faz eager loading de leitura mesmo quando o construtor não tem `relations`, enquanto o `select` com campo de relação marcado como `true` depende do `relationsSchema`/`relations` do construtor (ver abaixo). As duas subseções abaixo detalham cada um.

### `relationsSchema`

`relationsSchema` é o objeto que o `defineRelations(schema, r => ({ ... }))` do Drizzle retorna — o mesmo que você passa pro `drizzle(client, { relations })`:

```typescript
import { defineRelations } from "drizzle-orm";
import * as schema from "./schema.js";

export const relations = defineRelations(schema, r => ({
    userTable: {
        posts: r.many.postTable(),
        address: r.one.addressTable(),
    },
    postTable: {
        user: r.one.userTable({ from: r.postTable.userId, to: r.userTable.id }),
    },
    addressTable: {
        user: r.one.userTable({ from: r.addressTable.userId, to: r.userTable.id }),
    },
}));

export const db = drizzle(client, { relations });
```

Passar isso no construtor do adapter habilita duas coisas:

1. **Leitura** — `select`s com campo de relação marcado `true` são reconhecidos em qualquer profundidade de aninhamento (uma relation de uma relation, ex.: `posts: { category: true }`, também funciona — ver a nota no fim de "`relations` nas options (leitura)" abaixo).
2. **Escrita** — cada campo do `relations` do construtor (abaixo) tem `table`/`mode`/`fkHere`/`fkThere`/`nullable` derivados automaticamente do schema, então normalmente só é preciso especificar `restriction`:

```typescript
relations: {
    posts: { restriction: "add" },
    address: { restriction: "set", nullable: true }, // nullable sobrescreve o valor derivado
}
```

Derivação, por relation:

| Relation do Drizzle | `mode` derivado | FK derivada | `nullable` derivado |
| --- | --- | --- | --- |
| `relationType: "many"` | `"otm"` | `fkThere` — a coluna de FK na tabela relacionada | não se aplica |
| `relationType: "one"`, coluna de FK na tabela relacionada (ex.: uma 1-1 inferida/invertida, como `userTable.address`) | `"oto"` | `fkThere` | `!` do `notNull` da coluna de FK |
| `relationType: "one"`, coluna de FK nesta tabela, unique (1-1, ex.: `addressTable.user`) | `"oto"` | `fkHere` | `!` do `notNull` da coluna de FK |
| `relationType: "one"`, coluna de FK nesta tabela, não-unique (ex.: `postTable.user`) | `"mto"` | `fkHere` | `!` do `notNull` da coluna de FK |

`nullable` é derivado do `notNull` da coluna de FK física — **não** do flag `optional` do próprio Drizzle na relation, que tem default `true` independente da constraint real da coluna, a menos que você configure `optional: false` manualmente no `defineRelations()` — por isso ele não é um sinal confiável aqui.

Qualquer campo que você especificar explicitamente em `relations` sempre sobrescreve o valor derivado pra aquele campo — útil pra uma regra de negócio de `nullable` que não está refletida na coluna do banco (o exemplo de `address` acima: `Address.userId` é `NOT NULL`, mas a aplicação ainda quer que `address: null` no payload apague o registro).

`restriction` **nunca** é derivado — não tem equivalente no schema, é puramente uma escolha de comportamento de escrita (ver abaixo) e sempre precisa ser dado manualmente.

A derivação é pulada — o campo volta a precisar de uma entrada totalmente manual, igual sem `relationsSchema` — quando:
- o campo não é uma relation dessa tabela em `relationsSchema` (erro de digitação, ou realmente não existe);
- a relation faz join em mais de uma coluna (uma FK composta);
- a relation passa por uma tabela de junção (o `through` do Drizzle, pra many-to-many) — `AdapterRelation` não tem forma pra many-to-many de qualquer forma, ver "`mode`" abaixo.

Você pode inspecionar o que seria derivado pra um campo específico com o helper exportado `deriveRelation(relationsSchema, tableKey, key)`.

`relationsSchema` é totalmente opcional: tudo acima também funciona — só que manualmente — com a config `relations` 100% manual descrita a seguir.

### `relations` no construtor (escrita)

A config `relations` do construtor descreve, para cada campo de relação da entidade, **como o adapter deve resolver esse campo quando ele aparecer nos payloads de escrita** (`create`/`update`/`upsert`/`save`/`merge`).

Cada relation é configurada pelo nome do campo:

```typescript
relations: {
    posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" },
    address: { mode: "oto", restriction: "set", table: addressTable, fkThere: "userId", nullable: true },
    author: { mode: "mto", restriction: "set", table: userTable, fkHere: "authorId" },
}
```

(Com `relationsSchema` configurado, o `mode`/`table`/`fkHere`/`fkThere`/`nullable` acima costumam ser derivados automaticamente — ver "`relationsSchema`" acima; só `restriction` é sempre obrigatório.)

Sem `relations`, todo campo — incluindo campos de relação — é repassado direto pro `values`/`set` do `insert`/`update` do Drizzle, como está. Isso funciona bem pra campos escalares, mas o Drizzle não tem API de nested-write (diferente do Prisma) — então o adapter resolve as escritas de relação imperativamente: separa o payload, insere/atualiza linhas relacionadas na ordem correta, e conecta os valores de FK. Se sua entidade tem relations, normalmente você vai querer configurá-las.

#### `mode`

Cardinalidade da relation, do ponto de vista da entidade dona do campo:

| `mode` | Significado | Formato do campo que você envia |
| --- | --- | --- |
| `oto` | one-to-one | um único objeto, ou `null` |
| `mto` | many-to-one | um único objeto, ou `null` |
| `otm` | one-to-many | um array de objetos |

> `mtm` (many-to-many) **não** é suportado por este adapter. Se você precisa de many-to-many, modele como duas relações `otm` através de uma tabela de junção.

#### `restriction`

Controla como `save`/`update`/`upsert` tratam itens de relação que já existem (casados pela primary key) e, pra relations to-many, itens que **não** vieram no payload:

- **`"add"`** — só cria/atualiza os itens enviados. Itens já existentes que não estão no payload permanecem intocados.
- **`"set"`** — igual a `"add"`, mas também remove o que não foi enviado: em `otm` deleta os itens que faltam no array; em `oto`/`mto` com `nullable: true`, enviar `null` deleta/desconecta a relation (ver abaixo).

#### `fkHere`, `fkThere` e `nullable`

Diferente do adapter Prisma (que usa um campo `pk` pra identificar registros relacionados via `connectOrCreate`), o adapter Drizzle trabalha diretamente com foreign keys, já que resolve as escritas imperativamente:

- **`fkHere`** — a coluna de foreign key **nesta tabela** que aponta pra tabela relacionada. Usado pra `mto` e `oto` (quando a FK fica no lado dono). O adapter lê/escreve nessa coluna pra vincular/desvincular a relation.
- **`fkThere`** — a coluna de foreign key **na tabela relacionada** que aponta de volta pra esta tabela. Usado pra `otm` e `oto` (quando a FK fica no lado relacionado). O adapter seta essa coluna nas linhas relacionadas pra vincular.
- **`nullable`** — relevante pras relações to-one `oto`/`mto`. Quando `true`, enviar `null` no campo resolve pra setar a FK como `null` (pra `fkHere`) ou deletar a linha relacionada (pra `fkThere` com `restriction: "set"`). Quando omitido/`false`, enviar `null` numa relação to-one lança um `VSRepoAdapterError` (code `INVALID_DATA`).

Cada `mode` exige exatamente um entre `fkHere`/`fkThere`:

| `mode` | FK obrigatória | Por que |
| --- | --- | --- |
| `otm` | `fkThere` | A FK fica no lado "many" (a tabela relacionada) |
| `mto` | `fkHere` | A FK fica na tabela dona |
| `oto` | `fkHere` **ou** `fkThere` | Depende de qual lado tem a FK |

#### Como cada método de escrita resolve relations

| Método | Relations |
| --- | --- |
| `create` | Resolve relations `fkHere` primeiro (cria/faz upsert das linhas relacionadas, seta a FK na linha principal antes de inserir), depois insere a linha principal, então resolve relations `fkThere` (cria/faz upsert das linhas relacionadas com a FK apontando pra linha recém-criada) |
| `update` / `upsert` (metade do update) / `save` (branch de upsert) | Resolução completa: cria/faz upsert/deleta linhas relacionadas conforme `mode`/`restriction`, atualizando FKs conforme necessário |
| `createMany` / `createManyReturning` / `updateMany` / `updateManyReturning` | Não suportado — lança um `VSRepoAdapterError` apontando o campo problemático se o payload tiver uma relation configurada |

### `relations` nas options (leitura)

Esse é o `relations` que você passa no `options` de um método do `VSRepository` (`get`, `find`, `findOne`, etc.). A forma é mais simples: um objeto onde cada campo de relação aceita:

- `true` — carrega a relation completa;
- ou outro objeto `relations` — para eager loading aninhado (relations da relation).

```typescript
const user = await userRepository.get(
    { id: "..." },
    {
        relations: {
            posts: true,                   // carrega os posts junto
            address: true,                 // carrega o endereço junto
        },
    }
);
```

Esse objeto é transformado numa cláusula `with` do Drizzle pelo adapter (`parseWith`). Ele **não** usa a config `relations`/`relationsSchema` do construtor: é puramente uma opção de leitura e funciona mesmo sem `relations`/`relationsSchema` na config. Essa independência vale **somente** para a option `relations` — não vale para o `select` (ver abaixo).

O `select` e o `relations` que você passa nas options são transformados em `columns` do Drizzle (`parseColumns`) e numa cláusula `with`, respectivamente. Quando o `select` é fornecido, somente os campos listados no `select` são buscados — se algum desses campos for um campo de relação, ele é automaticamente movido pra cláusula `with`. Ou seja, `select` subsume `relations` quando ambos são fornecidos.

> **O `select` depende do `relationsSchema`/`relations` do construtor para campos de relação marcados como `true`.** Quando um `select` marca um campo de relação como `true` (ex.: `select: { posts: true }`), o `parseColumns` só sabe que `posts` é uma relação (e o envia pro `with`) se o adapter conseguir identificar isso — via `relationsSchema`, ou, na falta dele, o `relations` do construtor. Sem nenhum dos dois, `posts: true` é tratado como coluna escalar e a query falha. Um campo de relação dado como objeto (ex.: `select: { posts: { title: true } }`) é sempre enviado pro `with`, independente da config. Relations aninhadas marcadas como `true` dentro de um objeto `select` (uma relation de uma relation, sem especificar os campos, ex.: `posts: { category: true }`) só são reconhecidas **quando `relationsSchema` está configurado** — é o que permite ao adapter consultar as relations da própria `postTable` pra resolver `category`, em qualquer profundidade. Sem `relationsSchema` (só o `relations` do construtor, que descreve apenas as relations da tabela *atual*), uma `true` aninhada assim é sempre tratada como coluna — especifique pelo menos um campo (`posts: { category: { id: true } }`), ou prefira a option `relations`, que nunca depende de nenhuma das duas configs.

## `merge`

`merge(where, obj, options)` busca o registro que casa com `where` e devolve ele **deep-merged, em memória**, com `obj` — ele **não** escreve nada no banco. Isso reflete exatamente como o `merge` funciona no VSRepository: ele serve pra montar uma entidade completa e mesclada, que você depois passa pro `save`/`update`, e não pra persistir um update parcial diretamente.

Pra relations to-many (`otm`), os itens do registro salvo e os itens de `obj` são casados pela primary key: um match faz merge dos dois itens, uma pk nova (ou sem pk) é apenas adicionada. `merge` nunca remove nada.

## Métodos atômicos e de agregação

O adapter implementa os 8 métodos abstratos pros quais `increment`/`decrement`/`multiply`/`divide`/`sum`/`average`/`min`/`max` do `VSRepository` delegam: `incrementOne`, `decrementOne`, `multiplyOne`, `divideOne`, `sum`, `average`, `min`, `max`.

- `incrementOne`/`decrementOne`/`multiplyOne`/`divideOne` traduzem pra expressões SQL raw — ``sql`${column} + ${value}` `` (e `-`/`*`/`/`) — então a operação é avaliada **server-side** contra o valor *atual* do registro (`UPDATE ... SET field = field + value`), e não como um fetch-then-save no cliente. O adapter lê a pk do registro primeiro, aplica o update atômico, e depois re-lê a entidade completa pra retornar.
- `sum`/`average`/`min`/`max` traduzem pras funções de agregação do Drizzle `sum()`/`avg()`/`min()`/`max()`. O resultado bruto (`number`, `bigint`, `string` ou `null`) é normalizado pra `number | null` — `null` é repassado como está (espelhando o comportamento dos agregados SQL sobre um conjunto vazio), e valores não-numéricos são convertidos via `Number()`.

```typescript
// Atômico — avaliado server-side, sem read-modify-write:
await productRepository.increment(productId, "stock", 10);
await accountRepository.decrement(accountId, "balance", 50);
await productRepository.multiply(productId, "price", 1.1); // ex: um reajuste de 10% no preço
await productRepository.divide(productId, "price", 2);

// Agregação — entre todos os registros que casam com um `where` opcional (todos se omitido):
const total = await productRepository.sum("price"); // number | null
const avgPrice = await productRepository.average("price", { active: true });
const cheapest = await productRepository.min("price");
const mostExpensive = await productRepository.max("price");
```

## `createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` não suportam nested writes

`createMany`, `createManyReturning`, `updateMany` e `updateManyReturning` só aceitam campos escalares no `data`. Se seu payload incluir um campo configurado em `relations` (independente do valor), o adapter lança um `VSRepoAdapterError` (code `NOT_SUPPORTED`) apontando o campo problemático. Pra um nested write completo, use `create`/`update`/`save` registro por registro, ou envolva várias chamadas de `save` num `saveMany`/`transaction`.

> Nota sobre a ordem de retorno: `createManyReturning` e `updateManyReturning` não garantem que os registros devolvidos seguem a ordem do payload de entrada. O resultado vem de um segundo `findMany` (re-buscando as linhas inseridas/atualizadas pela primary key), então a ordem só é garantida quando você passa `order` nas options.

## Comportamento por dialeto

O adapter suporta três dialetos SQL, cada um com comportamento ligeiramente diferente:

| Comportamento | `postgresql` (default) | `sqlite` | `cockroach` |
| --- | --- | --- | --- |
| Busca case-insensitive (`contains`, `startsWith`, `endsWith` com `ignoreCase`) | `ILIKE` | `LIKE` (SQLite é case-insensitive pra ASCII por padrão) | `ILIKE` |
| Placeholders de SQL raw | `$1`, `$2`, ... | `?` | `$1`, `$2`, ... |
| Interpretação de resultado raw | array de linhas do node-postgres | shape de resultado do better-sqlite3 | array de linhas do node-postgres |

O dialeto é auto-inferido do client Drizzle quando possível, ou você pode setá-lo explicitamente via `dialect` na config.

## Transactions

**Todos** os métodos aceitam `options.db` e executam a operação no client/transaction passado — a diferença está em **como** cada um o trata:

- A maioria (operações de uma única chamada) roda direto em `options?.db`: você passa um transaction client e a chamada participa da transaction, sem iniciar nada novo.
- `saveMany`, `updateManyReturning`, `createManyReturning`, `deleteManyReturning`, `create`, `update`, `upsert`, `save` e `delete` precisam rodar **mais de uma operação** do Drizzle atomicamente (resolução de relations, pk-prefetch, etc.), então passam por `runTransactional`. Se `options.db` já for uma transaction (detectada via presença do método `rollback`), ela é reaproveitada — nenhuma transaction aninhada é criada; caso contrário, uma nova transaction é criada.

Um transaction client é diferenciado do client Drizzle raiz pelo método `rollback`: transaction clients o expõem, o client raiz não.

```typescript
await userRepository.transaction(async tx => {
    await userRepository.save(user, { db: tx });
    await userRepository.saveList(outrosUsuarios, { db: tx });
});
```

`DrizzleOrmTypes<DB>` amarra os genéricos `dbClient` e `dbTransaction` do `VSRepository` aos seus tipos reais do Drizzle, então `getDbClient()` e o parâmetro `tx` do callback ficam corretamente tipados:

```typescript
import { DrizzleOrmTypes } from "@vsrepo/drizzle-adapter";

type MyOrmTypes = DrizzleOrmTypes<typeof db>;

class UserRepository extends VSRepository<User, string, MyOrmTypes> {
    // ...
}

// getDbClient() retorna `typeof db`
// transaction(tx => ...) — tx é o tipo de transaction inferido de `typeof db`
```

### Options de transaction

`runInTransaction` suporta `isolationLevel` (mapeado pra config de transaction do Drizzle), mas **não** suporta `timeoutMs` — passá-lo lança um `VSRepoAdapterError` (code `NOT_SUPPORTED`).

```typescript
import { TransactionIsolationLevel } from "vsrepo";

await userRepository.transaction(async tx => {
    await userRepository.save(user, { db: tx });
}, {
    isolationLevel: TransactionIsolationLevel.SERIALIZABLE,
});
```

### Concorrência em `deleteManyReturning`

O `deleteManyReturning` roda um `findMany` no `where` informado (pra capturar os registros que vai devolver) e depois re-aplica o mesmo `where` num `deleteMany`. Por causa desse formato em duas etapas, uma alteração concorrente entre o `findMany` e o `deleteMany` pode fazer os dois divergirem — os registros retornados e as linhas realmente deletadas não têm garantia de serem idênticos sob concorrência. Rode dentro de um `transaction()` num nível de isolamento mais alto se você precisar de consistência estrita.

## Limitações conhecidas

| Limitação | Detalhes |
| --- | --- |
| Sem suporte a `distinct` | A API de query relacional do Drizzle (`db.query[key].findMany`) não tem opção `distinct` — passar `distinct` no `findMany` lança `NOT_SUPPORTED`. |
| Sem modo `mtm` | Relations many-to-many não são suportadas. Modele como duas relações `otm` através de uma tabela de junção. |
| Sem `timeoutMs` em transactions | A API de transaction do Drizzle não expõe um parâmetro de timeout — passar `timeoutMs` lança `NOT_SUPPORTED`. |
| Filtros quantificadores `_every`/`_none` | Suportados, mas disparam um round-trip extra: uma query SQL de prefetch encontra as PKs que casam, então a API de query relacional filtra por essas PKs. |
| `select` com campos de relação marcados como `true` | Um campo de relação marcado como `true` no `select` só é enviado pro `with` se o adapter conseguir identificar isso — via `relationsSchema` (qualquer profundidade) ou o `relations` do construtor (só primeiro nível) — caso contrário, é tratado como coluna escalar e a query falha. Sem `relationsSchema`, relations aninhadas marcadas como `true` dentro de um objeto `select` são sempre tratadas como colunas (especifique um campo ou use a option `relations`). |
| Derivação do `relationsSchema` não cobre FK composta nem many-to-many | Uma relation que faz join em mais de uma coluna, ou passa por uma tabela de junção (`through` do Drizzle), volta a precisar de uma entrada `relations` totalmente manual — igual sem `relationsSchema`. |

## Requisitos

- `vsrepo` ^2.3.0
- `drizzle-orm` ^1.0.0-rc.4
- Node.js >= 20