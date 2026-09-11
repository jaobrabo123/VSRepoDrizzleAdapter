import { Table } from "drizzle-orm";
import { KeysOfType, Primitive } from "vsrepo";

/**
 * @publicApi
 */
export type AdapterRelation<T, K> = {
    mode: "otm" | "mto" | "oto";
    restriction: "set" | "add";
    table: Table;
    nullable?: boolean;
    fkHere?: KeysOfType<T, Primitive>;
    fkThere?: KeysOfType<K, Primitive>;
} & (
    | {
          fkHere: KeysOfType<T, Primitive>;
      }
    | {
          fkThere: KeysOfType<K, Primitive>;
      }
);
