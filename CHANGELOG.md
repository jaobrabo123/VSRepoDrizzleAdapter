# Changelog

All notable changes to this project will be documented in this file.

(Português) Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

---

## [1.0.0-alpha.4] - 2026-09-24

### Fixed
- Fixed TypeScript type errors in `src/parsers/sql-where.parser.ts` (surfacing under stricter type-checking): `not(...)` results are now properly narrowed with non-null assertions before being appended to the condition part lists in `buildFieldOperators` (the `_not` field operator), in `buildRelationCondition` (the `_none`/`_every` correlated-existence paths) and in `parseWhere`'s generic negation ahead of `buildCondition`

### Documentation
- `DrizzleAdapterConfig` (in `src/types/drizzle-adapter-config.type.ts`) and `AdapterRelation` (in `src/types/relation.type.ts`) JSDoc restructure: the property descriptions that previously lived in a single comment block above the type were moved into per-property `@property` docblocks, so each member (`table`, `dialect`, `queryKey`, `relations`, `relationsSchema`, `logLevel`, `logSlowThresholdMs`; and `restriction`, `mode`, `table`, `fkHere`, `fkThere`, `nullable`, `through`, `throughFkHere`, `throughFkThere`) is now documented individually in the editor
- Simplified the "return order" note for `createManyReturning`/`updateManyReturning` in `README.md`/`README.pt-BR.md`

---

## [1.0.0-alpha.4] - 2026-09-24 (Português)

### Corrigido
- Corrigidos erros de tipagem do TypeScript em `src/parsers/sql-where.parser.ts` (aparecendo sob checagem de tipos mais estrita): os resultados de `not(...)` agora são corretamente estreitados com non-null assertions antes de serem adicionados às listas de condições em `buildFieldOperators` (o operador de campo `_not`), em `buildRelationCondition` (nos caminhos de existência correlacionada de `_none`/`_every`) e na negação genérica do `parseWhere` antes do `buildCondition`

### Documentação
- Reestruturação dos JSDocs de `DrizzleAdapterConfig` (em `src/types/drizzle-adapter-config.type.ts`) e de `AdapterRelation` (em `src/types/relation.type.ts`): as descrições de propriedade que antes viviam num único bloco de comentário acima do type foram movidas pra docblocks `@property` por propriedade, então cada membro (`table`, `dialect`, `queryKey`, `relations`, `relationsSchema`, `logLevel`, `logSlowThresholdMs`; e `restriction`, `mode`, `table`, `fkHere`, `fkThere`, `nullable`, `through`, `throughFkHere`, `throughFkThere`) agora é documentado individualmente no editor
- Simplificada a nota sobre "ordem de retorno" de `createManyReturning`/`updateManyReturning` nos `README.md`/`README.pt-BR.md`

---

## [1.0.0-alpha.3] - 2026-09-19

### Added
- Internal `VSLogger` (from `vsrepo`) integration, mirroring how `VSRepoPrisma7Adapter`/`VSRepository` already use it:
  - New `logLevel`/`logSlowThresholdMs` constructor config fields. `logLevel` defaults to `VSLogLevel.WARN`; `logSlowThresholdMs` accepts a `number` (ms) **or** a `boolean` — `false` disables slow-operation warnings entirely, `true`/omitted falls back to the default `300`ms
  - Every public method (`findOne`/`findMany`/`create`/`update`/`save`/`upsert`/`delete`/`*Many*`/`merge`/`count`/`exists`/`sum`/`average`/`min`/`max`/`increment`/`decrement`/`multiply`/`divide`/`runInTransaction`/`query`) now logs a `DEBUG` line with the resolved Drizzle arg/condition, plus start/end perf timing (escalated to `WARN` when it exceeds `logSlowThresholdMs`)
  - `create`/`update`/`save`/`upsert` additionally log a short, one-line-per-relation `DEBUG` summary while resolving `fkHere`/`fkThere` relation fields (mode, counts of inserted/linked/updated/removed items, and which relations are being resolved) — enough to follow what's happening with `relations` without flooding the log per-row
  - `logLevel`/`logSlowThresholdMs` are validated at construction time (code `INVALID_ADAPTER_CONFIG` on an invalid value)
  - New "Logging" README section (English/pt-BR)
