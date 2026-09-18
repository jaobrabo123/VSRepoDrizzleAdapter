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

> Implementação de `VSRepoAdapter` para o [VSRepository v2](https://github.com/jaobrabo123/VSRepository) usando [Drizzle ORM](https://orm.drizzle.team/). Traduz toda operação do `VSRepository` em chamadas do Drizzle — queries relacionais (`db.query`), query builders do core (`db.select`/`insert`/`update`/`delete`), e SQL raw via `db.execute` — resolvendo `VSRepoWhere`, `Ordering`, `select`/`relations` através de parsers dedicados e — quando uma config de `relations` é fornecida — resolvendo campos de relação em `create`/`update`/`upsert`/`save`/`merge` imperativamente.

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
    - [`through`, `throughFkHere` e `throughFkThere`](#through-throughfkhere-e-throughfkthere)
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
npm install vsrepo drizzle-orm @vsrepo/drizzle-adapter@alpha
```

A versão `alpha` do `@vsrepo/drizzle-adapter` foi publicada; você pode instalá-la especificando a tag `@alpha`. O `vsrepo` já foi lançado e está pronto para uso. Você também precisa de um driver de banco do Drizzle para o seu dialeto (ex: `pg`, `better-sqlite3`).

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

Aqui, o `relations` passado no `options` do método — com a forma `{ campo: true }` — diz ao adapter quais relations carregar via API de query relacional do Drizzle (`db.query[queryKey].findFirst/findMany` com `with`). Se você fornecer `select`, o `relations` é ignorado. Não confunda com o `relations` da config do construtor, que descreve como campos de relação são resolvidos em payloads de escrita — a diferença é explicada em [Os dois `relations`](#os-dois-relations).

O `relations` do construtor acima está por extenso pra ficar claro o que cada campo faz. Se o seu `db` foi montado com o `defineRelations()` do Drizzle, a maior parte disso (`mode`/`table`/`fkHere`/`fkThere`) pode ser derivada automaticamente — ver [`relationsSchema`](#relationsschema).

`DrizzleOrmTypes<DB>` amarra os tipos de retorno de `getDbClient()`/`transaction()` do `VSRepository` aos seus tipos reais do Drizzle — ver [Transactions](#transactions).

## Config do construtor

```typescript
new DrizzleAdapter(db, {
    table: userTable,            // obrigatório — o objeto Table do Drizzle para esta entidade
    queryKey: "userTable",       // obrigatório — a chave em `db.query` para o query builder relacional desta tabela
    dialect: "postgresql",       // opcional — auto-detectado a partir da classe da `table` quando omitido; sobrescreve a detecção quando informado
    relationsSchema: relations,  // opcional — o objeto retornado pelo defineRelations() do Drizzle; ver "relationsSchema" abaixo
    relations: { ... },          // opcional — ver "relations no construtor (escrita)" abaixo
});
```

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `table` | `Table` (de `drizzle-orm`) | Sim | A definição de tabela do Drizzle para a entidade. A primary key é auto-detectada a partir da config de colunas da tabela. |
| `queryKey` | `keyof db["query"]` | Sim | A chave usada para acessar `db.query[queryKey]` — a entrada de query relacional do Drizzle para esta tabela. |
| `dialect` | `"postgresql" \| "sqlite" \| "cockroach"` | Não | O dialeto SQL. Auto-detectado a partir da classe do Drizzle da `table` (`PgTable`/`CockroachTable`/`SQLiteTable`) quando omitido — lança `NOT_SUPPORTED` se `table` não for nenhuma das três e `dialect` não foi informado. Um valor explícito sempre sobrescreve a detecção. Afeta a sintaxe de placeholders, `ILIKE` vs `LIKE`, e a interpretação de resultados raw. |
| `relationsSchema` | O objeto retornado por `defineRelations()` | Não | Habilita duas coisas: reconhecer campos de relação marcados `true` no `select` em qualquer profundidade, e derivar a maior parte do `relations` abaixo. Ver "`relationsSchema`" abaixo. |
| `relations` | `AdapterRelations<T>` | Não | Config de escrita de relations — ver abaixo. |

A config é validada no momento da construção — um `table`/`queryKey`/`dialect`/`relationsSchema`/`relations` inválido lança um `VSRepoAdapterError` apontando o campo problemático.

## Relations

### Os dois `relations`

O nome `relations` aparece em **dois lugares diferentes** da API, com **formas e propósitos diferentes** — fácil de confundir. Em resumo:

| | `relations` no **construtor** | `relations` nas **options** |
| --- | --- | --- |
| Onde você define | `new DrizzleAdapter(db, { relations: ... })` | `repository.get(where, { relations: ... })` — e demais métodos |
| Formato | Um objeto de **configuração** por campo: `{ restriction, mode?, table?, fkHere?/fkThere?, nullable? }` — tudo menos `restriction`/`nullable` pode ser derivado automaticamente, ver `relationsSchema` abaixo | Um objeto por campo **só com `true` ou sub-objeto**: `{ posts: true }` |
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
2. **Escrita** — cada campo do `relations` do construtor (abaixo) tem `table`/`mode`/`fkHere`/`fkThere` derivados automaticamente do schema, então normalmente só é preciso especificar `restriction` e `nullable`:

```typescript
relations: {
    posts: { restriction: "add" },
    address: { restriction: "set", nullable: true },
}
```

Derivação, por relation:

| Relation do Drizzle | `mode` derivado | FK derivada |
| --- | --- | --- |
| `relationType: "many"` | `"otm"` | `fkThere` — a coluna de FK na tabela relacionada |
| `relationType: "many"` declarada com `.through(...)` nas colunas de join `from`/`to` | `"mtm"` | `through`/`throughFkHere`/`throughFkThere` — a tabela de junção e suas duas colunas de FK |
| `relationType: "one"`, coluna de FK na tabela relacionada (ex.: uma 1-1 inferida/invertida, como `userTable.address`) | `"oto"` | `fkThere` |
| `relationType: "one"`, coluna de FK nesta tabela, unique (1-1, ex.: `addressTable.user`) | `"oto"` | `fkHere` |
| `relationType: "one"`, coluna de FK nesta tabela, não-unique (ex.: `postTable.user`) | `"mto"` | `fkHere` |

**`nullable` nunca é derivado** — ele é sempre `false` (não-nullable) a menos que você configure explicitamente em `relations`, exatamente como sem `relationsSchema`. Isso nunca se aplica a `otm`/`mtm`, já que ambos são sempre to-many.

Qualquer outro campo que você especificar explicitamente em `relations` sempre sobrescreve o valor derivado pra aquele campo.

`restriction` também **nunca** é derivado — não tem equivalente no schema, é puramente uma escolha de comportamento de escrita (ver abaixo) e sempre precisa ser dado manualmente.

A derivação de `mode`/`table`/`fkHere`/`fkThere`/`through`/`throughFkHere`/`throughFkThere` é pulada — o campo volta a precisar de uma entrada totalmente manual, igual sem `relationsSchema` — quando:
- o campo não é uma relation dessa tabela em `relationsSchema` (erro de digitação, ou realmente não existe);
- a relation faz join em mais de uma coluna (uma FK composta, ou — pra `mtm` — um join composto na tabela pivot);
- uma coluna de join `.through(...)` aponta pra algo que não é uma coluna simples (uma expressão SQL).

`relationsSchema` é totalmente opcional: tudo acima também funciona — só que manualmente — com a config `relations` 100% manual descrita a seguir.

### `relations` no construtor (escrita)

A config `relations` do construtor descreve, para cada campo de relação da entidade, **como o adapter deve resolver esse campo quando ele aparecer nos payloads de escrita** (`create`/`update`/`upsert`/`save`/`merge`).

Cada relation é configurada pelo nome do campo:

```typescript
relations: {
    posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" },
    address: { mode: "oto", restriction: "set", table: addressTable, fkThere: "userId", nullable: true },
    author: { mode: "mto", restriction: "set", table: userTable, fkHere: "authorId" },
    tags: {
        mode: "mtm",
        restriction: "set",
        table: tagTable,
        through: postTagTable,
        throughFkHere: "postId",
        throughFkThere: "tagId",
    },
}
```

(Com `relationsSchema` configurado, `mode`/`table`/`fkHere`/`fkThere`/`through`/`throughFkHere`/`throughFkThere` acima costumam ser derivados automaticamente — ver "`relationsSchema`" acima; `restriction` é sempre obrigatório, e `nullable` também sempre que você precisar que `null` signifique algo — ele nunca é derivado, ver acima.)

Sem `relations`, todo campo — incluindo campos de relação — é repassado direto pro `values`/`set` do `insert`/`update` do Drizzle, como está. Isso funciona bem pra campos escalares, mas o Drizzle não tem API de nested-write — então o adapter resolve as escritas de relação imperativamente: separa o payload, insere/atualiza linhas relacionadas na ordem correta, e conecta os valores de FK (ou, pra `mtm`, linhas na tabela de junção). Se sua entidade tem relations, normalmente você vai querer configurá-las.

#### `mode`

Cardinalidade da relation, do ponto de vista da entidade dona do campo:

| `mode` | Significado | Formato do campo que você envia |
| --- | --- | --- |
| `oto` | one-to-one | um único objeto, ou `null` |
| `mto` | many-to-one | um único objeto, ou `null` |
| `otm` | one-to-many | um array de objetos |
| `mtm` | many-to-many, através de uma tabela de junção | um array de objetos |

`mtm` não tem FK em nenhuma das duas tabelas — o vínculo mora numa tabela de junção/pivot separada que você mesmo possui (`through`), então ele usa `through`/`throughFkHere`/`throughFkThere` em vez de `fkHere`/`fkThere` (ver abaixo).

#### `restriction`

Controla como `save`/`update`/`upsert` tratam itens de relação que já existem (casados pela primary key) e, pra relations to-many, itens que **não** vieram no payload:

- **`"add"`** — só cria/atualiza os itens enviados. Itens já existentes que não estão no payload permanecem intocados.
- **`"set"`** — igual a `"add"`, mas também remove o que não foi enviado: em `otm` deleta os itens que faltam no array; em `oto`/`mto` com `nullable: true`, enviar `null` deleta/desconecta a relation (ver abaixo); em `mtm` deleta só as **linhas da tabela de junção** que faltam — a entidade relacionada em si nunca é apagada, já que uma relação many-to-many nunca é dona da linha relacionada do jeito que uma `otm` é.

#### `fkHere`, `fkThere` e `nullable`

Diferente do adapter Prisma (que usa um campo `pk` pra identificar registros relacionados via `connectOrCreate`), o adapter Drizzle trabalha diretamente com foreign keys, já que resolve as escritas imperativamente:

- **`fkHere`** — a coluna de foreign key **nesta tabela** que aponta pra tabela relacionada. Usado pra `mto` e `oto` (quando a FK fica no lado dono). O adapter lê/escreve nessa coluna pra vincular/desvincular a relation.
- **`fkThere`** — a coluna de foreign key **na tabela relacionada** que aponta de volta pra esta tabela. Usado pra `otm` e `oto` (quando a FK fica no lado relacionado). O adapter seta essa coluna nas linhas relacionadas pra vincular.
- **`nullable`** — relevante pras relações to-one `oto`/`mto`. Quando `true`, enviar `null` no campo resolve pra setar a FK como `null` ou deletar a linha relacionada (pra `oto` com `restriction: "set"`). Quando omitido/`false`, enviar `null` numa relação to-one lança um `VSRepoAdapterError` (code `INVALID_DATA`). Não se aplica a `otm`/`mtm`.

Cada `mode` exige exatamente um entre `fkHere`/`fkThere` — exceto `mtm`, que usa `through`/`throughFkHere`/`throughFkThere` no lugar (ver abaixo) e não aceita `fkHere`/`fkThere` de forma alguma:

| `mode` | FK obrigatória | Por que |
| --- | --- | --- |
| `otm` | `fkThere` | A FK fica no lado "many" (a tabela relacionada) |
| `mto` | `fkHere` | A FK fica na tabela dona |
| `oto` | `fkHere` **ou** `fkThere` | Depende de qual lado tem a FK |
| `mtm` | `through` + `throughFkHere` + `throughFkThere` | Não tem FK em nenhuma das duas tabelas — o vínculo mora numa tabela de junção separada |

#### `through`, `throughFkHere` e `throughFkThere`

Exclusivo do `mtm`. Uma relação many-to-many não tem FK direta em nenhum dos dois lados — o vínculo é uma linha numa tabela de junção/pivot que você mesmo possui, então esses três campos substituem `fkHere`/`fkThere` nesse modo:

- **`through`** — a `Table` do Drizzle pra tabela de junção (ex.: `postTagTable`, com colunas `postId`/`tagId` e tipicamente uma primary key composta nas duas).
- **`throughFkHere`** — a coluna em `through` que referencia a pk **desta** tabela (ex.: `postId`, do ponto de vista de `postTable`).
- **`throughFkThere`** — a coluna em `through` que referencia a pk da tabela **relacionada** (ex.: `tagId`).

```typescript
tags: {
    mode: "mtm",
    restriction: "set",
    table: tagTable,
    through: postTagTable,
    throughFkHere: "postId",
    throughFkThere: "tagId",
}
```

Escritas: um item sem pk é `insert`ado em `table` e depois vinculado; um item com pk que ainda não existe é `insert`ado; um item com pk que *já* existe **não** é atualizado — o resto dos campos no payload é ignorado, só a linha de junção é (re)vinculada. Isso difere de `otm`, que atualiza os campos de uma linha relacionada já existente em toda escrita, independente do `restriction`: `mtm` nunca mexe nos campos da linha relacionada depois que ela já existe, já que a relação não é dona dela (ver `restriction` acima). De qualquer forma, uma linha de junção só é inserida se ainda não existir uma pra aquele par (então reenviar um item já vinculado é um no-op, não uma linha duplicada). Com `restriction: "set"`, qualquer linha de junção deste "pai" que não fez parte do payload é apagada — de novo, só a linha de *junção*, nunca a entidade relacionada em `table`.

Se você usa o `defineRelations()` do Drizzle com um join `.through(...)` (ver abaixo), os três campos acima são derivados automaticamente de `relationsSchema` — normalmente você só precisa de `restriction`.

Com `relationsSchema` configurado assim:

```typescript
export const relations = defineRelations(schema, r => ({
    postTable: {
        tags: r.many.tagTable({
            from: r.postTable.id.through(r.postTagTable.postId),
            to: r.tagTable.id.through(r.postTagTable.tagId),
        }),
    },
    // ...
}));
```

a config do construtor se resume a:

```typescript
relations: {
    tags: { restriction: "set" },
}
```

#### Como cada método de escrita resolve relations

| Método | Relations |
| --- | --- |
| `create` | Resolve relations `fkHere` primeiro (cria/faz upsert das linhas relacionadas, seta a FK na linha principal antes de inserir), depois insere a linha principal, então resolve relations `fkThere`/`mtm` (cria/faz upsert das linhas relacionadas pra `otm`/`oto`; pra `mtm`, só cria as linhas que ainda não existem — as existentes ficam como estão — e então vincula via `through`, com a FK/vínculo apontando pra linha recém-criada) |
| `update` / `upsert` (metade do update) / `save` (branch de upsert) | Resolução completa: cria/faz upsert/deleta linhas relacionadas (ou, pra `mtm`, linhas da tabela de junção) conforme `mode`/`restriction`, atualizando FKs conforme necessário |
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

Pra relations to-many (`otm`/`mtm`), os itens do registro salvo e os itens de `obj` são casados pela primary key: um match faz merge dos dois itens, uma pk nova (ou sem pk) é apenas adicionada. `merge` nunca remove nada.

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

| Comportamento | `postgresql` | `sqlite` | `cockroach` |
| --- | --- | --- | --- |
| Busca case-insensitive (`contains`, `startsWith`, `endsWith` com `ignoreCase`) | `ILIKE` | `LIKE` (SQLite é case-insensitive pra ASCII por padrão) | `ILIKE` |
| Placeholders de SQL raw | `$1`, `$2`, ... | `?` | `$1`, `$2`, ... |
| Interpretação de resultado raw | array de linhas do node-postgres | shape de resultado do better-sqlite3 | array de linhas do node-postgres |

O dialeto é auto-detectado a partir da própria classe da `table` no Drizzle (`PgTable`/`CockroachTable`/`SQLiteTable`) quando `dialect` não é informado na config — ver [Config do construtor](#config-do-construtor). Um `dialect` explícito sempre sobrescreve a detecção.

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

O `deleteManyReturning` roda um `findMany` no `where` informado primeiro (pra capturar os registros e suas pks) e depois deleta por `inArray(pk, pks)` em vez de reaplicar o `where`. Isso garante que as linhas deletadas sejam sempre exatamente as que foram retornadas, mesmo que outra linha passe a bater (ou deixe de bater) com o `where` entre as duas etapas. Isso não torna a operação totalmente atômica, porém: uma linha ainda pode ser alterada ou deletada concorrentemente entre o `findMany` e o delete por pk, então os campos não-pk de um registro retornado podem estar desatualizados, ou sua pk pode não bater com nenhuma linha mais no momento do delete (o que deleta silenciosamente 0 linhas pra ela, sem lançar erro). Rode dentro de um `transaction()` num nível de isolamento mais alto se você precisar de consistência estrita.

## Limitações conhecidas

| Limitação | Detalhes |
| --- | --- |
| Sem suporte a `distinct` | A API de query relacional do Drizzle (`db.query[key].findMany`) não tem opção `distinct` — passar `distinct` no `findMany` lança `NOT_SUPPORTED`. |
| Sem `timeoutMs` em transactions | A API de transaction do Drizzle não expõe um parâmetro de timeout — passar `timeoutMs` lança `NOT_SUPPORTED`. |
| Filtros quantificadores `_every`/`_none` | Suportados, mas disparam um round-trip extra: uma query SQL de prefetch encontra as PKs que casam, então a API de query relacional filtra por essas PKs. |
| `select` com campos de relação marcados como `true` | Um campo de relação marcado como `true` no `select` só é enviado pro `with` se o adapter conseguir identificar isso — via `relationsSchema` (qualquer profundidade) ou o `relations` do construtor (só primeiro nível) — caso contrário, é tratado como coluna escalar e a query falha. Sem `relationsSchema`, relations aninhadas marcadas como `true` dentro de um objeto `select` são sempre tratadas como colunas (especifique um campo ou use a option `relations`). |
| Derivação do `relationsSchema` não cobre FKs/joins compostos | Uma relation que faz join em mais de uma coluna — incluindo, pra `mtm`, um join composto na tabela pivot — volta a precisar de uma entrada `relations` totalmente manual — igual sem `relationsSchema`. |
| MySQL não suportado | Só `postgresql`, `sqlite` e `cockroach` são suportados. Uma `table` criada com `mysqlTable()` lança `NOT_SUPPORTED` na hora da construção (o dialeto não é auto-detectável, e `dialect` nem tem um valor `"mysql"` pra passar). |

## Requisitos

- `vsrepo` ^2.3.0
- `drizzle-orm` ^1.0.0-rc.4
- Node.js >= 20