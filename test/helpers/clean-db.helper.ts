import { db } from "../../dev/drizzle/db.js";
import { addressTable, categoryTable, postTable, userTable } from "../../dev/drizzle/schema.js";

export default async function () {
    await db.delete(postTable);
    await db.delete(addressTable);
    await db.delete(userTable);
    await db.delete(categoryTable);
}
