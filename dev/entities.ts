import { InferSelectModel } from "drizzle-orm";
import { addressTable, postTable, userTable } from "./drizzle/schema.js";

export type Post = InferSelectModel<typeof postTable>;
export type Address = InferSelectModel<typeof addressTable>;
export type User = InferSelectModel<typeof userTable> & { posts: Post[]; address: Address | null };
