import { VSRepoRelations } from "vsrepo";
import { parseWith } from "./with.parser.js";
import { User } from "../../dev/entities.js";

describe("parseWith", () => {
    it("should be defined", () => {
        expect(parseWith).toBeDefined();
    });

    it("should return an empty object if the relations is empty", () => {
        const relations: VSRepoRelations<User> = {};

        const result = parseWith(relations);

        expect(result).toEqual({});
    });

    it("should return object with the relations marked as true if the provided relations has relations marked as true", () => {
        const relations: VSRepoRelations<User> = {
            address: true,
            posts: true,
        };

        const result = parseWith(relations);

        expect(result).toEqual({
            address: true,
            posts: true,
        });
    });

    it("should return object with the nested relations into a 'with' and marked as true if the provided relations has nested relations marked as true", () => {
        const relations: VSRepoRelations<User> = {
            address: true,
            posts: { category: true },
        };

        const result = parseWith(relations);

        expect(result).toEqual({
            address: true,
            posts: { with: { category: true } },
        });
    });
});