- `DrizzleAdapter` now implements the new optional `getPkName()` adapter method

### Changed
- `.github/workflows/publish.yml`: corrected the `DATABASE_URL` format used by the Postgres service, and fixed the workflow to apply the correct tag at publish/stage time
- `vsrepo` peer dependency bumped to `^2.5.0`

### Fixed
- `runTransactional`: the transaction client (`tx`) is now correctly injected into every query that runs inside it — some relation-write queries were previously reaching the client passed to the top-level method instead of the active `tx`, which could let a relation write run outside the intended transaction
- `sql-where.parser.ts`: `_some`/`_every`/`_none` quantifier filters on to-many relations now also work for `mtm` (many-to-many) relations — previously they threw `INVALID_DATA` ("can only be used on a to-many ('otm') relation"), so dynamic methods like `findByTagsEveryNameStartsWith` crashed at runtime. `mtm` filters are translated into `EXISTS`/`NOT EXISTS` correlated subqueries through the join `through` table (correlating `through.fkHere` to this table's pk and `through.fkThere` to the related table's pk)

### Tests
- Added tests covering `logLevel`/`logSlowThresholdMs` construction-time validation (valid/invalid `VSLogLevel`, numeric/boolean `logSlowThresholdMs`, `<= 0` and non-number/non-boolean rejection)
- Added `sql-where.parser.spec.ts` tests covering `mtm` relations with `_some`/`_every`/`_none` (correlated `EXISTS`-through-`through` SQL, vacuous `_every`, mode guards for `_with`/`_without` and to-one relations, `otm` regression)

---

## [1.0.0-alpha.3] - 2026-09-19 (Português)

### Adicionado
- Integração com o `VSLogger` interno (de `vsrepo`), espelhando como o `VSRepoPrisma7Adapter`/`VSRepository` já o usam:
  - Novos campos `logLevel`/`logSlowThresholdMs` na config do construtor. `logLevel` tem default `VSLogLevel.WARN`; `logSlowThresholdMs` aceita um `number` (ms) **ou** um `boolean` — `false` desativa os warnings de operação lenta por completo, `true`/omitido cai pro default de `300`ms
  - Todo método público (`findOne`/`findMany`/`create`/`update`/`save`/`upsert`/`delete`/`*Many*`/`merge`/`count`/`exists`/`sum`/`average`/`min`/`max`/`increment`/`decrement`/`multiply`/`divide`/`runInTransaction`/`query`) agora loga uma linha `DEBUG` com o arg/condition resolvido do Drizzle, além do timing de início/fim (escalado pra `WARN` quando excede o `logSlowThresholdMs`)
  - `create`/`update`/`save`/`upsert` também logam um resumo `DEBUG` curto, de uma linha por relation, ao resolver os campos de relation `fkHere`/`fkThere` (modo, contagens de itens inseridos/linkados/atualizados/removidos, e quais relations estão sendo resolvidas) — o suficiente pra acompanhar o que está acontecendo com `relations` sem inundar o log por registro
  - `logLevel`/`logSlowThresholdMs` são validados no momento da construção (code `INVALID_ADAPTER_CONFIG` pra um valor inválido)
  - Nova seção "Logging" no README (inglês/pt-BR)
- `DrizzleAdapter` agora implementa o novo método opcional `getPkName()` dos adapters

### Alterado
- `.github/workflows/publish.yml`: corrigido o formato da `DATABASE_URL` usada pelo serviço do Postgres, e corrigido o workflow pra aplicar a tag correta no momento do publish/stage
- Peer dependency `vsrepo` elevada pra `^2.5.0`

