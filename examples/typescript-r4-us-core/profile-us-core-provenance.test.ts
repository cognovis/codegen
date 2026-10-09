/**
 * US Core Provenance Profile Class API Tests
 *
 * US Core restates `Provenance.target`, whose base type is `Reference(Any)` — its
 * only declared target is the abstract `Resource` type, which admits a reference
 * to *any* resource. An open target set like that cannot be validated against a
 * closed list: the concrete resources the generator knows about are whatever the
 * TypeSchema index happens to hold, and this example tree-shakes it down to a
 * handful. So no reference check is emitted for `target` at all.
 *
 * The contrast is `Observation.performer` and friends, whose declared targets are
 * an explicit list. Those stay validated, and on every entry of the repeating
 * element — which is what `b7ec6cde` fixed upstream and what must keep working.
 *
 * `target` is `1..*`, so the element holds a list of References.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { USCoreBloodPressureProfile } from "./fhir-types/hl7-fhir-us-core/profiles/Observation_USCoreBloodPressureProfile";
import { USCoreProvenanceProfile } from "./fhir-types/hl7-fhir-us-core/profiles/Provenance_USCoreProvenance";

const generatedSource = readFileSync(
    new URL("./fhir-types/hl7-fhir-us-core/profiles/Provenance_USCoreProvenance.ts", import.meta.url),
    "utf8",
);

const baseArgs = {
    recorded: "2024-06-15T10:00:00Z",
    agent: [{ who: { reference: "Practitioner/pr-1" as const } }],
};

describe("demo: record provenance for a resource", () => {
    test("build a provenance resource targeting a Patient", () => {
        const profile = USCoreProvenanceProfile.create({
            ...baseArgs,
            target: [{ reference: "Patient/pt-1" }],
        });

        expect(profile.validate().errors).toEqual([]);
        expect(profile.toResource()).toMatchSnapshot();
    });
});

describe("an open reference target emits no check", () => {
    test("no reference check is generated for target", () => {
        expect(generatedSource).not.toContain('validateReference(res, profileName, "target"');
    });

    // The type side already says this is open: `Provenance.target` generates as
    // `Reference<string /* Resource */>[]`, not a union of the shaken members.
    test("the generated target type stays open", () => {
        expect(readFileSync(new URL("./fhir-types/hl7-fhir-r4-core/Provenance.ts", import.meta.url), "utf8")).toContain(
            "target: Reference<string /* Resource */>[];",
        );
    });

    // The regression this pins: Organization is a perfectly legal Provenance.target,
    // but it is not in this example's shaken index, so a family-expanded allow-list
    // rejected it. Asserted through validate() and from(), not just the source.
    test("accepts a resource type the shaken index does not hold", () => {
        const profile = USCoreProvenanceProfile.create({
            ...baseArgs,
            target: [{ reference: "Organization/org-1" }],
        });

        expect(profile.validate().errors).toEqual([]);
        expect(() => USCoreProvenanceProfile.from(profile.toResource())).not.toThrow();
    });

    test("accepts a shaken-out type after a permitted one", () => {
        const profile = USCoreProvenanceProfile.create({
            ...baseArgs,
            target: [{ reference: "Patient/pt-1" }, { reference: "Organization/org-1" }],
        });

        expect(profile.validate().errors).toEqual([]);
        expect(() => USCoreProvenanceProfile.from(profile.toResource())).not.toThrow();
    });
});

describe("a closed reference target is still checked on every entry", () => {
    // Only what the profile's own Raw type takes. validate() will also report the
    // missing effective[x] and components; every assertion below is on the presence
    // or absence of the performer error alone, so that is irrelevant here.
    const bpArgs = { status: "final" as const, subject: { reference: "Patient/pt-1" as const } };
    const performerError =
        "USCoreBloodPressureProfile: field 'performer' references 'Device' but only CareTeam, Organization, Patient, Practitioner, PractitionerRole, RelatedPerson are allowed";

    test("the closed performer check is still generated", () => {
        expect(
            readFileSync(
                new URL(
                    "./fhir-types/hl7-fhir-us-core/profiles/Observation_USCoreBloodPressureProfile.ts",
                    import.meta.url,
                ),
                "utf8",
            ),
        ).toContain(
            'validateReference(res, profileName, "performer", ["CareTeam","Organization","Patient","Practitioner","PractitionerRole","RelatedPerson"])',
        );
    });

    test("a permitted performer passes", () => {
        const resource = USCoreBloodPressureProfile.createResource(bpArgs);
        resource.performer = [{ reference: "Practitioner/pr-1" }];

        expect(USCoreBloodPressureProfile.apply(resource).validate().errors).not.toContain(performerError);
    });

    test("a disallowed performer is reported", () => {
        const resource = USCoreBloodPressureProfile.createResource(bpArgs);
        // The generated type already closes this target set, so assigning Device is a
        // type error — that directive is itself the assertion. The runtime check is the
        // second line of defence, and it is what a consumer parsing server JSON hits.
        // @ts-expect-error Device is not a declared target of Observation.performer
        resource.performer = [{ reference: "Device/dev-1" }];

        expect(USCoreBloodPressureProfile.apply(resource).validate().errors).toContain(performerError);
    });

    // b7ec6cde: every entry, not only the first.
    test("a disallowed performer after a permitted one is reported", () => {
        const resource = USCoreBloodPressureProfile.createResource(bpArgs);
        // @ts-expect-error Device is not a declared target of Observation.performer
        resource.performer = [{ reference: "Practitioner/pr-1" }, { reference: "Device/dev-1" }];

        expect(USCoreBloodPressureProfile.apply(resource).validate().errors).toContain(performerError);
    });
});
