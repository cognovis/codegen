import { describe, expect, it } from "bun:test";
import type {
    CanonicalUrl,
    Name,
    NestedIdentifier,
    NestedTypeSchema,
    ProfileTypeSchema,
    TypeIdentifier,
} from "@typeschema/types";
import { mkTypeSchemaIndex } from "@typeschema/utils";

const observation: TypeIdentifier = {
    kind: "resource",
    package: "hl7.fhir.r4.core",
    version: "4.0.1",
    name: "Observation" as Name,
    url: "http://hl7.org/fhir/StructureDefinition/Observation" as CanonicalUrl,
};

const component: NestedIdentifier = {
    kind: "nested",
    package: "hl7.fhir.r4.core",
    version: "4.0.1",
    name: "component" as Name,
    url: "http://hl7.org/fhir/StructureDefinition/Observation#component" as CanonicalUrl,
};

/** A profile that carries its own constrained copy of Observation#component,
 *  marked by a field named after the profile so the index winner is visible. */
const profileWithComponent = (slug: string): ProfileTypeSchema => {
    const nested: NestedTypeSchema = {
        identifier: component,
        fields: { [slug]: { type: observation, array: false, required: false } },
    };
    return {
        identifier: {
            kind: "profile",
            package: "codegen.test.nestedowner",
            version: "1.0.0",
            name: slug as Name,
            url: `http://example.org/StructureDefinition/${slug}` as CanonicalUrl,
        },
        base: observation,
        nested: [nested],
    };
};

// '-' (U+002D) sorts before '_' (U+005F) by code unit, but ICU collation puts '_' first.
const hyphen = profileWithComponent("tie-a");
const underscore = profileWithComponent("tie_a");

describe("nested index owner tie-break", () => {
    it("uses canonicals whose code-unit and locale orders disagree", () => {
        expect(hyphen.identifier.url < underscore.identifier.url).toBe(true);
        expect(hyphen.identifier.url.localeCompare(underscore.identifier.url)).toBeGreaterThan(0);
    });

    it.each([
        ["hyphen first", [hyphen, underscore]],
        ["underscore first", [underscore, hyphen]],
    ])("keeps the code-unit-first profile's nested type when %s", (_order, schemas) => {
        const index = mkTypeSchemaIndex(schemas, {});
        const resolved = index.resolveType(component);
        expect(resolved && "fields" in resolved ? Object.keys(resolved.fields ?? {}) : []).toEqual(["tie-a"]);
    });
});
