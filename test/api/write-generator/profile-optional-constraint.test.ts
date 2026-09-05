import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as Path from "node:path";
import { APIBuilder } from "@root/api/builder";
import { mkSilentLogger } from "@typeschema-test/utils";

describe("Optional constrained profile fields (codegen-fw1)", async () => {
    const result = await new APIBuilder({ logger: mkSilentLogger() })
        .localStructureDefinitions({
            package: { name: "example.test.optionalconstraint", version: "0.1.0" },
            path: Path.join(__dirname, "../../assets/profile-optional-constraint"),
            dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
        })
        .typescript({ inMemoryOnly: true, generateProfile: true, withDebugComment: false })
        .generate();
    if (!result.success) throw new Error("Profile generation failed");
    const files = result.filesGenerated.typescript ?? {};
    const profilePath = Object.keys(files).find((key) => key.includes("ServiceRequest_OptionalCategoryServiceRequest"));
    if (!profilePath) throw new Error("Generated ServiceRequest profile is missing");

    const directory = await fs.mkdtemp(Path.join(os.tmpdir(), "codegen-fw1-"));
    afterAll(() => fs.rm(directory, { recursive: true, force: true }));
    for (const [relativePath, content] of Object.entries(files)) {
        const destination = Path.join(directory, relativePath);
        await fs.mkdir(Path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, content);
    }
    const { OptionalCategoryServiceRequestProfile: profile } = await import(Path.join(directory, profilePath));
    const resource = {
        resourceType: "ServiceRequest",
        meta: { profile: ["http://example.test/StructureDefinition/optional-category-service-request"] },
        status: "active",
        intent: "order",
        subject: { reference: "Patient/example" },
    };

    it("accepts an omitted optional pattern field through the generated parser", () => {
        expect(() => profile.from(resource)).not.toThrow();
    });

    it("still requires a constrained required field", () => {
        const { intent: _intent, ...withoutIntent } = resource;
        expect(() => profile.from(withoutIntent)).toThrow("required field 'intent' is missing");
    });

    it.each([null, false, 0, "", [{ coding: [{ system: "http://example.test/category", code: "other" }] }]])(
        "rejects a present mismatching optional pattern: %j",
        (category) => {
            expect(() => profile.from({ ...resource, category })).toThrow(
                "field 'category' does not match expected fixed value",
            );
        },
    );

    it("rejects a present mismatching required fixed value", () => {
        expect(() => profile.from({ ...resource, intent: "plan" })).toThrow(
            "field 'intent' does not match expected fixed value",
        );
    });
});