### Corrigido
- `runTransactional`: o client de transação (`tx`) agora é corretamente injetado em toda query que roda dentro dele — algumas queries de escrita de relations antes chegavam ao client passado pro método de nível superior em vez do `tx` ativo, o que podia deixar uma escrita de relation rodar fora da transação pretendida
- `sql-where.parser.ts`: filtros quantificadores `_some`/`_every`/`_none` em relações to-many agora também funcionam para relações `mtm` (many-to-many) — antes lançavam `INVALID_DATA` ("can only be used on a to-many ('otm') relation"), então métodos dinâmicos como `findByTagsEveryNameStartsWith` quebravam em runtime. Filtros `mtm` são traduzidos em subqueries correlacionadas `EXISTS`/`NOT EXISTS` através da tabela de junção `through` (correlacionando `through.fkHere` à pk da tabela atual e `through.fkThere` à pk da tabela relacionada)

### Testes
- Adicionados testes cobrindo a validação em tempo de construção de `logLevel`/`logSlowThresholdMs` (`VSLogLevel` válido/inválido, `logSlowThresholdMs` numérico/booleano, rejeição de `<= 0` e de valores que não são number nem boolean)
- Adicionados testes de `sql-where.parser.spec.ts` cobrindo relações `mtm` com `_some`/`_every`/`_none` (SQL de `EXISTS` correlacionado via `through`, `_every` vazio/vacuidade, guards de modo pra `_with`/`_without` e relações to-one, regressão de `otm`)

---

## [1.0.0-alpha.2] - 2026-09-17

