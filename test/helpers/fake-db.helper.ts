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
