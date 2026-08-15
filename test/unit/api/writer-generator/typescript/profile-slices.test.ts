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

    test("allocates a distinct accessor when an earlier slice selected the same candidate", () => {
        const candidates = ["Category", "ComponentCategory", "OtherComponentCategory"];
        const fieldNames = ["category", "component"];
        const first = sliceAccessorBaseName(candidates, "Category", fieldNames);
        const second = sliceAccessorBaseName(candidates, "Category", fieldNames, new Set([first]));

        expect(first).toBe("ComponentCategory");
        expect(second).toBe("OtherComponentCategory");
    });
});