### Added
- `mtm` (many-to-many) relation support: `AdapterRelation`/`ResolvedRelation`'s `mode` now accepts `"mtm"`, resolved via a join/pivot table (`through`/`throughFkHere`/`throughFkThere`) instead of a direct FK
  - Writes (`create`/`update`/`upsert`/`save`): creates/upserts related rows and links them via `through`, deduplicating existing links; `restriction: "set"` cleanup only removes the join-table row, never the related entity itself
  - When `relationsSchema` (Drizzle's `defineRelations()`) is configured, `mode: "mtm"` and its `through`/`throughFkHere`/`throughFkThere` are derived automatically from a `.through(...)` join, same as the existing derivation for `otm`/`mto`/`oto`
  - `dev/drizzle/schema.ts`/`db.ts` gained a `tagTable`/`postTagTable` example (`postTable.tags`, many-to-many) demonstrating the new mode end-to-end
- `findMany`'s `distinct` option is now supported for the `postgresql` dialect, via `db.selectDistinctOn(...)` — previously it always threw `NOT_SUPPORTED` regardless of dialect
  - Implemented through the same pk-prefetch strategy already used for `_every`/`_none`: a `db.selectDistinctOn(...)` query (core query builder) finds the deduplicated rows' PKs, then the relational query API re-fetches them by PK, so `select`/`relations` still apply normally
  - When both `distinct` and `order` are given, `order` also decides which row wins each `distinct` group (not just the final result order) — mirrors Postgres' `SELECT DISTINCT ON (...) ... ORDER BY ...` semantics
  - `pagination` is applied after deduplication, on the distinct set
  - `sqlite`/`cockroach` still throw `NOT_SUPPORTED` for `distinct`, since `selectDistinctOn` is Postgres-specific
  - New `src/parsers/distinct-on.parser.ts` (`parseDistinctOn`) builds the `selectDistinctOn` column list and its required leading `ORDER BY`; throws `VSRepoAdapterError` (code `INVALID_DATA`) for an empty `distinct` array, or (code `FIELD_NOT_FOUND`) for an unknown field
- GitHub Actions publish workflow (`.github/workflows/publish.yml`) added; CI actions bumped from v4 to v6 and `bun test` corrected to `bun run test` in `publish.yml`

### Changed
- `vsrepo` peer dependency bumped to `^2.4.0` (now required)
- Performance improvements across `relations-writes.resolver`'s resolution logic

### Fixed
- `oto` relations configured with `fkHere` now resolve the correct FK column on writes
- Corrected `mtm`/`otm` behavior in relation-writes
- `mergeEntities` — used by the `upsert` path — now also merges `mtm` relations

### Documentation
- READMEs (English/pt-BR): removed the "`mtm` not supported" notice, documented `mode: "mtm"` and the new `through`/`throughFkHere`/`throughFkThere` config, and updated the derivation/restriction/write-resolution tables accordingly
- READMEs (English/pt-BR): added a "`findMany` `distinct` support (`postgresql` only)" section, and updated the "Known limitations" table entry for `distinct` accordingly

---

## [1.0.0-alpha.2] - 2026-09-17 (Português)

### Adicionado
- Suporte à relation `mtm` (many-to-many): `mode` de `AdapterRelation`/`ResolvedRelation` agora aceita `"mtm"`, resolvida via uma tabela de junção/pivot (`through`/`throughFkHere`/`throughFkThere`) em vez de uma FK direta
  - Escritas (`create`/`update`/`upsert`/`save`): cria/faz upsert das linhas relacionadas e as vincula via `through`, deduplicando vínculos já existentes; a limpeza do `restriction: "set"` só remove a linha da tabela de junção, nunca a entidade relacionada em si
  - Com `relationsSchema` (`defineRelations()` do Drizzle) configurado, `mode: "mtm"` e seu `through`/`throughFkHere`/`throughFkThere` são derivados automaticamente de um join `.through(...)`, igual à derivação já existente pra `otm`/`mto`/`oto`
  - `dev/drizzle/schema.ts`/`db.ts` ganharam um exemplo `tagTable`/`postTagTable` (`postTable.tags`, many-to-many) demonstrando o novo modo de ponta a ponta
- A option `distinct` do `findMany` agora é suportada pro dialeto `postgresql`, via `db.selectDistinctOn(...)` — antes sempre lançava `NOT_SUPPORTED`, independente do dialeto
  - Implementado com a mesma estratégia de pré-busca de PKs já usada pra `_every`/`_none`: uma query `db.selectDistinctOn(...)` (query builder core) busca as PKs das linhas já deduplicadas, e a API de query relacional re-busca essas linhas por PK, então `select`/`relations` continuam funcionando normalmente
  - Quando `distinct` e `order` são informados juntos, `order` também decide qual registro "vence" em cada grupo do `distinct` (não só a ordem final do resultado) — espelha a semântica do `SELECT DISTINCT ON (...) ... ORDER BY ...` do Postgres
  - `pagination` é aplicada depois da deduplicação, sobre o conjunto já distinto
  - `sqlite`/`cockroach` continuam lançando `NOT_SUPPORTED` pro `distinct`, já que `selectDistinctOn` é específico do Postgres
  - Novo `src/parsers/distinct-on.parser.ts` (`parseDistinctOn`) monta a lista de colunas do `selectDistinctOn` e o `ORDER BY` inicial obrigatório; lança `VSRepoAdapterError` (code `INVALID_DATA`) pra um array `distinct` vazio, ou (code `FIELD_NOT_FOUND`) pra um campo desconhecido
- Adicionado o workflow de publish do GitHub Actions (`.github/workflows/publish.yml`); ações da CI atualizadas de v4 pra v6 e `bun test` corrigido pra `bun run test` no `publish.yml`

### Alterado
- Peer dependency `vsrepo` elevada pra `^2.4.0` (agora requerida)
- Melhorias de performance na lógica de resolução do `relations-writes.resolver`

### Corrigido
- Relations `oto` configuradas com `fkHere` agora resolvem a coluna FK correta nas escritas
- Corrigido o comportamento de `mtm`/`otm` no relation-writes
- `mergeEntities` — usado no caminho do `upsert` — agora também faz merge de relações `mtm`

### Documentação
- READMEs (inglês/pt-BR): removido o aviso de "`mtm` não suportado", documentado o `mode: "mtm"` e a nova config `through`/`throughFkHere`/`throughFkThere`, e atualizadas as tabelas de derivação/restriction/resolução de escrita de acordo
- READMEs (inglês/pt-BR): adicionada uma seção "Suporte a `distinct` no `findMany` (só `postgresql`)", e atualizada a entrada de `distinct` na tabela de "Limitações conhecidas" de acordo

---

## [1.0.0-alpha.1] - 2026-09-16

### Fixed
- `deleteManyReturning` now correctly injects the primary key into the pre-fetch result before executing the delete — previously, records fetched before deletion were missing their PK in the returned value
- Fixed typo `columnsWithoudPk` → `columnsWithoutPk`

### Added
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) added to the repository

