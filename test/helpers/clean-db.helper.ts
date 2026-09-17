import { db } from "../../dev/drizzle/db.js";
import { addressTable, categoryTable, postTable, postTagTable, tagTable, userTable } from "../../dev/drizzle/schema.js";

export default async function () {
    await db.delete(postTagTable);
    await db.delete(postTable);
    await db.delete(addressTable);
    await db.delete(userTable);
    await db.delete(categoryTable);
    await db.delete(tagTable);
}
