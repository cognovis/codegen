import { describe, expect, test } from "bun:test";

/** Consumer contract: a generated profile class is usable as this structural type. */
type ProfileDescriptor = {
    readonly resourceType: string;
    readonly canonicalUrl: string;
    from: (resource: never) => unknown;
    createResource: (...args: never[]) => unknown;
};

class BodyweightShapedProfile {
    static readonly resourceType = "Observation";
    static readonly canonicalUrl = "http://hl7.org/fhir/StructureDefinition/bodyweight";
    private readonly resource = { resourceType: "Observation" as const };
    static from(_resource: { resourceType: "Observation" }) {
        return new BodyweightShapedProfile();
    }
    static createResource() {
        return { resourceType: "Observation" as const };
    }
    toResource() {
        return this.resource;
    }
}

BodyweightShapedProfile satisfies ProfileDescriptor;

describe("generated profile structural descriptor", () => {
    test("a generated-shaped profile class is assignable without a Cognovis-specific import", () => {
        const descriptor: ProfileDescriptor = BodyweightShapedProfile;
        expect(descriptor.resourceType).toBe("Observation");
        expect(descriptor.canonicalUrl).toBe("http://hl7.org/fhir/StructureDefinition/bodyweight");
        expect(typeof descriptor.from).toBe("function");
        expect(typeof descriptor.createResource).toBe("function");
    });
});
