import { describe, expect, it } from "bun:test";
import type { FHIRSchemaElement } from "@atomic-ehr/fhirschema";
import { APIBuilder } from "@root/api/builder";
import { mkField } from "@root/typeschema/core/field-builder";
import type { RegularField } from "@root/typeschema/types";
import { mkErrorLogger, mkR4Register, type PFS, registerFs } from "@typeschema-test/utils";

// Behavior around profile coding slices, pinned via outcome snapshots on both
// the field-builder and the generated-TypeScript level. PR #208 changes both:
//
// - a required coding slice that fixes only `system` currently promotes the
//   parent CodeableConcept to a fully fixed value (dropping the user-supplied
//   code); #208 keeps it a constraint, so the field becomes a real input;
// - a slice accessor named like a field accessor inherited from a parent
//   profile currently takes the colliding recommended name; #208 bumps it to
//   a qualified candidate. (A slice named after an unconstrained base-resource
//   field is pinned as well: that accessor stays as-is, since base fields are
//   not part of the profile snapshot.)
//
// After #208 merges, refresh with `bun test profile-slice-corrections -u` and
// review the flipped snapshots.

const SNOMED = "http://snomed.info/sct";
const METHOD_SYSTEM = "http://example.org/CodeSystem/method";

describe("field-builder: system-only required coding slice", async () => {
    const r4 = await mkR4Register();

    it("valueConstraint of the parent CodeableConcept", () => {
        const rawElement = {
            type: "CodeableConcept",
            elements: {
                coding: {
                    type: "Coding",
                    array: true,
                    slicing: {
                        slices: { snomed: { min: 1, match: { system: SNOMED } } },
                    },
                },
            },
        } as unknown as FHIRSchemaElement;
        const fhirSchema: PFS = {
            name: "Specimen",
            type: "Specimen",
            kind: "resource",
            url: "http://hl7.org/fhir/StructureDefinition/Specimen",
        };

        const field = mkField(
            r4,
            registerFs(r4, fhirSchema),
            ["type"],
            { type: "CodeableConcept" },
            undefined,
            rawElement,
        ) as RegularField;

        expect(field.valueConstraint).toMatchSnapshot();
    });
});

describe("TypeScript profile slice corrections", async () => {
    const register = await mkR4Register();
    const pkg = { name: "codegen.test", version: "1.0.0" };

    // Required `bodySite` and optional `method`, each constrained by a
    // system-only required coding slice.
    const systemOnlyProfile: PFS = {
        description: "Observation profile with system-only required coding slices",
        derivation: "constraint",
        type: "Observation",
        name: "SystemOnlyCodingObservation",
        kind: "resource",
        url: "http://example.org/StructureDefinition/system-only-coding",
        base: "http://hl7.org/fhir/StructureDefinition/Observation",
        package_meta: pkg,
        required: ["bodySite"],
        elements: {
            bodySite: {
                type: "CodeableConcept",
                elements: {
                    coding: {
                        slicing: {
                            slices: { Snomed: { min: 1, match: { system: SNOMED } } },
                        },
                    },
                },
            },
            method: {
                type: "CodeableConcept",
                elements: {
                    coding: {
                        slicing: {
                            slices: { Method: { min: 1, match: { system: METHOD_SYSTEM } } },
                        },
                    },
                },
            },
        },
    };

    // A `component` slice named `category` on a plain Observation profile that
    // does NOT constrain `category` itself: the base-resource field is not part
    // of the profile snapshot, so the slice keeps the `Category` accessor.
    const collidingSliceProfile: PFS = {
        description: "Observation profile with a slice named after an unconstrained base field",
        derivation: "constraint",
        type: "Observation",
        name: "CollidingSliceObservation",
        kind: "resource",
        url: "http://example.org/StructureDefinition/colliding-slice",
        base: "http://hl7.org/fhir/StructureDefinition/Observation",
        package_meta: pkg,
        elements: {
            component: {
                slicing: {
                    slices: {
                        category: {
                            min: 1,
                            max: 1,
                            match: { code: { coding: [{ system: SNOMED, code: "276885007" }] } },
                        },
                    },
                },
            },
        },
    };

    // Profile-on-profile: the parent constrains `category`, the child slices
    // `component` with a slice named `category`. The slice's recommended
    // accessor name collides with the `category` field accessor inherited
    // from the parent profile (visible only in the child's snapshot schema).
    const parentProfile: PFS = {
        description: "Parent Observation profile constraining category",
        derivation: "constraint",
        type: "Observation",
        name: "CategoryParentObservation",
        kind: "resource",
        url: "http://example.org/StructureDefinition/category-parent",
        base: "http://hl7.org/fhir/StructureDefinition/Observation",
        package_meta: pkg,
        elements: {
            category: { mustSupport: true },
        },
    };
    const inheritedCollisionProfile: PFS = {
        description: "Observation profile with a slice accessor colliding with an inherited field accessor",
        derivation: "constraint",
        type: "Observation",
        name: "InheritedCollisionObservation",
        kind: "resource",
        url: "http://example.org/StructureDefinition/inherited-collision",
        base: "http://example.org/StructureDefinition/category-parent",
        package_meta: pkg,
        elements: {
            component: {
                slicing: {
                    slices: {
                        category: {
                            min: 1,
                            max: 1,
                            match: { code: { coding: [{ system: SNOMED, code: "276885007" }] } },
                        },
                    },
                },
            },
        },
    };

    registerFs(register, systemOnlyProfile);
    registerFs(register, collidingSliceProfile);
    registerFs(register, parentProfile);
    registerFs(register, inheritedCollisionProfile);

    const result = await new APIBuilder({ register, logger: mkErrorLogger() })
        .typescript({
            inMemoryOnly: true,
            withDebugComment: false,
            generateProfile: true,
            openResourceTypeSet: false,
        })
        .generate();
    const files = result.filesGenerated.typescript ?? {};

    const fileBySuffix = (suffix: string): string => {
        const found = Object.entries(files).find(([path]) => path.endsWith(suffix));
        if (!found) throw new Error(`No generated file matching '*${suffix}'`);
        return found[1];
    };

    it("generates successfully", () => {
        expect(result.success).toBeTrue();
    });

    it("system-only coding slices: full profile module pinned", () => {
        expect(fileBySuffix("profiles/Observation_SystemOnlyCodingObservation.ts")).toMatchSnapshot();
    });

    it("colliding slice accessor: full profile module pinned", () => {
        expect(fileBySuffix("profiles/Observation_CollidingSliceObservation.ts")).toMatchSnapshot();
    });

    it("inherited-field colliding slice accessor: full profile module pinned", () => {
        expect(fileBySuffix("profiles/Observation_InheritedCollisionObservation.ts")).toMatchSnapshot();
    });
});
