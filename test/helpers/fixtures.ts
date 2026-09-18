// Fixtures que criam registros diretamente via o client Drizzle (não via o
// adapter), no mesmo espírito de `tests/helpers/fixtures.ts` do
// `VSRepoPrisma7Adapter` — mantém os testes do adapter independentes de si
// mesmos (o setup de um teste nunca depende do `create`/`save` estarem corretos).

import { db } from "../../dev/drizzle/db.js";
import { addressTable, categoryTable, postTable, postTagTable, tagTable, userTable } from "../../dev/drizzle/schema.js";
import { Address, Category, Post, Tag, User } from "../../dev/entities.js";
import { Role } from "../../dev/enum/role.enum.js";

export async function createUser(overrides: Partial<typeof userTable.$inferInsert> = {}): Promise<User> {
    const [row] = await db
        .insert(userTable)
        .values({
            name: "Test User",
            email: `user-${crypto.randomUUID()}@example.com`,
            passwordHash: "hashed-password",
            role: Role.USER,
            ...overrides,
        })
        .returning();

    return { ...row!, posts: [], address: null };
}

export async function createAddress(
    userId: string,
    overrides: Partial<typeof addressTable.$inferInsert> = {},
): Promise<Address> {
    const [row] = await db
        .insert(addressTable)
        .values({
            city: "Recife",
            state: "PE",
            userId,
            ...overrides,
        })
        .returning();

    return row as Address;
}

export async function createCategory(overrides: Partial<typeof categoryTable.$inferInsert> = {}): Promise<Category> {
    const [row] = await db
        .insert(categoryTable)
        .values({
            name: `category-${crypto.randomUUID()}`,
            ...overrides,
        })
        .returning();

    return row!;
}

export async function createPost(
    userId: string,
    overrides: Partial<typeof postTable.$inferInsert> = {},
): Promise<Post> {
    const [row] = await db
        .insert(postTable)
        .values({
            title: `Test Post ${crypto.randomUUID()}`,
            content: "Some content",
            userId,
            ...overrides,
        })
        .returning();

    return { ...row!, category: null, tags: [] } as any;
}

export async function createTag(overrides: Partial<typeof tagTable.$inferInsert> = {}): Promise<Tag> {
    const [row] = await db
        .insert(tagTable)
        .values({
            name: `tag-${crypto.randomUUID()}`,
            ...overrides,
        })
        .returning();

    return row!;
}

export async function linkPostTag(postId: string, tagId: string): Promise<void> {
    await db.insert(postTagTable).values({ postId, tagId });
}