### Documentation
- Updated documentation for `deleteManyReturning` to reflect the pre-fetch + delete behavior and the PK injection fix
- General documentation improvements across READMEs and JSDoc

---

## [1.0.0-alpha.1] - 2026-09-16 (Português)

### Corrigido
- `deleteManyReturning` agora injeta corretamente a chave primária no resultado da pré-busca antes de executar o delete — antes, os registros buscados antes da deleção estavam sem a PK no valor retornado
- Corrigido typo `columnsWithoudPk` → `columnsWithoutPk`

### Adicionado
- Workflow de CI do GitHub Actions (`.github/workflows/ci.yml`) adicionado ao repositório

### Documentação
- Atualizada a documentação do `deleteManyReturning` para refletir o comportamento de pré-busca + delete e a correção da injeção da PK
- Melhorias gerais na documentação dos READMEs e JSDoc

---

## [1.0.0-alpha] - 2026-09-15

### Added
- `nullable` is no longer inferred automatically — must now be declared explicitly in the adapter config
- `dialect` can now be inferred automatically from the Drizzle database instance or overridden explicitly via config
- Improved relation inference via `relationsSchema`

### Fixed
- Removed `selectDistinct` from `DrizzleDbLike` — it was incorrectly included in the interface and is not part of the required contract

### Documentation
- Corrected documentation and JSDoc entries about how `dialect` is determined
- Corrected explanation of how `nullable` is handled in the adapter config

---

## [1.0.0-alpha] - 2026-09-15 (Português)

### Adicionado
- `nullable` não é mais inferido automaticamente — agora deve ser declarado explicitamente na config do adapter
- `dialect` agora pode ser inferido automaticamente a partir da instância do banco do Drizzle ou sobrescrito explicitamente via config
- Melhoria no inferimento de relations via `relationsSchema`

### Corrigido
- Removido `selectDistinct` do `DrizzleDbLike` — estava incluído incorretamente na interface e não faz parte do contrato necessário

### Documentação
- Corrigidas entradas de documentação e JSDoc sobre como o `dialect` é determinado
- Corrigida a explicação de como o `nullable` é tratado na config do adapter

---

## [0.1.3] - 2026-09-14

### Added
- Full documentation added to READMEs and JSDoc for all public-facing APIs of the adapter

---

## [0.1.3] - 2026-09-14 (Português)

### Adicionado
- Documentação completa adicionada nos READMEs e JSDoc para todas as APIs públicas do adapter

---

## [0.1.2] - 2026-09-14

### Added
- **`AdapterErrorCode.TRANSACTION_ROLLED_BACK`** — the adapter now throws `VSRepoAdapterError` with this code when a transaction is intentionally rolled back via `tx.rollback()`, giving callers a clear, typed signal that the transaction did not commit
- `*Returning` methods now correctly apply the `readArgs` from the call's `options` — previously, the read performed before the write operation ignored the options passed by the caller
- Base for the adapter's test suite, covering the main methods

### Fixed
- Fixed typing of `AdapterRelation`
- Fixed `deleteManyReturning` to correctly fetch the records **before** deleting them, so the deleted data can be returned to the caller
- Fixed handling of to-one relations — previously, single-object relations were not being resolved correctly

