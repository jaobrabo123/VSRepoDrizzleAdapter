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
 * `run` resolve `{ changes: n }` e `all` resolve um array de linhas, seguindo o
 * contrato documentado em `src/resolvers/raw-result.resolver.ts`. Os dois são
 * `vi.fn()`, então cada teste pode sobrescrever o retorno com
 * `vi.mocked(db.all!).mockResolvedValue(...)`.
 */
export function createFakeSqliteDb(queryKeys: string[] = ["userTable"]): DrizzleDbLike {
    const db = createFakeDb(queryKeys);

    db.run = vi.fn().mockResolvedValue({ changes: 0 });
    db.all = vi.fn().mockResolvedValue([]);
    delete db.execute;

    return db;
}

/**
 * Client falso no formato de um client **PostgreSQL/CockroachDB** real
 * (node-postgres): expõe `execute` — cujo retorno carrega `rows`/`rowCount` —
 * e não expõe `run`/`all`.
 */
export function createFakePostgresDb(queryKeys: string[] = ["userTable"]): DrizzleDbLike {
    const db = createFakeDb(queryKeys);

    db.execute = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    delete db.run;
    delete db.all;

    return db;
}
