import { userTable } from "./dev/drizzle/schema.js";
import { DeepPartial, DynamicMethod, MethodOptions, QueryMethod, VSRepository } from "vsrepo";
import { db, relations } from "./dev/drizzle/db.js";
import { DrizzleAdapter } from "./src/drizzle.adapter.js";
import { DrizzleOrmTypes } from "./src/types/drizzle-orm-types.type.js";
import { Role } from "./dev/enum/role.enum.js";
import { Address, User } from "./dev/entities.js";

class UserRepository extends VSRepository<User, string, DrizzleOrmTypes<typeof db>> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, {
                table: userTable,
                queryKey: "userTable",
                relationsSchema: relations,
                relations: {
                    posts: { restriction: "add" },
                    address: { restriction: "set", nullable: true },
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
    declare deleteByEmail: (email: string, options?: MethodOptions<User>) => Promise<User>;

    @DynamicMethod()
    declare createManyReturning: (objs: DeepPartial<User>[], options?: MethodOptions<User>) => Promise<User[]>;
}

const userRepository = new UserRepository();

const newUser = await userRepository.save(
    {
        name: "Pedro",
        email: "pedro@email.com",
        role: Role.USER,
        passwordHash: "2615376123",
        address: null,
    },
    { relations: { address: true } },
);
console.log(newUser);

newUser.address = {
    state: "ta",
    city: "tabes",
} as Address;

const userUpdated = await userRepository.save(newUser, { relations: { address: true } });
console.log(userUpdated);

await userRepository.deleteByEmail(newUser.email, { select: { id: true } });

await userRepository
    .transaction(async tx => {
        const created = await userRepository.createManyReturning(
            [
                {
                    name: "Pedro",
                    email: "pedro@email.com",
                    role: Role.USER,
                    passwordHash: "2615376123",
                },
                {
                    name: "Pedro 2",
                    email: "pedro2@email.com",
                    role: Role.USER,
                    passwordHash: "asdyi8u2y3",
                },
            ],
            { db: tx, relations: { address: true, posts: true } },
        );
        console.log(created);

        tx.rollback();
    })
    .catch(console.log);
