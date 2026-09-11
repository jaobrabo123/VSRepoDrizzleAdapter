import { InferSelectModel, is, Table } from "drizzle-orm";
import { orderTable, userTable } from "./dev/drizzle/schema.js";
import { DynamicMethod, QueryMethod, TransactionIsolationLevel, VSRepository } from "vsrepo";
import { db } from "./dev/drizzle/db.js";
import { PgAsyncTransaction } from "drizzle-orm/pg-core";
import { DrizzleAdapter } from "./src/drizzle.adapter.js";
import { DrizzleOrmTypes } from "./src/types/drizzle-orm-types.type.js";
import { Role } from "./dev/enum/role.enum.js";

type Order = InferSelectModel<typeof orderTable>;
type User = InferSelectModel<typeof userTable> & { orders: Order[] };

class UserRepository extends VSRepository<User, string, DrizzleOrmTypes<typeof db>> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, { table: userTable, queryKey: "userTable" }),
            pkName: "id",
        });
    }

    @DynamicMethod()
    declare findOneByEmail: (email: string) => Promise<User | null>;

    @QueryMethod('INSERT INTO "User" (name, role, email, "passwordHash") VALUES ($1, $2, $3, $4)', {
        modifying: true,
        spreadArgs: true,
    })
    declare insertUser: (name: string, role: Role, email: string, passwordHash: string) => Promise<number>;
}

const userRepository = new UserRepository();

const affectedRows = await userRepository.insertUser("Joao", Role.ADMIN, "joao@email.com", "125sdt3f");
console.log("affectedRows", affectedRows);

const allUsers = await userRepository.getAll({ relations: { orders: true } });
console.log(allUsers);

const userByEmail = await userRepository.findOneByEmail("joao@email.com");
console.log(userByEmail);

await userRepository.query('DELETE FROM "User" WHERE "email" = $1', { args: ["joao@email.com"] });
