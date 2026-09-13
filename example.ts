import { getColumns, InferSelectModel } from "drizzle-orm";
import { orderTable, userTable } from "./dev/drizzle/schema.js";
import { DynamicMethod, QueryMethod, VSRepository } from "vsrepo";
import { db } from "./dev/drizzle/db.js";
import { DrizzleAdapter } from "./src/drizzle.adapter.js";
import { DrizzleOrmTypes } from "./src/types/drizzle-orm-types.type.js";
import { Role } from "./dev/enum/role.enum.js";
import { OrderStatus } from "./dev/enum/order-status.enum.js";

type Order = InferSelectModel<typeof orderTable>;
type User = InferSelectModel<typeof userTable> & { orders: Order[] };

class UserRepository extends VSRepository<User, string, DrizzleOrmTypes<typeof db>> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, {
                table: userTable,
                queryKey: "userTable",
                relations: {
                    orders: {
                        mode: "otm",
                        fkThere: "userId",
                        restriction: "set",
                        table: orderTable,
                    },
                },
            }),
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

    @DynamicMethod()
    declare deleteByEmail: (email: string) => Promise<User>;
}

const userRepository = new UserRepository();

const newUser = await userRepository.save(
    {
        name: "Pedro",
        email: "pedro@email.com",
        role: Role.USER,
        passwordHash: "2615376123",
        orders: [
            {
                status: OrderStatus.PENDING,
                total: 3,
            },
        ],
    },
    { relations: { orders: true } },
);
console.log(newUser);

newUser.orders = [];

const userUpdated = await userRepository.save(newUser, { relations: { orders: true } });
console.log(userUpdated);

await userRepository.deleteByEmail(newUser.email);

console.log(getColumns(userTable));
