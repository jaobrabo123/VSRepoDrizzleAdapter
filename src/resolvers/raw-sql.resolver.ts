import { SQL, StringChunk, Param, type SQLChunk } from "drizzle-orm";
import { SupportedDialects } from "../types/supported-dialects.type.js";

const PLACEHOLDER_PATTERNS: Record<SupportedDialects, RegExp> = {
    postgresql: /\$(\d+)/g,
    cockroach: /\$(\d+)/g,
    mysql: /\?/g,
    singlestore: /\?/g,
    sqlite: /\?/g,
    mssql: /@p(\d+)/gi,
};

/**
 * Dialects whose placeholders carry an explicit index (e.g. `$1`, `@P1`).
 * For these, the same index can appear more than once in the query
 * (e.g. `$1 ... $1`) and must resolve to the same argument every time.
 * `?`-style placeholders have no index, so they stay strictly positional.
 */
const NUMBERED_DIALECTS = new Set<SupportedDialects>(["postgresql", "cockroach", "mssql"]);

export function resolveRawSql(dialect: SupportedDialects, query: string, args: unknown[] = []): SQL {
    const pattern = PLACEHOLDER_PATTERNS[dialect];
    const isNumbered = NUMBERED_DIALECTS.has(dialect);

    const chunks: SQLChunk[] = [];
    let lastIndex = 0;
    let positionalIndex = 0;

    for (const match of query.matchAll(pattern)) {
        chunks.push(new StringChunk(query.slice(lastIndex, match.index)));

        const argIndex = isNumbered ? Number(match[1]) - 1 : positionalIndex++;
        chunks.push(new Param(args[argIndex]));

        lastIndex = match.index + match[0].length;
    }

    chunks.push(new StringChunk(query.slice(lastIndex)));

    return new SQL(chunks);
}
