import { Table } from "drizzle-orm";
import { KeysOfType, Primitive } from "vsrepo";

/**
 * Configuration for a single relation field in the adapter's write resolution.
 *
 * Unlike Prisma's adapter (which uses `pk` + `connectOrCreate`), the Drizzle adapter
 * works directly with foreign keys (`fkHere`/`fkThere`), since Drizzle has no
 * built-in nested-write API and writes are resolved imperatively.
 *
 * - `mode` — the relation cardinality: `"otm"` (one-to-many), `"mto"` (many-to-one), or `"oto"` (one-to-one).
 * - `restriction` — `"add"` (append only) or `"set"` (replace: also removes items not in the payload).
 * - `table` — the Drizzle `Table` object for the related entity.
 * - `fkHere` — FK column on **this** table (required for `mto`; optional for `oto`).
 * - `fkThere` — FK column on the **related** table (required for `otm`; optional for `oto`).
 * - `nullable` — whether sending `null` is allowed for to-one relations (`oto`/`mto`).
 *
 * @publicApi
 */
export type AdapterRelation<T, K> = {
    restriction: "set" | "add";
    table: Table;
    fkHere?: KeysOfType<T, Primitive>;
    fkThere?: KeysOfType<K, Primitive>;
} & (
    | {
          mode: "otm";
          fkThere: KeysOfType<K, Primitive>;
          fkHere?: never;
      }
    | {
          mode: "mto";
          nullable?: boolean;
          fkHere: KeysOfType<T, Primitive>;
          fkThere?: never;
      }
    | ({
          mode: "oto";
          nullable?: boolean;
      } & (
          { fkHere: KeysOfType<T, Primitive>; fkThere?: never } | { fkThere: KeysOfType<K, Primitive>; fkHere?: never }
      ))
);
