import { describe, expect, it } from "bun:test";
import assert from "node:assert";
import { mkExtensionNameCandidates } from "@root/typeschema/core/name-candidates";
import {
    packageTreeShakeReadme,
    rootTreeShakeReadme,
    treeShake,
    treeShakeTypeSchema,
} from "@root/typeschema/ir/tree-shake";
import { registerFromPackageMetas } from "@root/typeschema/register";
import type {
    CanonicalUrl,
    Name,
    NestedIdentifier,
    ProfileIdentifier,
    ProfileTypeSchema,
    ResourceIdentifier,
    SpecializationTypeSchema,
    TypeIdentifier,
} from "@root/typeschema/types";
import { mkTypeSchemaIndex } from "@root/typeschema/utils";
import { mkIndex, mkR4Register, mkTestLogger, r4Package, r5Package, resolveTs } from "@typeschema-test/utils";

describe("treeShake specific TypeSchema", async () => {
    const manager = await registerFromPackageMetas([r4Package, r5Package], {});
    const tsIndex = await mkIndex(manager);
    it("tree shake report should be empty without treeshaking", () => {
        expect(tsIndex.irReport()).toEqual({});
    });
    describe("Only Bundle & Operation Outcome without extensions", () => {
        const shaked = treeShake(tsIndex, {
            "hl7.fhir.r4.core": {
                "http://hl7.org/fhir/StructureDefinition/Bundle": {},
                "http://hl7.org/fhir/StructureDefinition/OperationOutcome": {},
                "http://hl7.org/fhir/StructureDefinition/DomainResource": {
                    ignoreFields: ["extension", "modifierExtension"],
                },
                "http://hl7.org/fhir/StructureDefinition/BackboneElement": {
                    ignoreFields: ["modifierExtension"],
                },
                "http://hl7.org/fhir/StructureDefinition/Element": {
                    ignoreFields: ["extension"],
                },
            },
        });

        const report = shaked.irReport();

        it("check treeshake report", () => {
            expect(report).toBeDefined();
            assert(report.treeShake);
            expect(report.treeShake.skippedPackages).toMatchObject(["hl7.fhir.r5.core"]);
            expect(report.treeShake.packages).toMatchSnapshot();
        });
        it("root tree shake readme", () => {
            expect(rootTreeShakeReadme(report)).toMatchSnapshot();
        });
        it("package tree shake readme", () => {
            expect(packageTreeShakeReadme(report, "hl7.fhir.r4.core")).toMatchSnapshot();
        });
        it("check actually generated tree", () => {
            expect(shaked.entityTree()).toMatchSnapshot();
        });
    });

    describe("followReferences", () => {
        const patientUrl = "http://hl7.org/fhir/StructureDefinition/Patient" as CanonicalUrl;
        const observationRule = (rule: object) =>
            treeShake(tsIndex, {
                "hl7.fhir.r4.core": { "http://hl7.org/fhir/StructureDefinition/Observation": rule },
            });

        it("drops reference targets by default", () => {
            const shaked = observationRule({});
            expect(shaked.resolveByUrl("hl7.fhir.r4.core", patientUrl)).toBeUndefined();
        });

        it("keeps reference targets when enabled", () => {
            const shaked = observationRule({ followReferences: true });
            const patient = shaked.resolveByUrl("hl7.fhir.r4.core", patientUrl);
            expect(patient).toBeDefined();
            expect(patient?.identifier.kind).toBe("resource");
            // Nested-type references are followed too (Observation.component has none,
            // but Observation.performer lives on the root; device covers another target).
            const device = shaked.resolveByUrl(
                "hl7.fhir.r4.core",
                "http://hl7.org/fhir/StructureDefinition/Device" as CanonicalUrl,
            );
            expect(device).toBeDefined();
        });

        it("treeShakeDefaults enables following for every root", () => {
            const shaked = treeShake(
                tsIndex,
                { "hl7.fhir.r4.core": { "http://hl7.org/fhir/StructureDefinition/Observation": {} } },
                { followReferences: true },
            );
            expect(shaked.resolveByUrl("hl7.fhir.r4.core", patientUrl)).toBeDefined();
        });

        it("rule-level followReferences wins over the default", () => {
            const shaked = treeShake(
                tsIndex,
                {
                    "hl7.fhir.r4.core": {
                        "http://hl7.org/fhir/StructureDefinition/Observation": { followReferences: false },
                    },
                },
                { followReferences: true },
            );
            expect(shaked.resolveByUrl("hl7.fhir.r4.core", patientUrl)).toBeUndefined();
        });

        it("does not follow references transitively", () => {
            // Account is referenced by Encounter (followed) but not by Observation
            // itself — followed types keep their own reference targets as literals.
            const shaked = observationRule({ followReferences: true });
            const account = shaked.resolveByUrl(
                "hl7.fhir.r4.core",
                "http://hl7.org/fhir/StructureDefinition/Account" as CanonicalUrl,
            );
            expect(account).toBeUndefined();
        });
    });
});

