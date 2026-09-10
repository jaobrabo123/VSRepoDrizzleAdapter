import { Table } from "drizzle-orm";
import { DrizzleDbLike } from "./drizzle-db-like.type.js";
import { SupportedDialects } from "./supported-dialects.type.js";

/**
 * @publicApi
 */
export type DrizzleAdapterConfig = {
    table: Table;
    db: DrizzleDbLike;
    dialect?: SupportedDialects;
};
