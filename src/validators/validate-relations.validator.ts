/**
 * Validates the `relations` entry of the `DrizzleAdapter` constructor config
 * (see `AdapterRelations`/`AdapterRelation`), failing fast — with a clear
 * `VSRepoAdapterError` — instead of letting a typo'd/mismatched `fkHere`/
 * `fkThere` blow up later, deep inside a `create`/`update`/`upsert` call.
 *
 * For every configured relation, checks, in order:
 *  - `table` is a Drizzle `Table` instance;
 *  - `mode` is one of `"otm" | "mto" | "oto"`;
 *  - `restriction` is one of `"set" | "add"`;
 *  - the combination of `fkHere`/`fkThere` present matches what `mode` requires
 *    (`otm` -> only `fkThere`; `mto` -> only `fkHere`; `oto` -> exactly one of the two);
 *  - the given `fkHere` is an actual column of *this* adapter's table, and the
 *    given `fkThere` is an actual column of the related `table`;
 *  - the related `table` has a primary key (via `resolveFieldsConfig`, reused
 *    to resolve `relatedPk`, needed to tell "connect/upsert existing" apart
 *    from "create new" on nested writes).
 *
 * Returns a `Map` (rather than the original plain object) so nested-write
 * resolution can do `this.relations.get(key)` without repeated `in`/`hasOwnProperty`
 * checks, and because `Map` insertion order is guaranteed (relevant for
 * `mto`/`oto`-with-`fkHere` relations, which must be resolved *before* the
 * owning record is inserted).
 */

import { getColumns, getTableName, is, Table } from "drizzle-orm";
import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { AdapterRelations } from "../types/adapter-relations.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import { ResolvedRelation } from "../types/resolved-relation.type.js";
import { resolveFieldsConfig } from "../resolvers/fields-config.resolver.js";
import { isPlainObject } from "./is-plain-object.validator.js";

const MODES = new Set(["otm", "mto", "oto"]);
const RESTRICTIONS = new Set(["set", "add"]);

function fail(message: string): never {
    throw new VSRepoAdapterError(message, AdapterErrorCode.INVALID_ADAPTER_CONFIG, null);
}

export function validateRelations<T>(
    table: Table,
    relations: AdapterRelations<T> | undefined,
): Map<string, ResolvedRelation> | undefined {
    if (relations === undefined) return undefined;

    if (!isPlainObject(relations)) {
        fail(
            "Invalid constructor config (relations): expected an object mapping relation field names to their config.",
        );
    }

    const hereColumns = new Set(Object.keys(getColumns(table)));
    const resolved = new Map<string, ResolvedRelation>();

    for (const [key, rawRelation] of Object.entries(relations as PlainObject)) {
        if (rawRelation === undefined) continue;

        if (!isPlainObject(rawRelation)) {
            fail(`Invalid constructor config (relations.${key}): expected an object (an 'AdapterRelation').`);
        }

        const { mode, restriction, table: relatedTable, fkHere, fkThere, nullable } = rawRelation as PlainObject;

        if (!is(relatedTable, Table)) {
            fail(
                `Invalid constructor config (relations.${key}.table): expected a Drizzle 'Table' instance (the ` +
                    "object exported by your schema).",
            );
        }

        if (!MODES.has(mode)) {
            fail(
                `Invalid constructor config (relations.${key}.mode): expected one of 'otm' | 'mto' | 'oto', got ` +
                    `'${String(mode)}'.`,
            );
        }

        if (!RESTRICTIONS.has(restriction)) {
            fail(
                `Invalid constructor config (relations.${key}.restriction): expected one of 'set' | 'add', got ` +
                    `'${String(restriction)}'.`,
            );
        }

        const thereColumns = new Set(Object.keys(getColumns(relatedTable)));

        if (mode === "otm") {
            if (fkHere !== undefined) {
                fail(`Invalid constructor config (relations.${key}): mode 'otm' doesn't accept 'fkHere'.`);
            }
            if (typeof fkThere !== "string" || fkThere.length === 0) {
                fail(
                    `Invalid constructor config (relations.${key}): mode 'otm' requires 'fkThere' (a column of ` +
                        "the related table).",
                );
            }
            if (!thereColumns.has(fkThere)) {
                fail(
                    `Invalid constructor config (relations.${key}.fkThere): '${fkThere}' is not a column of table ` +
                        `'${getTableName(relatedTable)}'.`,
                );
            }
        } else if (mode === "mto") {
            if (fkThere !== undefined) {
                fail(`Invalid constructor config (relations.${key}): mode 'mto' doesn't accept 'fkThere'.`);
            }
            if (typeof fkHere !== "string" || fkHere.length === 0) {
                fail(
                    `Invalid constructor config (relations.${key}): mode 'mto' requires 'fkHere' (a column of ` +
                        "this adapter's table).",
                );
            }
            if (!hereColumns.has(fkHere)) {
                fail(
                    `Invalid constructor config (relations.${key}.fkHere): '${fkHere}' is not a column of table ` +
                        `'${getTableName(table)}'.`,
                );
            }
            if (nullable !== undefined && typeof nullable !== "boolean") {
                fail(`Invalid constructor config (relations.${key}.nullable): expected a boolean.`);
            }
        } else {
            if (nullable !== undefined && typeof nullable !== "boolean") {
                fail(`Invalid constructor config (relations.${key}.nullable): expected a boolean.`);
            }

            const hasHere = fkHere !== undefined;
            const hasThere = fkThere !== undefined;

            if (hasHere === hasThere) {
                fail(
                    `Invalid constructor config (relations.${key}): mode 'oto' requires exactly one of 'fkHere' / ` +
                        "'fkThere'.",
                );
            }

            if (hasHere) {
                if (typeof fkHere !== "string" || !hereColumns.has(fkHere)) {
                    fail(
                        `Invalid constructor config (relations.${key}.fkHere): '${String(fkHere)}' is not a ` +
                            `column of table '${getTableName(table)}'.`,
                    );
                }
            } else {
                if (typeof fkThere !== "string" || !thereColumns.has(fkThere)) {
                    fail(
                        `Invalid constructor config (relations.${key}.fkThere): '${String(fkThere)}' is not a ` +
                            `column of table '${getTableName(relatedTable)}'.`,
                    );
                }
            }
        }

        // Throws INVALID_ADAPTER_CONFIG (reused error code) if the related table has no pk.
        const relatedFieldsConfig = resolveFieldsConfig(relatedTable);

        resolved.set(key, {
            mode,
            restriction,
            table: relatedTable,
            fkHere,
            fkThere,
            nullable,
            relatedPk: relatedFieldsConfig.pk,
        });
    }

    return resolved;
}
