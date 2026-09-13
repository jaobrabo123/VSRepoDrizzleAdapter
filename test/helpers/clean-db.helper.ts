import { db } from "../../dev/drizzle/db.js";
import { categoryTable, userTable } from "../../dev/drizzle/schema.js";

export default async function () {
    await db.delete(userTable);
    await db.delete(categoryTable);
}