describe("treeShake inherited nested targets", () => {
    const questionnaireUrl = "http://hl7.org/fhir/StructureDefinition/Questionnaire" as CanonicalUrl;
    const profileUrl = "https://fhir.cognovis.de/praxis/StructureDefinition/anamnese-questionnaire" as CanonicalUrl;
    const questionnaireId: ResourceIdentifier = {
        kind: "resource",
        name: "Questionnaire" as Name,
        url: questionnaireUrl,
        package: "hl7.fhir.r4.core",
        version: "4.0.1",
    };
    const itemId: NestedIdentifier = {
        kind: "nested",
        name: "item" as Name,
        url: `${questionnaireUrl}#item` as CanonicalUrl,
        package: "hl7.fhir.r4.core",
        version: "4.0.1",
    };
    const enableWhenId: NestedIdentifier = {
        kind: "nested",
        name: "item.enableWhen" as Name,
        url: `${questionnaireUrl}#item.enableWhen` as CanonicalUrl,
        package: "hl7.fhir.r4.core",
        version: "4.0.1",
    };
    const profileId: ProfileIdentifier = {
        kind: "profile",
        name: "AnamneseQuestionnaire" as Name,
        url: profileUrl,
        package: "de.cognovis.fhir.praxis",
        version: "0.101.6",
    };

    const schemas = (includeEnableWhen: boolean): [SpecializationTypeSchema, ProfileTypeSchema] => {
        const questionnaire: SpecializationTypeSchema = {
            identifier: questionnaireId,
            fields: { item: { type: itemId } },
            nested: [
                { identifier: itemId, fields: { enableWhen: { type: enableWhenId } } },
                ...(includeEnableWhen ? [{ identifier: enableWhenId, fields: {} }] : []),
            ],
        };
        const profile: ProfileTypeSchema = {
            identifier: profileId,
            base: questionnaireId,
            fields: { item: { type: itemId } },
            nested: [{ identifier: itemId, fields: { enableWhen: { type: enableWhenId } } }],
        };
        return [questionnaire, profile];
    };

    /**
     * source_kind: worked_example
     * source: fmgt-qxn8 exact Praxis 0.101.6 diagnostic
     * worked_example_pointer: candidate sha256 400aa9e319d0fbda7c79fb883521680a4c8f62f0b8eb33e07832550cc9078658; normalized profile sha256 4e41dee3cad1c9e5f289c23da41af527ca4600ca66cd7c49463e798454bf2dd9
     * source_kind: oracle
     * source: current TypeSchema/index exact Identifier contract at 971a959a9050f8ce73ce1fc736225a99bd041d92
     * oracle_ledger_id: atomic-codegen@971a959a9050f8ce73ce1fc736225a99bd041d92:NestedIdentifier+TypeSchemaIndex.resolveType
     * expected local parent: http://hl7.org/fhir/StructureDefinition/Questionnaire#item
     * expected base-owned target: hl7.fhir.r4.core@4.0.1 http://hl7.org/fhir/StructureDefinition/Questionnaire#item.enableWhen
     */
    it("retains a base-owned nested target used by a profile-local inherited parent", () => {
        const shaked = treeShake(mkTypeSchemaIndex(schemas(true), {}), {
            "de.cognovis.fhir.praxis": { [profileUrl]: {} },
        });

        expect(shaked.resolve(profileId)?.nested?.map(({ identifier }) => identifier)).toContainEqual(itemId);
        expect(shaked.resolveType(enableWhenId)?.identifier).toEqual(enableWhenId);
    });

    it("names a genuinely missing inherited nested target", () => {
        expect(() =>
            treeShake(mkTypeSchemaIndex(schemas(false), {}), {
                "de.cognovis.fhir.praxis": { [profileUrl]: {} },
            }),
        ).toThrowError("http://hl7.org/fhir/StructureDefinition/Questionnaire#item.enableWhen");
    });

    /**
     * source_kind: worked_example
     * source: codegen-4ok accepted Reviewer 1 reproduction
     * worked_example_pointer: valid core reference to http://r#n is visited before missing-package reference {url: http://r#n, package: absent}; current outcome accepted
     * source_kind: oracle
     * source: TypeSchemaIndex exact URL-plus-package nested identity contract at 75b07521
     * oracle_ledger_id: atomic-codegen@75b07521:NestedIdentifier+TypeSchemaIndex.resolveType
     * expected missing identity: {"kind":"nested","name":"n","url":"http://r#n","package":"absent","version":"1.0.0"}
     */
    it("rejects a visited nested URL when the requested package is missing", () => {
        const nestedUrl = "http://r#n" as CanonicalUrl;
        const coreNested: NestedIdentifier = {
            kind: "nested",
            name: "n" as Name,
            url: nestedUrl,
            package: "core",
            version: "1.0.0",
        };
        const missingNested: NestedIdentifier = {
            ...coreNested,
            package: "absent",
        };
        const root: SpecializationTypeSchema = {
            identifier: {
                kind: "resource",
                name: "Root" as Name,
                url: "http://r" as CanonicalUrl,
                package: "fixture",
                version: "1.0.0",
            },
            fields: {
                valid: { type: coreNested },
                missing: { type: missingNested },
            },
            nested: [{ identifier: coreNested, fields: {} }],
        };

        expect(() =>
            treeShake(mkTypeSchemaIndex([root], {}), {
                fixture: { "http://r": {} },
            }),
        ).toThrowError(
            'Nested schema {"kind":"nested","name":"n","url":"http://r#n","package":"absent","version":"1.0.0"}',
        );
    });
});