---

## [0.1.2] - 2026-09-14 (Português)

### Adicionado
- **`AdapterErrorCode.TRANSACTION_ROLLED_BACK`** — o adapter agora lança `VSRepoAdapterError` com esse código quando uma transação é revertida intencionalmente via `tx.rollback()`, dando ao chamador um sinal claro e tipado de que a transação não foi commitada
- Métodos `*Returning` agora aplicam corretamente os `readArgs` das `options` da chamada — antes, a leitura realizada antes da operação de escrita ignorava as options passadas pelo chamador
- Base para a suíte de testes do adapter, cobrindo os principais métodos

### Corrigido
- Corrigida a tipagem do `AdapterRelation`
- Corrigido o `deleteManyReturning` para buscar os registros **antes** de apagá-los, de forma que os dados deletados possam ser retornados ao chamador
- Corrigido o tratamento de relations to-one — antes, relations de objeto único não estavam sendo resolvidas corretamente

---

## [0.1.1] - 2026-09-13

### Added
- First tests for the adapter

### Changed
- Performance improvements across internal resolution logic

---

## [0.1.1] - 2026-09-13 (Português)

### Adicionado
- Primeiros testes para o adapter

### Alterado
- Melhorias de performance na lógica interna de resolução

---

## [0.1.0] - 2026-09-12

### Added
- Full implementation of all remaining adapter methods (write methods, upsert, etc.)
- Improved typing of `AdapterRelation`
- `relations` support in the adapter constructor — relations are now declared at build time and used across all methods
- `DrizzleOrmTypes` utility type — a helper type to collect the Drizzle-specific types required by the adapter (db instance, transaction, etc.)
- Drizzle error mapper — transforms Drizzle/database errors into `VSRepoAdapterError` with the appropriate `AdapterErrorCode`
- Prototype support for `runInTransaction` and raw `query`
- Validation in the `DrizzleAdapter` constructor — invalid configs are caught early with a descriptive error
- Implementation of `findOne`, `findOneOrThrow` and `findMany` — including parsers that convert `AdapterMethodOptions` into valid Drizzle query syntax
- Placeholder parameterization fixed in `resolveRawSql`
- `vsrepo` added as a peer dependency

### Fixed
- Adapter now only supports `postgres`, `cockroach` and `sqlite` dialects — `mysql` was incorrectly listed as supported and has been removed
- Fixed `relations writes` to not delete relations that were just inserted

---

## [0.1.0] - 2026-09-12 (Português)

### Adicionado
- Implementação completa de todos os métodos restantes do adapter (métodos de escrita, upsert, etc.)
- Tipagem melhorada do `AdapterRelation`
- Suporte a `relations` no constructor do adapter — as relations agora são declaradas em tempo de build e utilizadas em todos os métodos
- Tipo utilitário `DrizzleOrmTypes` — um helper para coletar os tipos específicos do Drizzle necessários pelo adapter (instância do db, transação, etc.)
- Mapper de erros do Drizzle — transforma erros do Drizzle/banco de dados em `VSRepoAdapterError` com o `AdapterErrorCode` apropriado
- Suporte protótipo para `runInTransaction` e `query` raw
- Validação no constructor do `DrizzleAdapter` — configs inválidas são detectadas cedo com uma mensagem de erro descritiva
- Implementação de `findOne`, `findOneOrThrow` e `findMany` — incluindo parsers que convertem `AdapterMethodOptions` em uma sintaxe de query válida para o Drizzle
- Corrigida a parametrização dos placeholders no `resolveRawSql`
- `vsrepo` adicionado como peer dependency

### Corrigido
- O adapter agora suporta apenas os dialects `postgres`, `cockroach` e `sqlite` — `mysql` estava incorretamente listado como suportado e foi removido
- Corrigido o `relations writes` para não apagar as relations que acabaram de ser inseridas
