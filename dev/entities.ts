import { InferSelectModel } from "drizzle-orm";
import { addressTable, categoryTable, postTable, userTable } from "./drizzle/schema.js";

export type Category = InferSelectModel<typeof categoryTable>;
export type Post = InferSelectModel<typeof postTable> & { category: Category | null };
export type Address = InferSelectModel<typeof addressTable>;
export type User = InferSelectModel<typeof userTable> & { posts: Post[]; address: Address | null };
