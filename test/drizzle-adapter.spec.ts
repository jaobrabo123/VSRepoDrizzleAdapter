import { db } from "../dev/drizzle/db.js";
import { userTable } from "../dev/drizzle/schema.js";
import { User } from "../dev/entities.js";
import { DrizzleAdapter } from "../src/drizzle.adapter.js";
import cleanDbHelper from "./helpers/clean-db.helper.js";

describe("DrizzleAdapter", () => {
    let userAdapter: DrizzleAdapter<User>;

    beforeEach(async () => {
        await cleanDbHelper();
        userAdapter = new DrizzleAdapter<User>(db, {
            queryKey: "userTable",
            table: userTable,
            dialect: "postgresql",
        });
    });

    it("should be defined", () => {
        expect(userAdapter).toBeDefined();
    });
});