describe("treeShake inherited slice match targets", () => {
    const corePackage = "hl7.fhir.r4.core";
    const coreVersion = "4.0.1";
    const resourceId = (name: string): ResourceIdentifier => ({
        kind: "resource",
        name: name as Name,
        url: `http://hl7.org/fhir/StructureDefinition/${name}` as CanonicalUrl,
        package: corePackage,
        version: coreVersion,
    });
    const bundleId = resourceId("Bundle");
    const patientId = resourceId("Patient");
    const practitionerId = resourceId("Practitioner");
    const referenceId: TypeIdentifier = {
        kind: "complex-type",
        name: "Reference" as Name,
        url: "http://hl7.org/fhir/StructureDefinition/Reference" as CanonicalUrl,
        package: corePackage,
        version: coreVersion,
    };
    const entryId: NestedIdentifier = {
        kind: "nested",
        name: "entry" as Name,
        url: "http://hl7.org/fhir/StructureDefinition/Bundle#entry" as CanonicalUrl,
        package: corePackage,
        version: coreVersion,
    };
    const epsBundleId: ProfileIdentifier = {
        kind: "profile",
        name: "BundleEuEps" as Name,
        url: "http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps" as CanonicalUrl,
        package: "hl7.fhir.eu.eps",
        version: "1.0.0-ballot",
    };
    const praxisBundleUrl =
        "https://fhir.cognovis.de/praxis/StructureDefinition/patient-summary-bundle-praxis-de" as CanonicalUrl;
    const praxisBundleId: ProfileIdentifier = {
        kind: "profile",
        name: "PraxisPatientSummaryBundle" as Name,
        url: praxisBundleUrl,
        package: "de.cognovis.fhir.praxis",
        version: "0.101.6",
    };

    /**
     * source_kind: ig_profile
     * source: exact hl7.fhir.eu.eps@1.0.0-ballot Bundle profile
     * ig_canonical: http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps
     * element: differential Bundle.entry type discriminator path resource and Bundle.entry:patient.resource Patient
     * source_kind: worked_example
     * source: fmgt-qxn8 fifth Praxis candidate compiler transcript
     * worked_example_pointer: /tmp/fmgt-qxn8-candidate-run.yPbGaF/output generated hl7-fhir-eu-eps/profiles/Bundle_BundleEuEps.ts with BundleEntry<Patient> but no hl7-fhir-r4-core/Patient.ts
     * source_kind: oracle
     * source: TypeScript type-discriminated slice writer contract
     * oracle_ledger_id: atomic-codegen@bc240259:src/api/writer-generator/typescript/profile-slices.ts#collectTypesFromSlices
     * expected retained target: hl7.fhir.r4.core@4.0.1 Patient, enabling import and rendering of BundleEntry<Patient>
     * source_kind: oracle
     * source: treeShake followReferences contract
     * oracle_ledger_id: atomic-codegen@bc240259:src/typeschema/ir/types.ts#TreeShakeRule.followReferences
     * expected omitted ordinary reference target with followReferences false: Practitioner
     */
    it("retains a type-discriminated slice target inherited through a parent profile", () => {
        const bundle: SpecializationTypeSchema = {
            identifier: bundleId,
            fields: { entry: { type: entryId, array: true } },
            nested: [{ identifier: entryId, fields: {} }],
        };
        const epsBundle: ProfileTypeSchema = {
            identifier: epsBundleId,
            base: bundleId,
            fields: {
                entry: { type: entryId, array: true },
                ordinaryReference: {
                    type: referenceId,
                    reference: { resource: [practitionerId] },
                },
            },
            slicing: {
                entry: {
                    discriminator: [
                        { type: "type", path: "resource" },
                        { type: "profile", path: "resource" },
                    ],
                    rules: "open",
                    slices: {
                        patient: {
                            min: 1,
                            max: 1,
                            match: { resource: { resourceType: "Patient" } },
                            nameCandidates: { candidates: ["Patient"], recommended: "Patient" },
                        },
                    },
                },
            },
            dependencies: [bundleId, entryId, referenceId],
        };
        const praxisBundle: ProfileTypeSchema = {
            identifier: praxisBundleId,
            base: epsBundleId,
            dependencies: [epsBundleId],
        };
        const index = mkTypeSchemaIndex(
            [
                bundle,
                { identifier: patientId },
                { identifier: practitionerId },
                { identifier: referenceId },
                epsBundle,
                praxisBundle,
            ],
            {},
        );

        const shaked = treeShake(index, {
            "de.cognovis.fhir.praxis": { [praxisBundleUrl]: { followReferences: false } },
        });

        expect(shaked.resolve(epsBundleId)?.slicing?.entry?.slices?.patient?.match).toEqual({
            resource: { resourceType: "Patient" },
        });
        expect(shaked.resolve(practitionerId)).toBeUndefined();
        expect(shaked.resolve(patientId)?.identifier).toEqual(patientId);
    });
});

