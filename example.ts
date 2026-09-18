import { postTable, postTagTable, userTable } from "./dev/drizzle/schema.js";
import {
    DeepPartial,
    DynamicMethod,
    MethodOptions,
    QueryMethod,
    VSRepository,
    DbArg,
    withDb,
    VSLogLevel,
} from "vsrepo";
import { db, relations } from "./dev/drizzle/db.js";
import { DrizzleAdapter } from "./src/drizzle.adapter.js";
import { DrizzleOrmTypes } from "./src/types/drizzle-orm-types.type.js";
import { Role } from "./dev/enum/role.enum.js";
import { Address, Post, User } from "./dev/entities.js";

type MyOrmTypes = DrizzleOrmTypes<typeof db>;

class UserRepository extends VSRepository<User, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, {
                table: userTable,
                queryKey: "userTable",
                relationsSchema: relations,
                relations: {
                    posts: { restriction: "set" },
                    address: { restriction: "set", nullable: true },
                },
            }),
            pkName: "id",
            logLevel: VSLogLevel.INFO,
        });
    }

    @DynamicMethod()
    declare findOneByEmail: (email: string) => Promise<User | null>;

    @QueryMethod('INSERT INTO "User" (name, role, email, "passwordHash") VALUES ($1, $2, $3, $4)', {
        modifying: true,
        spreadArgs: true,
    })
    declare insertUser: (name: string, role: Role, email: string, passwordHash: string, db?: DbArg) => Promise<number>;

    @DynamicMethod()
    declare deleteManyReturningByEmail: (email: string, options?: MethodOptions<User>) => Promise<User[]>;

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
        posts: [
            {
                content: "Some backend post content...",
                title: "backend post",
            },
        ],
    },
    { relations: { address: true, posts: true } },
);
console.log(newUser);

newUser.address = {
    state: "ta",
    city: "tabes",
} as Address;

const userUpdated = await userRepository.save(newUser, { select: { address: true } });
console.log(userUpdated);

const removed = await userRepository.deleteManyReturningByEmail(newUser.email, { select: { address: true } });
console.log(removed);

await userRepository
    .transaction(async tx => {
        const created = await userRepository.createManyReturning(
            [
                {
                    name: "Pedro",
                    email: "pedro1@email.com",
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

        await userRepository.insertUser("Joao", Role.ADMIN, "joao@email.com", "asdyq8we", withDb(tx));

        tx.rollback();
    })
    .catch(console.log);

class PostRepository extends VSRepository<Post, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new DrizzleAdapter(db, {
                queryKey: "postTable",
                table: postTable,
                relationsSchema: relations,
                relations: {
                    category: {
                        restriction: "set",
                        nullable: true,
                    },
                    tags: {
                        restriction: "set",
                    },
                    user: {
                        restriction: "add",
                    },
                },
            }),
            pkName: "id",
            logLevel: VSLogLevel.INFO,
        });
    }
}

const postRepository = new PostRepository();

await postRepository.transaction(async tx => {
    const post = await postRepository.save(
        {
            category: null,
            content: "Some backend post content...",
            title: "backend post",
            user: {
                name: "Pedro",
                email: "pedro1@email.com",
                role: Role.USER,
                passwordHash: "2615376123",
            },
            tags: [
                {
                    name: "backend",
                },
                {
                    name: "nodejs",
                },
                {
                    name: "nestjs",
                },
            ],
        },
        { db: tx, relations: { category: true, tags: true, user: true } },
    );
    console.log(post);

    const postUpdated = await postRepository.patch(
        post.id,
        { tags: [{ id: post.tags[0]!.id }] },
        { db: tx, relations: { category: true, tags: true, user: true } },
    );
    console.log(postUpdated);

    const postIncremented = await postRepository.increment(postUpdated.id, "views", 50, {
        db: tx,
        select: { userId: true, views: true },
    });
    console.log("postIncremented", postIncremented);

    await postRepository.remove(postUpdated.id, { db: tx });

    tx.rollback();
});
