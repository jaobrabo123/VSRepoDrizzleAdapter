import { DrizzleDbLike } from "../../src/types/drizzle-db-like.type.js";

/** Cria um client Drizzle falso, com `db.query.userTable` expondo `findFirst`/`findMany`. */
export function createFakeDb(queryKeys: string[] = ["userTable"]): DrizzleDbLike {
    const query: Record<string, { findFirst: () => any; findMany: () => any }> = {};

    for (const key of queryKeys) {
        query[key] = {
            findFirst: vi.fn(),
            findMany: vi.fn(),
        };
    }

    const db: DrizzleDbLike = {
        query,
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        execute: vi.fn(),
        transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)) as any,
    };

    return db;
}

/**
 * Client falso no formato de um client **SQLite** real (`better-sqlite3`,
 * `bun:sqlite`, `libsql`, ...): expõe `run`/`all` e **não** expõe `execute` —
 * é exatamente essa ausência que quebrava o `query()` com SQL cru antes do
 * dispatch por dialect.
 *
 * O shape de `run` **varia por driver**, e o contrato de
 * `src/resolvers/raw-result.resolver.ts` sonda todos eles: `changes`
 * (`better-sqlite3`/`bun:sqlite`/`node:sqlite`/`expo-sqlite`), `rowsAffected`
 * (`libsql`/`op-sqlite`), `meta.changes`/`meta.rows_written` (`d1`). O padrão
 * aqui é o do `better-sqlite3`; sobrescreva o retorno com
 * `vi.mocked(db.run!).mockResolvedValue(...)` para exercitar os outros.
 * `all` resolve um array de linhas. Os dois são `vi.fn()`.
 */
export function createFakeSqliteDb(queryKeys: string[] = ["userTable"]): DrizzleDbLike {
    const db = createFakeDb(queryKeys);

    db.run = vi.fn().mockResolvedValue({ changes: 0 });
    db.all = vi.fn().mockResolvedValue([]);
    delete db.execute;

    return db;
}

/**
 * Reproduz o `RowList` do `postgres-js`: um *array* de linhas que carrega `count`
 * no próprio array, sem `rows` nem `rowCount`. É o que `db.execute(...)` devolve
 * nesse driver — ler `.rows` disso dá `undefined`, e a contagem está em `.count`.
 */
export function asRowList<T>(rows: T[], count: number): T[] & { count: number } {
    return Object.assign(rows, { count });
}

/**
 * Client falso no formato de um client **PostgreSQL/CockroachDB** real
 * (node-postgres): expõe `execute` — cujo retorno carrega `rows`/`rowCount` —
 * e não expõe `run`/`all`.
 *
 * O shape de `execute` também varia por driver (`rowCount` no node-postgres,
 * `count` no `postgres-js`, `affectedRows` no `pglite`,
 * `numberOfRecordsUpdated` no `aws-data-api`, e o array de linhas puro no
 * `bun-sql`); o padrão aqui é o do node-postgres. Sobrescreva o retorno com
 * `vi.mocked(db.execute!).mockResolvedValue(...)` para exercitar os outros —
 * veja o helper `asRowList` para o caso do `postgres-js`.
 */
export function createFakePostgresDb(queryKeys: string[] = ["userTable"]): DrizzleDbLike {
    const db = createFakeDb(queryKeys);

    db.execute = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    delete db.run;
    delete db.all;

    return db;
}
