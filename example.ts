import { InferSelectModel } from "drizzle-orm";
import { orderTable, userTable } from "./dev/drizzle/schema.js";
import { TransactionIsolationLevel, VSRepository } from "vsrepo";
import { db } from "./dev/drizzle/db.js";
import { PgAsyncTransaction } from "drizzle-orm/pg-core";
import { DrizzleAdapter } from "./src/drizzle.adapter.js";
import { DrizzleOrmTypes } from "./src/types/drizzle-orm-types.type.js";

type Order = InferSelectModel<typeof orderTable>;
type User = InferSelectModel<typeof userTable> & { orders: Order[] };

class UserRepository extends VSRepository<User, string, DrizzleOrmTypes<typeof db>> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, { table: userTable, queryKey: "userTable" }),
            pkName: "id",
        });
    }
}

const userRepository = new UserRepository();

const result = await userRepository.query<User>('SELECT * FROM "User" WHERE "id" = $1', {
    args: [crypto.randomUUID()],
    singleResult: true,
});
console.log(result);