describe("treeShake specific TypeSchema", async () => {
    const r4 = await mkR4Register();
    const logger = mkTestLogger();
    const patientTss = await resolveTs(
        r4,
        r4Package,
        "http://hl7.org/fhir/StructureDefinition/Patient" as CanonicalUrl,
        logger,
    );
    const patientOrigin = patientTss[0] as SpecializationTypeSchema;
    assert(patientOrigin !== undefined);

    it("Original Patient", () => {
        expect(JSON.stringify(patientOrigin, null, 2)).toMatchSnapshot();
    });

    it("No rule -- no change", () => {
        const patient = treeShakeTypeSchema(patientOrigin, {});
        expect(JSON.stringify(patient, null, 2)).toBe(JSON.stringify(patientOrigin, null, 2));
    });

    it("ignoreExtensions on non-profile schema is no-op", () => {
        const patient = treeShakeTypeSchema(patientOrigin, {
            ignoreExtensions: ["http://example.com/ext/race"],
        });
        expect(JSON.stringify(patient, null, 2)).toBe(JSON.stringify(patientOrigin, null, 2));
    });

    it("Select and Ignore fields should be mutually exclusive", () => {
        expect(() => {
            treeShakeTypeSchema(patientOrigin, {
                ignoreFields: ["gender", "link", "active", "address", "birthDate"],
                selectFields: ["name", "telecom", "gender", "birthDate"],
            });
        }).toThrowError("Cannot use both ignoreFields and selectFields in the same rule");
    });

    describe("ignoreFields", async () => {
        it("regular field", () => {
            const patient = treeShakeTypeSchema(patientOrigin, {
                ignoreFields: ["gender"],
            }) as SpecializationTypeSchema;
            expect(patientOrigin.fields?.gender).toBeDefined();
            expect(patient.fields?.gender).toBeUndefined();
            expect(JSON.stringify(patient, null, 2)).toMatchSnapshot();
        });

        describe("polimorphic field", () => {
            it("keeps the polymorphic field and its variants", () => {
                expect(patientOrigin.fields?.multipleBirth).toMatchObject({
                    choices: ["multipleBirthBoolean", "multipleBirthInteger"],
                });
                expect(patientOrigin.fields?.multipleBirthBoolean).toMatchObject({
                    type: { name: "boolean" },
                });
                expect(patientOrigin.fields?.multipleBirthInteger).toMatchObject({
                    type: { name: "integer" },
                });
            });

            it("choice declaration", () => {
                const patient = treeShakeTypeSchema(patientOrigin, {
                    ignoreFields: ["multipleBirth"],
                }) as SpecializationTypeSchema;
                expect(patient.fields?.multipleBirth).toBeUndefined();
                expect(patient.fields?.multipleBirthBoolean).toBeUndefined();
                expect(patient.fields?.multipleBirthInteger).toBeUndefined();
            });

            it("choice instance", () => {
                const patient = treeShakeTypeSchema(patientOrigin, {
                    ignoreFields: ["multipleBirthInteger"],
                }) as SpecializationTypeSchema;
                expect(patient.fields?.multipleBirth).toMatchObject({
                    choices: ["multipleBirthBoolean"],
                });
                expect(patient.fields?.multipleBirthBoolean).toMatchObject({
                    type: { name: "boolean" },
                });
                expect(patient.fields?.multipleBirthInteger).toBeUndefined();
            });
            it("all choice instance", () => {
                const patient = treeShakeTypeSchema(patientOrigin, {
                    ignoreFields: ["multipleBirthBoolean", "multipleBirthInteger"],
                }) as SpecializationTypeSchema;
                expect(patient.fields?.multipleBirth).toBeUndefined();
                expect(patient.fields?.multipleBirthBoolean).toBeUndefined();
                expect(patient.fields?.multipleBirthInteger).toBeUndefined();
            });
        });

        describe("edge cases", () => {
            it("non-existent field", () => {
                expect(() => {
                    treeShakeTypeSchema(patientOrigin, {
                        ignoreFields: ["nonExistentField"],
                    });
                }).toThrowError("Field nonExistentField not found");
            });

            it("empty ignoreFields array", () => {
                const patient = treeShakeTypeSchema(patientOrigin, {
                    ignoreFields: [],
                }) as SpecializationTypeSchema;
                expect(JSON.stringify(patient, null, 2)).toBe(JSON.stringify(patientOrigin, null, 2));
            });
        });
    });

    describe("selectFields", async () => {
        it("regular field", () => {
            const patient = treeShakeTypeSchema(patientOrigin, {
                selectFields: ["gender"],
            }) as SpecializationTypeSchema;
            expect(patient.fields?.gender).toBeDefined();
            expect(patient.fields?.name).toBeUndefined();
            expect(patient.fields?.birthDate).toBeUndefined();
            expect(patient.fields?.address).toBeUndefined();
            expect(JSON.stringify(patient, null, 2)).toMatchSnapshot();
        });

        it("multiple regular fields", () => {
            const patient = treeShakeTypeSchema(patientOrigin, {
                selectFields: ["gender", "birthDate", "active"],
            }) as SpecializationTypeSchema;
            expect(patient.fields?.gender).toBeDefined();
            expect(patient.fields?.birthDate).toBeDefined();
            expect(patient.fields?.active).toBeDefined();
            expect(patient.fields?.name).toBeUndefined();
            expect(patient.fields?.address).toBeUndefined();
            expect(patient.fields?.telecom).toBeUndefined();
            expect(JSON.stringify(patient, null, 2)).toMatchSnapshot();
        });

        describe("polymorphic field", () => {
            it("keeps the polymorphic field and its variants", () => {
                expect(patientOrigin.fields?.multipleBirth).toMatchObject({
                    choices: ["multipleBirthBoolean", "multipleBirthInteger"],
                });
                expect(patientOrigin.fields?.multipleBirthBoolean).toMatchObject({
                    type: { name: "boolean" },
                });
                expect(patientOrigin.fields?.multipleBirthInteger).toMatchObject({
                    type: { name: "integer" },
                });
            });

            it("choice declaration - get all polimorphic fields", () => {
                const patient = treeShakeTypeSchema(patientOrigin, {
                    selectFields: ["multipleBirth"],
                }) as SpecializationTypeSchema;

                expect(patient.fields?.multipleBirth).toMatchObject({
                    choices: ["multipleBirthBoolean", "multipleBirthInteger"],
                });
                expect(patient.fields?.multipleBirthBoolean).toMatchObject({
                    type: { name: "boolean" },
                });
                expect(patient.fields?.multipleBirthInteger).toMatchObject({
                    type: { name: "integer" },
                });
                expect(patient.fields?.gender).toBeUndefined();
                expect(patient.fields?.name).toBeUndefined();
            });

            it("choice instance", () => {
                const patient = treeShakeTypeSchema(patientOrigin, {
                    selectFields: ["multipleBirthBoolean"],
                }) as SpecializationTypeSchema;

                expect(patient.fields?.multipleBirth).toMatchObject({
                    choices: ["multipleBirthBoolean"],
                });
                expect(patient.fields?.multipleBirthBoolean).toMatchObject({
                    type: { name: "boolean" },
                });
                expect(patient.fields?.multipleBirthInteger).toBeUndefined();
                expect(patient.fields?.gender).toBeUndefined();
                expect(patient.fields?.name).toBeUndefined();
            });

            it("choice declaration & instance", () => {
                const patient = treeShakeTypeSchema(patientOrigin, {
                    selectFields: ["multipleBirth", "multipleBirthBoolean"],
                }) as SpecializationTypeSchema;

                expect(patient.fields?.multipleBirth).toMatchObject({
                    choices: ["multipleBirthBoolean"],
                });
                expect(patient.fields?.multipleBirthBoolean).toMatchObject({
                    type: { name: "boolean" },
                });
                expect(patient.fields?.multipleBirthInteger).toBeUndefined();
                expect(patient.fields?.gender).toBeUndefined();
                expect(patient.fields?.name).toBeUndefined();
            });
        });

        describe("edge cases", () => {
            it("empty selectFields array", () => {
                const patient = treeShakeTypeSchema(patientOrigin, {
                    selectFields: [],
                }) as SpecializationTypeSchema;

                expect(patient.fields).toEqual({});
            });

            it("non-existent field", () => {
                expect(() => {
                    treeShakeTypeSchema(patientOrigin, {
                        selectFields: ["nonExistentField"],
                    });
                }).toThrowError("Field nonExistentField not found");
            });
        });
    });
});

