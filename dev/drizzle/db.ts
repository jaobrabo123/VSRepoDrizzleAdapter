import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { defineRelations } from "drizzle-orm";
import * as schema from "./schema.js";

export const relations = defineRelations(schema, r => ({
    addressTable: {
        user: r.one.userTable({
            from: r.addressTable.userId,
            to: r.userTable.id,
        }),
    },
    postTable: {
        category: r.one.categoryTable({
            from: r.postTable.categoryId,
            to: r.categoryTable.id,
        }),
        user: r.one.userTable({
            from: r.postTable.userId,
            to: r.userTable.id,
        }),
    },
    categoryTable: {
        posts: r.many.postTable(),
    },
    userTable: {
        address: r.one.addressTable(),
        posts: r.many.postTable(),
    },
}));

export const db = drizzle(process.env.DATABASE_URL!, { relations, logger: false });
