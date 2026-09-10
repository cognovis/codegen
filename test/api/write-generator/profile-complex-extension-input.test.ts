import { describe, expect, it } from "bun:test";
import * as Path from "node:path";
import { APIBuilder } from "@root/api/builder";
import { mkSilentLogger } from "@typeschema-test/utils";

const FIXTURE_PATH = Path.join(__dirname, "../../assets/profile-complex-extension-input");

describe("Complex Extension factory input", async () => {
    const result = await new APIBuilder({ logger: mkSilentLogger() })
        .localStructureDefinitions({
            package: { name: "example.test.complexextensioninput", version: "0.1.0" },
            path: FIXTURE_PATH,
            dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
        })
        .typescript({ inMemoryOnly: true, generateProfile: true, withDebugComment: false })
        .generate();
    if (!result.success) throw new Error("Profile generation failed");
    const files = result.filesGenerated.typescript ?? {};

    const fileBySuffix = (suffix: string): string => {
        const found = Object.entries(files).find(([path]) => path.endsWith(suffix));
        if (!found) throw new Error(`No generated file matching '*${suffix}'`);
        return found[1];
    };

    it("requires factory input when a complex Extension has a required sub-extension slice", () => {
        const profile = fileBySuffix("profiles/Extension_RequiredComplexExtension.ts");

        expect(profile).toContain(
            "static createResource (args: RequiredComplexExtensionProfileRaw | RequiredComplexExtensionProfileFlat) : Extension",
        );
        expect(profile).toContain(
            "static create (args: RequiredComplexExtensionProfileRaw | RequiredComplexExtensionProfileFlat) : RequiredComplexExtensionProfile",
        );
        expect(profile).toContain("RequiredComplexExtensionProfile.resolveInput(args)");
        expect(profile).not.toContain("RequiredComplexExtensionProfile.resolveInput(args ?? {})");
    });

    it("keeps factory input optional when every complex Extension slice is optional", () => {
        const profile = fileBySuffix("profiles/Extension_OptionalComplexExtension.ts");

        expect(profile).toContain(
            "static createResource (args?: OptionalComplexExtensionProfileRaw | OptionalComplexExtensionProfileFlat) : Extension",
        );
        expect(profile).toContain(
            "static create (args?: OptionalComplexExtensionProfileRaw | OptionalComplexExtensionProfileFlat) : OptionalComplexExtensionProfile",
        );
        expect(profile).toContain("OptionalComplexExtensionProfile.resolveInput(args ?? {})");
    });
});
