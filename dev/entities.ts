import { InferSelectModel } from "drizzle-orm";
import { addressTable, categoryTable, postTable, tagTable, userTable } from "./drizzle/schema.js";

export type Category = InferSelectModel<typeof categoryTable>;
export type Tag = InferSelectModel<typeof tagTable>;
export type Post = InferSelectModel<typeof postTable> & { category: Category | null; tags: Tag[]; user: User };
export type Address = InferSelectModel<typeof addressTable> & { user: User };
export type User = InferSelectModel<typeof userTable> & { posts: Post[]; address: Address | null };
