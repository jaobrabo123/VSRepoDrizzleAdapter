import { Table } from "drizzle-orm";
import { KeysOfType, Primitive } from "vsrepo";

/**
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
      }
    | ({
          mode: "oto";
      } & (
          { fkHere: KeysOfType<T, Primitive>; fkThere?: never } | { fkThere: KeysOfType<K, Primitive>; fkHere?: never }
      ))
);