describe("ignoreExtensions", () => {
    const mkDep = (url: string): TypeIdentifier => ({
        kind: "complex-type",
        name: url.split("/").pop()! as Name,
        url: url as CanonicalUrl,
        package: "test",
        version: "1.0.0",
    });

    const mkProfileId = (url: string): ProfileIdentifier => ({
        kind: "profile",
        name: url.split("/").pop()! as Name,
        url: url as CanonicalUrl,
        package: "test",
        version: "1.0.0",
    });

    const mkProfile = (): ProfileTypeSchema => ({
        identifier: mkProfileId("http://example.com/TestProfile"),
        base: mkDep("http://hl7.org/fhir/StructureDefinition/Patient"),
        extensions: [
            {
                name: "race",
                path: "Patient.extension",
                url: "http://example.com/ext/race",
                profile: mkProfileId("http://example.com/ext/race"),
                valueFieldTypes: [mkDep("http://hl7.org/fhir/StructureDefinition/Coding")],
                nameCandidates: mkExtensionNameCandidates({ name: "race", path: "Patient.extension" }),
            },
            {
                name: "ethnicity",
                path: "Patient.extension",
                url: "http://example.com/ext/ethnicity",
                profile: mkProfileId("http://example.com/ext/ethnicity"),
                valueFieldTypes: [mkDep("http://hl7.org/fhir/StructureDefinition/CodeableConcept")],
                nameCandidates: mkExtensionNameCandidates({ name: "ethnicity", path: "Patient.extension" }),
            },
            {
                name: "birthsex",
                path: "Patient.extension",
                url: "http://example.com/ext/birthsex",
                profile: mkProfileId("http://example.com/ext/birthsex"),
                nameCandidates: mkExtensionNameCandidates({ name: "birthsex", path: "Patient.extension" }),
            },
        ],
    });

    it("removes matching extensions from profile", () => {
        const profile = mkProfile();
        const result = treeShakeTypeSchema(profile, {
            ignoreExtensions: ["http://example.com/ext/race"],
        }) as ProfileTypeSchema;
        expect(result.extensions).toHaveLength(2);
        expect(result.extensions?.find((e) => e.url === "http://example.com/ext/race")).toBeUndefined();
        expect(result.extensions?.find((e) => e.url === "http://example.com/ext/ethnicity")).toBeDefined();
        expect(result.extensions?.find((e) => e.url === "http://example.com/ext/birthsex")).toBeDefined();
    });

    it("throws error on non-existent extension URL", () => {
        const profile = mkProfile();
        expect(() => {
            treeShakeTypeSchema(profile, {
                ignoreExtensions: ["http://example.com/ext/nonexistent"],
            });
        }).toThrowError(
            "Extension http://example.com/ext/nonexistent not found in profile http://example.com/TestProfile",
        );
    });

    it("empty ignoreExtensions array is no-op", () => {
        const profile = mkProfile();
        const result = treeShakeTypeSchema(profile, {
            ignoreExtensions: [],
        }) as ProfileTypeSchema;
        expect(result.extensions).toHaveLength(3);
    });

    it("dependencies are recalculated (ignored extension deps not in output)", () => {
        const profile = mkProfile();
        const result = treeShakeTypeSchema(profile, {
            ignoreExtensions: ["http://example.com/ext/race"],
        }) as ProfileTypeSchema;
        // Coding was only a dep of the "race" extension, so it should be gone
        expect(
            result.dependencies?.find((d) => d.url === "http://hl7.org/fhir/StructureDefinition/Coding"),
        ).toBeUndefined();
        // race definition identifier should be gone
        expect(result.dependencies?.find((d) => d.url === "http://example.com/ext/race")).toBeUndefined();
        // CodeableConcept is still a dep of the "ethnicity" extension
        expect(
            result.dependencies?.find((d) => d.url === "http://hl7.org/fhir/StructureDefinition/CodeableConcept"),
        ).toBeDefined();
        // ethnicity definition identifier should still be there
        expect(result.dependencies?.find((d) => d.url === "http://example.com/ext/ethnicity")).toBeDefined();
        // Patient base dep should still be there
        expect(
            result.dependencies?.find((d) => d.url === "http://hl7.org/fhir/StructureDefinition/Patient"),
        ).toBeDefined();
    });

    it("removing all extensions sets extensions to undefined", () => {
        const profile = mkProfile();
        const result = treeShakeTypeSchema(profile, {
            ignoreExtensions: [
                "http://example.com/ext/race",
                "http://example.com/ext/ethnicity",
                "http://example.com/ext/birthsex",
            ],
        }) as ProfileTypeSchema;
        expect(result.extensions).toBeUndefined();
    });
});
