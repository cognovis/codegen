import { describe, expect, it } from "bun:test";
import { APIBuilder } from "@root/api/builder";
import type { ValueSet } from "@root/fhir-types/hl7-fhir-r4-core";
import type { Register } from "@root/typeschema/register";
import { type CanonicalUrl, enrichValueSet, type PackageMeta, packageMetaToFhir } from "@root/typeschema/types";
import {
    ccdaManager,
    mkErrorLogger,
    mkR4Register,
    type PFS,
    type PVS,
    r4Manager,
    registerFs,
} from "@typeschema-test/utils";
import { applyFixedValue } from "../../../assets/api/writer-generator/typescript/profile-helpers";

const appendValueSet = (register: Register, pkg: PackageMeta, valueSet: PVS) => {
    const richValueSet = enrichValueSet(valueSet as ValueSet, pkg);
    register.resolver[packageMetaToFhir(pkg)]!.valueSets[richValueSet.url] = richValueSet;
};

describe("TypeScript Writer Generator", async () => {
    const result = await new APIBuilder({ register: await r4Manager(), logger: mkErrorLogger() })
        .typescript({
            inMemoryOnly: true,
            moduleSpecifierStyle: "node-esm",
        })
        .generate();
    const files = result.filesGenerated.typescript!;

    it("generates 638 files including all R4 core colliding profiles", () => {
        // Previous 608 files + 53 definitions in 23 shared-name groups - 23 existing files (cognovis/codegen#18).
        expect(result.success).toBeTrue();
        expect(Object.keys(files).length).toEqual(638);
    });

    it("generates Patient resource in inMemoryOnly mode with snapshot", async () => {
        expect(files["generated/types/hl7-fhir-r4-core/Patient.ts"]).toMatchSnapshot();
    });
    it("generates Coding with generic parameter", async () => {
        const codingTs = files["generated/types/hl7-fhir-r4-core/Coding.ts"];
        expect(codingTs).toContain("export interface Coding<T extends string = string>");
        expect(codingTs).toContain("code?: T");
        expect(codingTs).toMatchSnapshot();
    });
    it("generates CodeableConcept with generic parameter", async () => {
        const ccTs = files["generated/types/hl7-fhir-r4-core/CodeableConcept.ts"];
        expect(ccTs).toContain("export interface CodeableConcept<T extends string = string>");
        expect(ccTs).toContain("coding?: Coding<T>[]");
        expect(ccTs).toMatchSnapshot();
    });
    it("generates BundleEntry with generic type-family parameters", async () => {
        const bundleTs = files["generated/types/hl7-fhir-r4-core/Bundle.ts"];
        expect(bundleTs).toContain(
            "export interface BundleEntry<T1 extends Resource = Resource, T2 extends Resource = Resource>",
        );
        expect(bundleTs).toContain("resource?: T1");
        expect(bundleTs).toContain("response?: BundleEntryResponse<T2>");
        expect(bundleTs).toMatchSnapshot();
    });
    it("generates Bundle with inherited generic params from BundleEntry", async () => {
        const bundleTs = files["generated/types/hl7-fhir-r4-core/Bundle.ts"];
        expect(bundleTs).toContain(
            "export interface Bundle<T1 extends Resource = Resource, T2 extends Resource = Resource>",
        );
        expect(bundleTs).toContain("entry?: BundleEntry<T1, T2>[]");
        expect(bundleTs).toMatchSnapshot();
    });
    it("generates BundleEntryResponse with generic type-family parameter", async () => {
        const bundleTs = files["generated/types/hl7-fhir-r4-core/Bundle.ts"];
        expect(bundleTs).toContain("export interface BundleEntryResponse<T extends Resource = Resource>");
        expect(bundleTs).toContain("outcome?: T");
    });
    it("generates DomainResource with generic type-family parameter", async () => {
        const domainResourceTs = files["generated/types/hl7-fhir-r4-core/DomainResource.ts"];
        expect(domainResourceTs).toContain("export interface DomainResource<T extends Resource = Resource>");
        expect(domainResourceTs).toContain("contained?: T[]");
    });
});

