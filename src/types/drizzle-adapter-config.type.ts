import { Table } from "drizzle-orm";
import { DrizzleDbLike } from "./drizzle-db-like.type.js";
import { SupportedDialects } from "./supported-dialects.type.js";
import { AdapterRelations } from "./adapter-relations.type.js";

/**
 * Configuration object for the {@link DrizzleAdapter} constructor.
 *
 * @property table - The Drizzle `Table` object representing the entity's database table. The primary key is auto-detected from this table's column config.
 * @property dialect - The SQL dialect to use. Defaults to `"postgresql"`. Affects placeholder syntax, case-insensitive search behavior, and raw result interpretation.
 * @property queryKey - The key in `db.query` that maps to this table's relational query builder (e.g. `"userTable"` for `db.query.userTable`).
 * @property relations - Optional relation write config. Describes how relation fields in write payloads (`create`/`update`/`save`/`upsert`/`merge`) should be resolved imperatively.
 *
 * @publicApi
 */
export type DrizzleAdapterConfig<T, K extends DrizzleDbLike = DrizzleDbLike> = {
    table: Table;
    dialect?: SupportedDialects;
    queryKey: keyof K["query"];
    relations?: AdapterRelations<T>;
};
