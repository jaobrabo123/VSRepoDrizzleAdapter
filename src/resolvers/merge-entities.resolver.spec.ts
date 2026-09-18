import { ResolvedRelation } from "../types/resolved-relation.type.js";
import { mergeEntities } from "./merge-entities.resolver.js";

function relation(overrides: Partial<ResolvedRelation>): ResolvedRelation {
    return {
        mode: "otm",
        restriction: "add",
        table: {} as ResolvedRelation["table"],
        relatedPk: "id",
        ...overrides,
    };
}

describe("mergeEntities", () => {
    it("should be defined", () => {
        expect(mergeEntities).toBeDefined();
    });

    it("deep-merges plain objects (no relations) and concatenates arrays", () => {
        const result = { id: 1, name: "Old", tags: ["a"] };
        const obj = { name: "New", tags: ["b"] };

        expect(mergeEntities(result, obj)).toEqual({ id: 1, name: "New", tags: ["a", "b"] });
    });

    it("keeps a to-one relation's existing fields when only some are sent", () => {
        const relations = new Map<string, ResolvedRelation>([["address", relation({ mode: "oto" })]]);
        const result = { id: 1, address: { street: "Rua A", number: 10 } };
        const obj = { address: { number: 20 } };

        expect(mergeEntities(result, obj, relations)).toEqual({
            id: 1,
            address: { street: "Rua A", number: 20 },
        });
    });

    it("sets a to-one relation to null when obj sends null explicitly", () => {
        const relations = new Map<string, ResolvedRelation>([["address", relation({ mode: "mto" })]]);
        const result = { id: 1, address: { street: "Rua A" } };
        const obj = { address: null };

        expect(mergeEntities(result, obj, relations)).toEqual({ id: 1, address: null });
    });

    it("matches otm items by relatedPk, merging matches and appending the rest, keeping unmentioned items", () => {
        const relations = new Map<string, ResolvedRelation>([["posts", relation({ mode: "otm", relatedPk: "id" })]]);
        const result = {
            id: 1,
            posts: [
                { id: "p1", title: "old" },
                { id: "p2", title: "keep-me" },
            ],
        };
        const obj = {
            posts: [
                { id: "p1", title: "updated" },
                { id: "p3", title: "new" },
            ],
        };

        expect(mergeEntities(result, obj, relations)).toEqual({
            id: 1,
            posts: [
                { id: "p1", title: "updated" },
                { id: "p2", title: "keep-me" },
                { id: "p3", title: "new" },
            ],
        });
    });

    it("matches mtm items by relatedPk the same way otm does, merging via the join/pivot relation", () => {
        const relations = new Map<string, ResolvedRelation>([
            [
                "tags",
                relation({
                    mode: "mtm",
                    relatedPk: "id",
                    through: {} as ResolvedRelation["table"],
                    throughFkHere: "postId",
                    throughFkThere: "tagId",
                }),
            ],
        ]);
        const result = {
            id: 1,
            tags: [
                { id: "t1", label: "old" },
                { id: "t2", label: "keep-me" },
            ],
        };
        const obj = {
            tags: [
                { id: "t1", label: "updated" },
                { id: "t3", label: "new" },
            ],
        };

        expect(mergeEntities(result, obj, relations)).toEqual({
            id: 1,
            tags: [
                { id: "t1", label: "updated" },
                { id: "t2", label: "keep-me" },
                { id: "t3", label: "new" },
            ],
        });
    });

    it("ignores undefined fields in obj", () => {
        const result = { id: 1, name: "Old" };
        const obj = { id: undefined, name: "New" } as unknown as typeof result;

        expect(mergeEntities(result, obj)).toEqual({ id: 1, name: "New" });
    });
});
