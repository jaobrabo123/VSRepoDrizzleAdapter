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

[Ler em portugues](./README.pt-BR.md)

> `VSRepoAdapter` implementation for [VSRepository v2](https://github.com/jaobrabo123/VSRepository) backed by [Drizzle ORM](https://orm.drizzle.team/). It translates every `VSRepository` operation into Drizzle calls — relational queries (`db.query`), core query builders (`db.select`/`insert`/`update`/`delete`), and raw SQL via `db.execute` — resolving `VSRepoWhere`, `Ordering`, `select`/`relations` through dedicated parsers, and — when a `relations` config is provided — resolving relation fields on `create`/`update`/`upsert`/`save`/`merge` imperatively, since Drizzle has no built-in nested-write API.

---

## Table of contents

- [Installation](#installation)
- [Basic usage](#basic-usage)
- [Constructor config](#constructor-config)
- [Relations](#relations)
  - [The two `relations`](#the-two-relations)
  - [`relationsSchema`](#relationsschema)
  - [`relations` in the constructor (write)](#relations-in-the-constructor-write)
    - [`mode`](#mode)
    - [`restriction`](#restriction)
    - [`fkHere`, `fkThere` and `nullable`](#fkhere-fkthere-and-nullable)
    - [How each write method resolves relations](#how-each-write-method-resolves-relations)
  - [`relations` in method options (read)](#relations-in-method-options-read)
- [`merge`](#merge)
- [Atomic and aggregation methods](#atomic-and-aggregation-methods)
- [`createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` don't support nested writes](#createmanycreatemanyreturningupdatemanyupdatemanyreturning-dont-support-nested-writes)
- [Dialect-specific behavior](#dialect-specific-behavior)
- [Transactions](#transactions)
- [Known limitations](#known-limitations)
- [Requirements](#requirements)

---

## Installation

```bash
npm install vsrepo drizzle-orm @vsrepo/drizzle-adapter
```

Both `vsrepo` and `@vsrepo/drizzle-adapter` are published to npm. You also need a Drizzle database driver for your dialect (e.g. `pg`, `better-sqlite3`).

## Basic usage

```typescript
import { VSRepository, DynamicMethod, MethodOptions, DeepPartial } from "vsrepo";
import { DrizzleAdapter, DrizzleOrmTypes } from "@vsrepo/drizzle-adapter";
import { userTable, postTable, addressTable } from "./drizzle/schema";
import { db } from "./drizzle/db";

// Your entity type — matches the shape returned by Drizzle's relational queries
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

Here the `relations` you pass in the method `options` — shaped like `{ field: true }` — tells the adapter which relations to eager-load via Drizzle's relational query API (`db.query[queryKey].findFirst/findMany` with `with`). If you supply `select`, the `relations` is ignored (Drizzle's relational API doesn't combine `columns` and `with` from different sources). Don't confuse it with the constructor-config `relations`, which describes how relation fields are resolved in write payloads — the difference is explained in [The two `relations`](#the-two-relations).

The constructor `relations` above is spelled out in full for clarity. If your `db` was built with Drizzle's `defineRelations()`, most of that (`mode`/`table`/`fkHere`/`fkThere`) can be derived automatically — see [`relationsSchema`](#relationsschema).

`DrizzleOrmTypes<DB>` ties `VSRepository`'s `getDbClient()`/`transaction()` return types to your real Drizzle types — see [Transactions](#transactions).

## Constructor config

```typescript
new DrizzleAdapter(db, {
    table: userTable,           // required — the Drizzle Table object for this entity
    queryKey: "userTable",      // required — the key in `db.query` for this table's relational query builder
    dialect: "postgresql",      // optional — auto-detected from `table`'s class when omitted; overrides detection when given
    relationsSchema: relations, // optional — the object returned by Drizzle's defineRelations(); see "relationsSchema" below
    relations: { ... },         // optional — see "relations in the constructor (write)" below
});
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `table` | `Table` (from `drizzle-orm`) | Yes | The Drizzle table definition for the entity. The primary key is auto-detected from the table's column config. |
| `queryKey` | `keyof db["query"]` | Yes | The key used to access `db.query[queryKey]` — Drizzle's relational query entry for this table. |
| `dialect` | `"postgresql" \| "sqlite" \| "cockroach"` | No | The SQL dialect. Auto-detected from `table`'s own Drizzle class (`PgTable`/`CockroachTable`/`SQLiteTable`) when omitted — throws `NOT_SUPPORTED` if `table` isn't one of those three and `dialect` wasn't given. An explicit value always overrides detection. Affects placeholder syntax, `ILIKE` vs `LIKE`, and raw result interpretation. |
| `relationsSchema` | The object returned by `defineRelations()` | No | Drives two things: recognizing `true`-marked relation fields in `select` at any nesting depth, and deriving most of `relations` below. See "`relationsSchema`" below. |
| `relations` | `AdapterRelations<T>` | No | Relation write config — see below. |

The config is validated at construction time — an invalid `table`/`queryKey`/`dialect`/`relationsSchema`/`relations` throws a `VSRepoAdapterError` naming the offending field.

## Relations

### The two `relations`

The name `relations` appears in **two different places** in the API, with **different shapes and purposes** — easy to confuse. In a nutshell:

| | `relations` in the **constructor** | `relations` in **method options** |
| --- | --- | --- |
| Where you define it | `new DrizzleAdapter(db, { relations: ... })` | `repository.get(where, { relations: ... })` — and other methods |
| Shape | One **config object** per field: `{ restriction, mode?, table?, fkHere?/fkThere?, nullable? }` — everything but `restriction`/`nullable` can be auto-derived, see `relationsSchema` below | One **`true`/sub-object** per field: `{ posts: true }` |
| Purpose | **Write** — when a `create`/`update`/`upsert`/`save`/`merge` payload contains a relation field, tells the adapter how to resolve it imperatively (insert/update/delete related rows, set FK values) | **Read** — eager loading: which relations to fetch alongside the result (becomes a Drizzle `with` clause) |
| Depends on the other? | No — it only affects writes/`merge` | Only for `select`: a relation field marked `true` is only recognized as a relation (routed to `with`) if the adapter can tell it's a relation — via `relationsSchema` (any depth) or, failing that, the constructor's `relations` (first level only). The `relations` option itself is independent |

The constructor `relations` governs write behavior even if you never pass `relations` in options — but the reverse is only partially true: the method-options `relations` does eager loading even when the constructor has no `relations`, while `select` with a relation field marked `true` does depend on `relationsSchema`/the constructor's `relations` (see below). The two subsections below cover each one.

### `relationsSchema`

`relationsSchema` is the object Drizzle's `defineRelations(schema, r => ({ ... }))` returns — the same one you pass to `drizzle(client, { relations })`:

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

Passing it into the adapter's constructor drives two things:

1. **Reads** — `select`s with a relation field marked `true` are recognized at any nesting depth (a relation of a relation, e.g. `posts: { category: true }`, works too — see the note at the end of "`relations` in method options (read)" below).
2. **Writes** — each field of the constructor's `relations` (below) gets its `table`/`mode`/`fkHere`/`fkThere` auto-derived from the schema, so you typically only need to spell out `restriction` and `nullable`:

```typescript
relations: {
    posts: { restriction: "add" },
    address: { restriction: "set", nullable: true },
}
```

Derivation, per relation:

| Drizzle relation | Derived `mode` | Derived FK |
| --- | --- | --- |
| `relationType: "many"` | `"otm"` | `fkThere` — the FK column on the related table |
| `relationType: "one"`, FK column on the related table (e.g. an inferred/reversed 1-1, like `userTable.address`) | `"oto"` | `fkThere` |
| `relationType: "one"`, FK column on this table, unique (1-1, e.g. `addressTable.user`) | `"oto"` | `fkHere` |
| `relationType: "one"`, FK column on this table, not unique (e.g. `postTable.user`) | `"mto"` | `fkHere` |

**`nullable` is never derived** — it's always `false` (not nullable) unless you set it explicitly in `relations`, exactly like without `relationsSchema`.

Any other field you spell out explicitly in `relations` always overrides the derived value for that field.

`restriction` is **never** derived either — there's no schema equivalent for it, it's purely a write-behavior choice (see below) and always has to be given by hand.

Derivation is skipped for `mode`/`table`/`fkHere`/`fkThere` — the field falls back to needing a fully manual entry, same as without `relationsSchema` — when:
- the field isn't a relation on this table in `relationsSchema` (typo, or genuinely not there);
- the relation joins on more than one column (a composite FK);
- the relation goes through a junction table (Drizzle's `through`, for many-to-many) — `AdapterRelation` has no shape for many-to-many either way, see "`mode`" below.

`relationsSchema` is entirely optional: everything above also works — you just do it all by hand — with the fully manual `relations` config described next.

### `relations` in the constructor (write)

The `relations` config on the constructor describes, for each relation field of your entity, **how the adapter should resolve that field when it shows up in write payloads** (`create`/`update`/`upsert`/`save`/`merge`).

Each relation is configured by its field name:

```typescript
relations: {
    posts: { mode: "otm", restriction: "add", table: postTable, fkThere: "userId" },
    address: { mode: "oto", restriction: "set", table: addressTable, fkThere: "userId", nullable: true },
    author: { mode: "mto", restriction: "set", table: userTable, fkHere: "authorId" },
}
```

(With `relationsSchema` configured, `mode`/`table`/`fkHere`/`fkThere` above are usually derived automatically — see "`relationsSchema`" above; `restriction` is always required, and so is `nullable` whenever you need `null` to mean something — it's never derived, see above.)

Without `relations`, every field — including relation fields — is passed straight through to the Drizzle `insert`/`update` `values`/`set`, as-is. That works for scalar fields, but Drizzle has no nested-write API (unlike Prisma), so the adapter resolves relation writes imperatively: it splits the payload, inserts/updates related rows in the correct order, and wires FK values. If your entity has relations you'll usually want to configure them.

#### `mode`

Cardinality of the relation, from the point of view of the entity that owns the field:

| `mode` | Meaning | Field shape you send |
| --- | --- | --- |
| `oto` | one-to-one | a single object, or `null` |
| `mto` | many-to-one | a single object, or `null` |
| `otm` | one-to-many | an array of objects |

> `mtm` (many-to-many) is **not** supported by this adapter. If you need many-to-many, model it as two `otm` relations through a join table.

#### `restriction`

Controls how `save`/`update`/`upsert` handle relation items that already exist (matched by primary key) and, for to-many relations, items that were **not** included in the payload:

- **`"add"`** — only creates/updates the items you send. Existing items that aren't in the payload are left untouched.
- **`"set"`** — same as `"add"`, but also removes what wasn't sent: for `otm` it deletes the items missing from the array; for `oto`/`mto` with `nullable: true`, sending `null` deletes/disconnects the relation (see below).

#### `fkHere`, `fkThere` and `nullable`

Unlike the Prisma adapter (which uses a `pk` field to identify related records via `connectOrCreate`), the Drizzle adapter works directly with foreign keys, since it resolves writes imperatively:

- **`fkHere`** — the foreign key column **on this table** that points to the related table. Used for `mto` and `oto` (when the FK lives on the owning side). The adapter reads/writes this column to link/unlink the relation.
- **`fkThere`** — the foreign key column **on the related table** that points back to this table. Used for `otm` and `oto` (when the FK lives on the related side). The adapter sets this column on the related rows to link them.
- **`nullable`** — relevant for `oto`/`mto` to-one relations. When `true`, sending `null` for the field resolves to setting the FK to `null` or deleting the related row (for `oto` with `restriction: "set"`). When omitted/`false`, sending `null` for a to-one relation throws a `VSRepoAdapterError` (code `INVALID_DATA`).

Each `mode` requires exactly one of `fkHere`/`fkThere`:

| `mode` | Required FK | Why |
| --- | --- | --- |
| `otm` | `fkThere` | The FK is on the "many" side (the related table) |
| `mto` | `fkHere` | The FK is on the owning table |
| `oto` | `fkHere` **or** `fkThere` | Depends on which side holds the FK |

#### How each write method resolves relations

| Method | Relations |
| --- | --- |
| `create` | Resolves `fkHere` relations first (creates/upserts related rows, sets the FK on the main row before inserting), then inserts the main row, then resolves `fkThere` relations (creates/upserts related rows with the FK pointing to the newly created row) |
| `update` / `upsert` (update half) / `save` (upsert branch) | Full resolution: creates/upserts/deletes related rows per `mode`/`restriction`, updating FKs as needed |
| `createMany` / `createManyReturning` / `updateMany` / `updateManyReturning` | Not supported — throws a `VSRepoAdapterError` naming the offending field if the payload contains a configured relation |

### `relations` in method options (read)

This is the `relations` you pass in the `options` of a `VSRepository` method (`get`, `find`, `findOne`, etc.). The shape is simpler: an object where each relation field accepts:

- `true` — load the relation as-is;
- or another `relations` object — for nested eager loading (relations of the relation).

```typescript
const user = await userRepository.get(
    { id: "..." },
    {
        relations: {
            posts: true,                   // fetch posts along
            address: true,                 // fetch address along
        },
    }
);
```

This object is turned into a Drizzle `with` clause by the adapter (`parseWith`). It does **not** use the constructor's `relations`/`relationsSchema` config: it's purely a read-side option and works even with no `relations`/`relationsSchema` in the config. This independence holds **only** for the `relations` option — it does **not** hold for `select` (see below).

The `select` and `relations` you pass in the options are turned into Drizzle `columns` (`parseColumns`) and a Drizzle `with` clause, respectively. When `select` is provided, only the fields listed in `select` are fetched — if any of those fields are relation fields, they're automatically moved into the `with` clause. In other words, `select` subsumes `relations` when both are provided.

> **`select` depends on `relationsSchema`/the constructor's `relations` for `true`-marked relation fields.** When a `select` marks a relation field as `true` (e.g. `select: { posts: true }`), `parseColumns` only knows `posts` is a relation (and routes it to `with`) if the adapter can tell — via `relationsSchema`, or, failing that, the constructor's `relations`. Without either, `posts: true` is treated as a scalar column and the query fails. A relation field given as an object (e.g. `select: { posts: { title: true } }`) is always routed to `with`, regardless of config. Nested relations marked `true` inside a `select` object (a relation of a relation, without spelling out its fields, e.g. `posts: { category: true }`) are recognized **only when `relationsSchema` is configured** — it's what lets the adapter look up `postTable`'s own relations to resolve `category`, at any depth. Without `relationsSchema` (only the constructor's `relations`, which only describes the *current* table's relations), a nested `true` like that is always treated as a column — spell out at least one field instead (`posts: { category: { id: true } }`), or prefer the `relations` option, which never depends on either config.

## `merge`

`merge(where, obj, options)` fetches the record matching `where` and returns it **deep-merged, in memory**, with `obj` — it does **not** write anything to the database. This mirrors how `merge` works in VSRepository: it's meant to build a full, merged entity that you then pass to `save`/`update` yourself, not to persist a partial update directly.

For to-many relations (`otm`), items in the stored record and items in `obj` are matched by primary key: a match merges the two items, a new pk (or no pk) is appended. Nothing is ever removed by `merge`.

## Atomic and aggregation methods

The adapter implements the 8 abstract methods `VSRepository`'s `increment`/`decrement`/`multiply`/`divide`/`sum`/`average`/`min`/`max` delegate to: `incrementOne`, `decrementOne`, `multiplyOne`, `divideOne`, `sum`, `average`, `min`, `max`.

- `incrementOne`/`decrementOne`/`multiplyOne`/`divideOne` translate into raw SQL expressions — ``sql`${column} + ${value}` `` (and `-`/`*`/`/`) — so the operation is evaluated **server-side** against the row's *current* value (`UPDATE ... SET field = field + value`), not as a fetch-then-save round trip on the client. The adapter reads the row's pk first, applies the atomic update, then re-reads the full entity to return.
- `sum`/`average`/`min`/`max` translate into Drizzle's `sum()`/`avg()`/`min()`/`max()` aggregate functions. The raw result (`number`, `bigint`, `string`, or `null`) is normalized to `number | null` — `null` is returned as-is (mirroring SQL's aggregate behavior over an empty set), and non-number values are converted via `Number()`.

```typescript
// Atomic — evaluated server-side, no read-modify-write:
await productRepository.increment(productId, "stock", 10);
await accountRepository.decrement(accountId, "balance", 50);
await productRepository.multiply(productId, "price", 1.1); // e.g. a 10% price bump
await productRepository.divide(productId, "price", 2);

// Aggregation — across every record matching an optional `where` (all if omitted):
const total = await productRepository.sum("price"); // number | null
const avgPrice = await productRepository.average("price", { active: true });
const cheapest = await productRepository.min("price");
const mostExpensive = await productRepository.max("price");
```

## `createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` don't support nested writes

`createMany`, `createManyReturning`, `updateMany` and `updateManyReturning` only accept scalar fields in their `data`. If your payload includes a field configured in `relations` (regardless of its value), the adapter throws a `VSRepoAdapterError` (code `NOT_SUPPORTED`) naming the offending field. For a full nested write, use `create`/`update`/`save` one record at a time, or wrap several `save` calls in a `saveMany`/`transaction`.

> Note on return order: `createManyReturning` and `updateManyReturning` don't guarantee the returned records follow the order of the input payload. Their result comes from a second `findMany` (re-querying the inserted/updated rows by primary key), so the order is only guaranteed when you pass `order` in the options.

## Dialect-specific behavior

The adapter supports three SQL dialects, each with slightly different behavior:

| Behavior | `postgresql` | `sqlite` | `cockroach` |
| --- | --- | --- | --- |
| Case-insensitive search (`contains`, `startsWith`, `endsWith` with `ignoreCase`) | `ILIKE` | `LIKE` (SQLite is case-insensitive for ASCII by default) | `ILIKE` |
| Raw SQL placeholders | `$1`, `$2`, ... | `?` | `$1`, `$2`, ... |
| Raw result interpretation | node-postgres row array | better-sqlite3 result shape | node-postgres row array |

The dialect is auto-detected from the `table`'s own Drizzle class (`PgTable`/`CockroachTable`/`SQLiteTable`) when `dialect` isn't given in the config — see [Constructor config](#constructor-config). An explicit `dialect` always overrides detection.

## Transactions

**Every** method accepts `options.db` and runs its operation on the client/transaction you pass — the difference is in **how** each one treats it:

- Most methods (single, one-call operations) simply run directly on `options?.db`: hand them a transaction client and the call participates in that transaction, starting nothing new.
- `saveMany`, `updateManyReturning`, `createManyReturning`, `deleteManyReturning`, `create`, `update`, `upsert`, `save`, and `delete` need to run **more than one** Drizzle operation atomically (relation resolution, pk-prefetch, etc.), so they go through `runTransactional`. If `options.db` is already a transaction (detected via `rollback` method presence), it's reused — no nested transaction is started; otherwise, a new transaction is created.

A transaction client is told apart from the root Drizzle client by the `rollback` method: transaction clients expose it, the root client doesn't.

```typescript
await userRepository.transaction(async tx => {
    await userRepository.save(user, { db: tx });
    await userRepository.saveList(otherUsers, { db: tx });
});
```

`DrizzleOrmTypes<DB>` ties the `dbClient` and `dbTransaction` generics of `VSRepository` to your real Drizzle types, so `getDbClient()` and the `tx` callback parameter are correctly typed:

```typescript
import { DrizzleOrmTypes } from "@vsrepo/drizzle-adapter";

type MyOrmTypes = DrizzleOrmTypes<typeof db>;

class UserRepository extends VSRepository<User, string, MyOrmTypes> {
    // ...
}

// getDbClient() returns `typeof db`
// transaction(tx => ...) — tx is the transaction type inferred from `typeof db`
```

### Transaction options

`runInTransaction` supports `isolationLevel` (mapped to Drizzle's transaction config), but does **not** support `timeoutMs` — passing it throws a `VSRepoAdapterError` (code `NOT_SUPPORTED`).

```typescript
import { TransactionIsolationLevel } from "vsrepo";

await userRepository.transaction(async tx => {
    await userRepository.save(user, { db: tx });
}, {
    isolationLevel: TransactionIsolationLevel.SERIALIZABLE,
});
```

### Concurrency in `deleteManyReturning`

`deleteManyReturning` runs a `findMany` on the given `where` (to capture the records it will return) and then re-applies the same `where` to a `deleteMany`. Because of this two-step shape, a concurrent change between the `findMany` and the `deleteMany` can make them diverge — the returned records and the rows actually deleted are not guaranteed to be identical under concurrency. Run inside a `transaction()` at a higher isolation level if you need strict consistency.

## Known limitations

| Limitation | Details |
| --- | --- |
| No `distinct` support | Drizzle's relational query API (`db.query[key].findMany`) has no `distinct` option — passing `distinct` to `findMany` throws `NOT_SUPPORTED`. |
| No `mtm` mode | Many-to-many relations are not supported. Model them as two `otm` relations through a join table. |
| No `timeoutMs` in transactions | Drizzle's transaction API doesn't expose a timeout parameter — passing `timeoutMs` throws `NOT_SUPPORTED`. |
| `_every`/`_none` quantifier filters | Supported, but trigger an extra round-trip: a SQL prefetch query finds matching PKs, then the relational query API filters by those PKs. |
| `select` with `true`-marked relation fields | A relation field marked `true` in `select` is only routed to `with` if the adapter can tell it's a relation — via `relationsSchema` (any depth) or the constructor's `relations` (first level only) — otherwise it's treated as a scalar column and the query fails. Without `relationsSchema`, nested relations marked `true` inside a `select` object are always treated as columns (spell out a field or use the `relations` option). |
| `relationsSchema` derivation doesn't cover composite FKs or many-to-many | A relation that joins on more than one column, or goes through a junction table (Drizzle's `through`), falls back to needing a fully manual `relations` entry — same as without `relationsSchema`. |
| MySQL not supported | Only `postgresql`, `sqlite`, and `cockroach` are supported. A `table` built with `mysqlTable()` throws `NOT_SUPPORTED` at construction time (dialect can't be auto-detected, and `dialect` has no `"mysql"` value to pass either). |

## Requirements

- `vsrepo` ^2.3.0
- `drizzle-orm` ^1.0.0-rc.4
- Node.js >= 20
