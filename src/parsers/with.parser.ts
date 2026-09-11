import { VSRepoRelations } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

/**
 * Converts a `VSRepoRelations<T>` into Drizzle's `with` relational query config.
 *
 * A relation loaded as `true` stays `true`. A relation loaded together with
 * its own nested relations (`VSRepoRelations` again) is turned into
 * `{ with: parseWith(...) }`, matching Drizzle's own nested `with` shape —
 * each level is a full query config (`{ columns?, where?, with?, ... }`),
 * not a plain recursive include map.
 */
export function parseWith<T>(relations: VSRepoRelations<T>): PlainObject {
    const result: PlainObject = {};

    for (const [key, value] of Object.entries(relations)) {
        if (value === undefined) continue;

        result[key] = isPlainObject(value) ? { with: parseWith(value) } : value;
    }

    return result;
}
