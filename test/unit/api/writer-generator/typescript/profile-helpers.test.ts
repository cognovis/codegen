import { expect, test } from "bun:test";
import { validateReference } from "../../../../../assets/api/writer-generator/typescript/profile-helpers";

// Independent expected-value source: HL7 FHIR R4 Resource StructureDefinition
// IG canonical: http://hl7.org/fhir/StructureDefinition/Resource, element: Resource.
// Resource is the abstract base type for Organization and Practitioner.
test("validateReference accepts an Organization for a Resource target", () => {
    expect(
        validateReference({ subject: { reference: "Organization/synthetic" } }, "Audit", "subject", ["Resource"]),
    ).toEqual([]);
});

test("validateReference accepts a Practitioner for a Resource target", () => {
    expect(
        validateReference({ subject: { reference: "Practitioner/synthetic" } }, "Audit", "subject", ["Resource"]),
    ).toEqual([]);
});

// Independent expected-value source: HL7 FHIR R4 ElementDefinition StructureDefinition
// IG canonical: http://hl7.org/fhir/StructureDefinition/ElementDefinition,
// element: ElementDefinition.type.targetProfile.
// A Reference targetProfile of Patient accepts Patient and excludes Organization.
test("validateReference accepts a Patient for a Patient target", () => {
    expect(validateReference({ subject: { reference: "Patient/synthetic" } }, "Audit", "subject", ["Patient"])).toEqual(
        [],
    );
});

test("validateReference rejects an Organization for a Patient target", () => {
    expect(
        validateReference({ subject: { reference: "Organization/synthetic" } }, "Audit", "subject", ["Patient"]),
    ).toHaveLength(1);
});
