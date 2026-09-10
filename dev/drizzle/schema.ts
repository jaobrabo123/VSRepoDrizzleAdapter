import {
    pgEnum,
    pgTable,
    uuid,
    varchar,
    timestamp,
    numeric,
    integer,
    boolean,
    uniqueIndex,
    smallint,
} from "drizzle-orm/pg-core";
import { Role } from "../enum/role.enum.js";
import { OrderStatus } from "../enum/order-status.enum.js";

export const timestamps = {
    createdAt: timestamp({ precision: 6, withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 6, withTimezone: true }).defaultNow().notNull(),
};

export const roleEnum = pgEnum("UserRole", Role);
export const orderStatusEnum = pgEnum("OrderStatus", OrderStatus);

export const userTable = pgTable("User", {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 150 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    passwordHash: varchar({ length: 255 }).notNull(),
    role: roleEnum().notNull(),
    ...timestamps,
});

export const categoryTable = pgTable("Category", {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 100 }).notNull().unique(),
    createdAt: timestamps.createdAt,
});

export const productTable = pgTable("Product", {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 150 }).notNull(),
    description: varchar({ length: 3000 }).notNull(),
    price: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
    stock: integer().notNull(),
    active: boolean().notNull(),
    categoryId: uuid().references(() => categoryTable.id),
    ...timestamps,
});

export const orderTable = pgTable("Order", {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
        .notNull()
        .references(() => userTable.id),
    status: orderStatusEnum().notNull(),
    total: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
    ...timestamps,
});

export const orderItemTable = pgTable(
    "OrderItem",
    {
        id: uuid().primaryKey().defaultRandom(),
        orderId: uuid()
            .notNull()
            .references(() => orderTable.id),
        productId: uuid()
            .notNull()
            .references(() => productTable.id),
        quantity: integer().notNull(),
        unityPrice: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
        subtotal: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
    },
    t => [uniqueIndex().on(t.orderId, t.productId)],
);

export const reviewTable = pgTable(
    "Review",
    {
        id: uuid().primaryKey().defaultRandom(),
        userId: uuid()
            .notNull()
            .references(() => userTable.id),
        productId: uuid()
            .notNull()
            .references(() => productTable.id),
        rating: smallint().notNull(),
        comment: varchar({ length: 500 }),
        ...timestamps,
    },
    t => [uniqueIndex().on(t.userId, t.productId)],
);
