import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { defineRelations } from "drizzle-orm";
import * as schema from "./schema.js";

const relations = defineRelations(schema, r => ({
    productTable: {
        category: r.one.categoryTable({
            from: r.productTable.categoryId,
            to: r.categoryTable.id,
        }),
        reviews: r.many.reviewTable(),
    },
    reviewTable: {
        product: r.one.productTable({
            from: r.reviewTable.productId,
            to: r.productTable.id,
        }),
        user: r.one.userTable({
            from: r.reviewTable.userId,
            to: r.userTable.id,
        }),
    },
    categoryTable: {
        products: r.many.productTable(),
    },
    orderTable: {
        user: r.one.userTable({
            from: r.orderTable.userId,
            to: r.userTable.id,
        }),
    },
    userTable: {
        orders: r.many.orderTable(),
        reviews: r.many.reviewTable(),
    },
}));

export const db = drizzle(process.env.DATABASE_URL!, { relations });