describe("TypeScript profile fixed CodeableConcept semantics", async () => {
    const fixedSystem = "http://example.org/CodeSystem/coverage-type";
    const secondarySystem = "http://example.org/CodeSystem/hzv-contract";

    it("applies fixed CodeableConcept codings without dropping compatible secondary codings", () => {
        const resource = {
            type: {
                text: "Private coverage",
                coding: [
                    { system: fixedSystem, code: "PKV", display: "Private insurance" },
                    { system: secondarySystem, code: "AOK_BY_HZV" },
                ],
            },
        };

        applyFixedValue(resource, "type", {
            coding: [{ system: fixedSystem }],
        });

        expect(resource.type).toEqual({
            text: "Private coverage",
            coding: [
                { system: fixedSystem, code: "PKV", display: "Private insurance" },
                { system: secondarySystem, code: "AOK_BY_HZV" },
            ],
        });
    });

    it("generates apply() with fixed-value merge and skips placeholder-only enum validation", async () => {
        const register = await mkR4Register();
        const pkg = { name: "codegen.test", version: "1.0.0" };
        const placeholderValueSetUrl = "http://example.org/ValueSet/placeholder-coverage-type";
        const profileUrl = "http://example.org/StructureDefinition/fixed-coverage";
        const profile: PFS = {
            description: "Coverage profile with fixed CodeableConcept coding and placeholder-only binding",
            derivation: "constraint",
            type: "Coverage",
            name: "FixedCoverage",
            kind: "resource",
            url: profileUrl,
            base: "http://hl7.org/fhir/StructureDefinition/Coverage",
            package_meta: pkg,
            required: ["type"],
            elements: {
                type: {
                    type: "CodeableConcept",
                    binding: {
                        strength: "required",
                        valueSet: placeholderValueSetUrl,
                        bindingName: "PlaceholderCoverageType",
                    },
                    elements: {
                        coding: {
                            slicing: {
                                slices: {
                                    InsuranceType: {
                                        min: 1,
                                        match: { system: fixedSystem, code: "PKV" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        registerFs(register, profile);
        appendValueSet(register, pkg, {
            resourceType: "ValueSet",
            id: "placeholder-coverage-type",
            name: "PlaceholderCoverageType",
            url: placeholderValueSetUrl,
            status: "active",
            expansion: {
                timestamp: "2026-01-01T00:00:00Z",
                contains: [{ system: "http://terminology.hl7.org/CodeSystem/v3-NullFlavor", code: "UNK" }],
            },
        });

        const result = await new APIBuilder({ register, logger: mkErrorLogger() })
            .typescript({
                inMemoryOnly: true,
                withDebugComment: false,
                generateProfile: true,
                openResourceTypeSet: false,
            })
            .generate();

        expect(result.success).toBeTrue();
        const files = result.filesGenerated.typescript!;
        const profileFile = Object.entries(files).find(([path]) => path.endsWith("profiles/Coverage_FixedCoverage.ts"));
        expect(profileFile).toBeDefined();
        const profileTs = profileFile![1];

        expect(profileTs).toContain(
            `applyFixedValue(resource, "type", {"coding":[{"system":"${fixedSystem}","code":"PKV"}]})`,
        );
        expect(profileTs).not.toContain("Object.assign(resource");
        expect(profileTs).not.toContain(`validateEnum(res, profileName, "type", ["UNK"])`);
        expect(profileTs).not.toContain(`CodeableConcept<("UNK")>`);
    });
});

describe("TypeScript CDA with Logical Model Promotion to Resource", async () => {
    const result = await new APIBuilder({ register: await ccdaManager(), logger: mkErrorLogger() })
        .typeSchema({
            promoteLogical: {
                "hl7.cda.uv.core": ["http://hl7.org/cda/stds/core/StructureDefinition/Material" as CanonicalUrl],
            },
        })
        .typescript({
            inMemoryOnly: true,
            moduleSpecifierStyle: "node-esm",
        })
        .generate();
    const files = result.filesGenerated.typescript!;

    it("generates successfully", () => {
        expect(result.success).toBeTrue();
    });

    it("without resourceType", async () => {
        expect(files["generated/types/hl7-cda-uv-core/CV.ts"]).toMatchSnapshot();
        expect(files["generated/types/hl7-cda-uv-core/index.ts"]).toMatchSnapshot();
        expect(files["generated/types/hl7-cda-uv-core/profiles/index.ts"]).toMatchSnapshot();
    });
    it("with resourceType", async () => {
        expect(files["generated/types/hl7-cda-uv-core/Material.ts"]).toMatchSnapshot();
    });
});

describe("TypeScript R4 Example (with generateProfile)", async () => {
    const logger = mkErrorLogger();
    const result = await new APIBuilder({ register: await r4Manager(), logger })
        .typescript({
            inMemoryOnly: true,
            withDebugComment: false,
            generateProfile: true,
            openResourceTypeSet: false,
            moduleSpecifierStyle: "node-esm",
        })
        .generate();

    it("generates successfully", () => {
        expect(result.success).toBeTrue();
    });

    const files = result.filesGenerated.typescript!;
    const profileDir = "generated/types/hl7-fhir-r4-core/profiles/";

    it("keeps valueset-label at the shared name and exports codesystem-label by canonical name", () => {
        // FHIR R4 core StructureDefinitions: /codesystem-label and /valueset-label; issue cognovis/codegen#18.
        const shared = files[`${profileDir}Extension_label.ts`];
        const additional = files[`${profileDir}Extension_codesystem_label.ts`];
        const profileIndex = files[`${profileDir}index.ts`];
        const packageIndex = files["generated/types/hl7-fhir-r4-core/index.ts"];
        expect(shared).toContain(
            'static readonly canonicalUrl = "http://hl7.org/fhir/StructureDefinition/valueset-label"',
        );
        expect(additional).toBeDefined();
        expect(additional).toContain(
            'static readonly canonicalUrl = "http://hl7.org/fhir/StructureDefinition/codesystem-label"',
        );
        expect(additional).toContain("export class codesystem_labelProfile");
        expect(profileIndex).toContain("Extension_codesystem_label");
        expect(packageIndex).toContain('export * from "./profiles/index.js"');
    });

    it("retains all 53 definitions in 23 R4 core collision groups and reports their canonicals", async () => {
        // Independent oracle: hl7.fhir.r4.core@4.0.1 StructureDefinition URLs and names in the package register.
        const core = (await r4Manager())
            .allFs()
            .filter(
                (fs) =>
                    fs.package_meta.name === "hl7.fhir.r4.core" &&
                    fs.derivation === "constraint" &&
                    (fs.kind === "complex-type" || fs.kind === "resource") &&
                    fs.type &&
                    fs.name &&
                    fs.url,
            );
        const groups = new Map<string, typeof core>();
        for (const fs of core) {
            const name = `${fs.type}_${fs.name.replace(/[- :.]/g, "_")}`;
            const group = groups.get(name) ?? [];
            group.push(fs);
            groups.set(name, group);
        }
        const collisions = [...groups].filter(([, group]) => group.length > 1);
        expect(collisions).toHaveLength(23);
        expect(collisions.reduce((count, [, group]) => count + group.length, 0)).toBe(53);
        const report = logger.buffer().map((entry) => entry.message);
        const index = files[`${profileDir}index.ts`];
        for (const [name, group] of collisions) {
            const winner = [...group]
                .sort((a, b) => {
                    if (a.url! < b.url!) return -1;
                    if (a.url! > b.url!) return 1;
                    return 0;
                })
                .at(-1)!;
            expect(files[`${profileDir}${name}.ts`]).toContain(`static readonly canonicalUrl = "${winner.url}"`);
            for (const fs of group) {
                const matching = Object.entries(files).filter(
                    ([path, source]) =>
                        path.startsWith(profileDir) &&
                        path.endsWith(".ts") &&
                        !path.endsWith("index.ts") &&
                        source.includes(`static readonly canonicalUrl = "${fs.url}"`),
                );
                expect(matching).toHaveLength(1);
                expect(index).toContain(matching[0]![0].slice(profileDir.length, -3));
            }
            expect(
                report.some((message) => message.includes(name) && group.every((fs) => message.includes(fs.url!))),
            ).toBeTrue();
        }
        expect(
            report.filter((message) => message.includes("File will be rewritten") && message.includes("/profiles/")),
        ).toEqual([]);
    });

    it("generates bodyweight profile with validate()", () => {
        // Non-colliding R4 core observation-bodyweight profile; pinned in test/api/write-generator/__snapshots__/typescript.test.ts.snap.
        const src = files["generated/types/hl7-fhir-r4-core/profiles/Observation_observation_bodyweight.ts"];
        expect(src).toContain('static readonly resourceType = "Observation"');
        expect(src).toMatchSnapshot();
    });

    it("generates bp profile with validate()", () => {
        const src = files["generated/types/hl7-fhir-r4-core/profiles/Observation_observation_bp.ts"];
        expect(src).toContain('static readonly resourceType = "Observation"');
        expect(src).toMatchSnapshot();
    });
});

describe("TypeScript profile collision input order", () => {
    it("generates identical profile files and indexes when colliding definitions arrive in reverse order", async () => {
        // Worked example: cognovis/codegen#18 canonical code-unit rule, two Extension profiles in one package.
        const pkg = { name: "example.collision", version: "1.0.0" };
        const profiles: PFS[] = ["alpha", "zeta"].map((suffix) => ({
            description: `Order probe ${suffix}`,
            derivation: "constraint",
            kind: "complex-type",
            type: "Extension",
            name: "OrderProbe",
            url: `http://example.org/StructureDefinition/${suffix}`,
            base: "http://hl7.org/fhir/StructureDefinition/Extension",
            package_meta: pkg,
            elements: {},
        }));
        const generate = async (ordered: PFS[]) => {
            const register = await mkR4Register();
            for (const profile of ordered) registerFs(register, profile);
            const result = await new APIBuilder({ register, logger: mkErrorLogger() })
                .typescript({ inMemoryOnly: true, generateProfile: true, withDebugComment: false })
                .generate();
            expect(result.success).toBeTrue();
            return Object.fromEntries(
                Object.entries(result.filesGenerated.typescript!).filter(
                    ([path]) =>
                        path.startsWith("generated/types/example-collision/profiles/") ||
                        path === "generated/types/example-collision/index.ts",
                ),
            );
        };
        const forward = await generate(profiles);
        const reversed = await generate([...profiles].reverse());
        expect(forward).toEqual(reversed);
        const shared = forward["generated/types/example-collision/profiles/Extension_OrderProbe.ts"];
        expect(shared).toContain('static readonly canonicalUrl = "http://example.org/StructureDefinition/zeta"');
        expect(forward["generated/types/example-collision/profiles/Extension_alpha.ts"]).toContain(
            'static readonly canonicalUrl = "http://example.org/StructureDefinition/alpha"',
        );
    });
});

describe("TypeScript US Core Example", async () => {
    const logger = mkErrorLogger();
    const result = await new APIBuilder({ logger })
        .fromPackage("hl7.fhir.us.core", "8.0.1")
        .typeSchema({
            treeShake: {
                "hl7.fhir.us.core": {
                    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient": {},
                    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure": {},
                    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-body-weight": {},
                    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity": {},
                    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race": {},
                    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-tribal-affiliation": {},
                    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-individual-sex": {},
                    "http://hl7.org/fhir/us/core/StructureDefinition/us-core-interpreter-needed": {},
                },
            },
        })
        .typescript({
            inMemoryOnly: true,
            withDebugComment: false,
            generateProfile: true,
            openResourceTypeSet: false,
            moduleSpecifierStyle: "node-esm",
        })
        .generate();

    it("generates successfully", () => {
        expect(result.success).toBeTrue();
    });

    const files = result.filesGenerated.typescript!;

    it("generates US Core Patient profile", () => {
        const src = files["generated/types/hl7-fhir-us-core/profiles/Patient_USCorePatientProfile.ts"];
        expect(src).toContain('static readonly resourceType = "Patient"');
        expect(src).toMatchSnapshot();
    });

    it("generates US Core Blood Pressure profile", () => {
        expect(
            files["generated/types/hl7-fhir-us-core/profiles/Observation_USCoreBloodPressureProfile.ts"],
        ).toMatchSnapshot();
    });

    it("generates US Core Body Weight profile", () => {
        const key = "generated/types/hl7-fhir-us-core/profiles/Observation_USCoreBodyWeightProfile.ts";
        expect(files[key]).toMatchSnapshot();
    });

    it("generates US Core Race extension profile", () => {
        const key = "generated/types/hl7-fhir-us-core/profiles/Extension_USCoreRaceExtension.ts";
        expect(files[key]).not.toContain("static readonly resourceType");
        expect(files[key]).toMatchSnapshot();
    });

    it("generates US Core profiles index", () => {
        expect(files["generated/types/hl7-fhir-us-core/profiles/index.ts"]).toMatchSnapshot();
    });
});
