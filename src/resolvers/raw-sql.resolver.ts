import { SQL, StringChunk, Param, type SQLChunk } from "drizzle-orm";
import { SupportedDialects } from "../types/supported-dialects.type.js";

const PLACEHOLDER_PATTERNS: Record<SupportedDialects, RegExp> = {
    postgresql: /\$\d+/g,
    cockroach: /\$\d+/g,
    mysql: /\?/g,
    singlestore: /\?/g,
    sqlite: /\?/g,
    mssql: /@p\d+/g,
};

export function resolveRawSql(dialect: SupportedDialects, query: string, args: unknown[] = []): SQL {
    const pattern = PLACEHOLDER_PATTERNS[dialect];
    const parts = query.split(pattern);
    const chunks: SQLChunk[] = [new StringChunk(parts[0]!)];

    for (let i = 1; i < parts.length; i++) {
        chunks.push(new Param(args[i - 1]));
        chunks.push(new StringChunk(parts[i]!));
    }

    return new SQL(chunks);
}
