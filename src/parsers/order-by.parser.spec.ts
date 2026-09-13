import { AdapterErrorCode, Ordering, VSRepoAdapterError } from "vsrepo";
import { parseOrderBy } from "./order-by.parser.js";
import { User } from "../../dev/entities.js";

describe("parseOrderBy", () => {
    it("should be defined", () => {
        expect(parseOrderBy).toBeDefined();
    });

    it("should return undefined if the order is undefined", () => {
        const order = undefined;

        const result = parseOrderBy(order);

        expect(result).toBeUndefined();
    });

    it("should return undefined if the order is null", () => {
        const order = null;

        const result = parseOrderBy(order);

        expect(result).toBeUndefined();
    });

    it("should convert an plain Ordering to a valid Drizzle's orderBy", () => {
        const order: Ordering<User> = {
            createdAt: "ASC",
            email: "DESC",
            name: "asc",
            passwordHash: "desc",
        };

        const result = parseOrderBy(order);

        expect(result).toEqual({
            createdAt: "asc",
            email: "desc",
            name: "asc",
            passwordHash: "desc",
        });
    });

    it("should convert an Ordering array to a valid plain Drizzle's orderBy", () => {
        const order: Ordering<User> = [
            {
                createdAt: "ASC",
            },
            {
                email: "DESC",
            },
            {
                name: "asc",
            },
            {
                passwordHash: "desc",
            },
        ];

        const result = parseOrderBy(order);

        expect(result).toEqual({
            createdAt: "asc",
            email: "desc",
            name: "asc",
            passwordHash: "desc",
        });
    });

    // * The typing and validation of the VSRepository itself protect against this; however, if one accesses the Adapter directly and performs a cast, it will throw an error
    it("should throw a VSRepoAdapterError if the provided order has nested ordering", () => {
        const order = {
            createdAt: "ASC",
            posts: {
                name: "desc",
            },
        } as unknown as Ordering<User>;

        try {
            parseOrderBy(order);
        } catch (error: any) {
            expect(error).toBeInstanceOf(VSRepoAdapterError);
            expect(error.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
        }
    });

    it("should overwrite repeated fields, if provided in an Ordering array", () => {
        const order: Ordering<User> = [{ email: "ASC" }, { id: "asc" }, { email: "DESC" }];

        const result = parseOrderBy(order);

        expect(result).toEqual({ email: "desc", id: "asc" });
    });
});
