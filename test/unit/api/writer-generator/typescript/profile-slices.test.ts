import { describe, expect, test } from "bun:test";
import { sliceAccessorBaseName } from "@root/api/writer-generator/typescript/profile-slices";

describe("sliceAccessorBaseName", () => {
    test("qualifies a slice accessor that collides with an inherited field accessor", () => {
        expect(
            sliceAccessorBaseName(["Category", "ComponentCategory", "ComponentCategorySlice"], "Category", [
                "category",
                "component",
            ]),
        ).toBe("ComponentCategory");
    });

    test("keeps a collision-free recommended slice accessor", () => {
        expect(sliceAccessorBaseName(["SystolicBP", "ComponentSystolicBP"], "SystolicBP", ["component"])).toBe(
            "SystolicBP",
        );
    });
});
