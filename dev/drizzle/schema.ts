import { pgEnum, pgTable, uuid, varchar, timestamp, char } from "drizzle-orm/pg-core";
import { Role } from "../enum/role.enum.js";

export const timestamps = {
    createdAt: timestamp({ precision: 6, withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 6, withTimezone: true }).defaultNow().notNull(),
};

export const roleEnum = pgEnum("UserRole", Role);

export const userTable = pgTable("User", {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 150 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    passwordHash: varchar({ length: 255 }).notNull(),
    role: roleEnum().notNull().default(Role.USER),
    ...timestamps,
});

export const addressTable = pgTable("Address", {
    id: uuid().primaryKey().defaultRandom(),
    city: varchar({ length: 150 }).notNull(),
    state: char({ length: 2 }).notNull(),
    userId: uuid()
        .notNull()
        .unique()
        .references(() => userTable.id, { onDelete: "cascade" }),
    ...timestamps,
});

export const categoryTable = pgTable("Category", {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 100 }).notNull().unique(),
    createdAt: timestamps.createdAt,
});

export const postTable = pgTable("Post", {
    id: uuid().primaryKey().defaultRandom(),
    title: varchar({ length: 100 }).notNull(),
    content: varchar({ length: 1000 }).notNull(),
    categoryId: uuid().references(() => categoryTable.id, { onDelete: "set null" }),
    userId: uuid()
        .notNull()
        .references(() => userTable.id, { onDelete: "cascade" }),
    ...timestamps,
});
