import { describe, expect, it } from "bun:test";
import type { CanonicalManager } from "@atomic-ehr/fhir-canonical-manager";
import { APIBuilder } from "@root/api/builder";
import { TypeScript } from "@root/api/writer-generator/typescript/writer";
import { generateTypeSchemas } from "@root/typeschema";
import type { Register } from "@root/typeschema/register";
import type { CanonicalUrl, Name, RichFHIRSchema, TypeIdentifier, TypeSchema } from "@root/typeschema/types";
import { mkTypeSchemaIndex } from "@root/typeschema/utils";
import { mkSilentLogger } from "@typeschema-test/utils";
import manifestRootA from "../../../assets/multi-root-packages/manifest-root-a/package.json" with { type: "json" };
import manifestRootB from "../../../assets/multi-root-packages/manifest-root-b/package.json" with { type: "json" };
import manifestSharedV2 from "../../../assets/multi-root-packages/manifest-shared-v2/package.json" with {
    type: "json",
};
import sameCanonicalV1 from "../../../assets/multi-root-packages/same-canonical-v1.fs.json" with { type: "json" };
import sameCanonicalV2 from "../../../assets/multi-root-packages/same-canonical-v2.fs.json" with { type: "json" };

describe("APIBuilder multi-root package identities", () => {
    /**
     * Worked example source: codegen-za2 Acceptance Criterion 3, version semantics.
     * Pointer: codegen-za2/acceptance-criteria/3.
     * Literal root identities: fixture.same@1.0.0 and fixture.same@2.0.0.
     */
    it("rejects two requested versions of one root package with both identities", async () => {
        const manager = {
            addPackages: async () => {
                throw new Error("resolver was reached before conflicting roots were rejected");
            },
        } as unknown as ReturnType<typeof CanonicalManager>;

        const report = await new APIBuilder({ manager, logger: mkSilentLogger() })
            .fromPackage("fixture.same", "1.0.0")
            .fromPackage("fixture.same", "2.0.0")
            .generate();

        expect(report.success).toBeFalse();
        expect(report.errors.join("\n")).toContain("fixture.same@1.0.0");
        expect(report.errors.join("\n")).toContain("fixture.same@2.0.0");
        expect(report.errors.join("\n")).toMatch(/conflict|different versions|multiple versions/i);
    });

    /**
     * Generated fixture sources: test/assets/multi-root-packages/manifest-root-a/package.json,
     * test/assets/multi-root-packages/manifest-root-b/package.json, and
     * test/assets/multi-root-packages/manifest-shared-v2/package.json.
     * Selectors: both root $.dependencies.fixture.manifest.shared declarations and the resolved
     * shared package $.name + $.version = fixture.manifest.shared@2.0.0.
     */
    it("accepts one resolved dependency identity despite differing root manifest declarations", async () => {
        const manifests: Record<string, Record<string, unknown>> = {
            [manifestRootA.name]: manifestRootA,
            [manifestRootB.name]: manifestRootB,
            [manifestSharedV2.name]: manifestSharedV2,
        };
        const manager = {
            addPackages: async () => ({}),
            init: async () => ({
                [`${manifestRootA.name}@${manifestRootA.version}`]: {
                    name: manifestRootA.name,
                    version: manifestRootA.version,
                },
                [`${manifestRootB.name}@${manifestRootB.version}`]: {
                    name: manifestRootB.name,
                    version: manifestRootB.version,
                },
                [`${manifestSharedV2.name}@${manifestSharedV2.version}`]: {
                    name: manifestSharedV2.name,
                    version: manifestSharedV2.version,
                },
            }),
            packageJson: async (packageName: string) => manifests[packageName] ?? {},
            search: async () => [],
        } as unknown as ReturnType<typeof CanonicalManager>;

        const report = await new APIBuilder({ manager, logger: mkSilentLogger() })
            .fromPackage(manifestRootA.name, manifestRootA.version)
            .fromPackage(manifestRootB.name, manifestRootB.version)
            .generate();

        expect(report.success).toBeTrue();
        expect(report.errors).toEqual([]);
    });

    /**
     * Generated fixture sources: test/assets/multi-root-packages/same-canonical-v1.fs.json and
     * test/assets/multi-root-packages/same-canonical-v2.fs.json.
     * Selectors: $.package_meta and $.url.
     * Literal concrete identities:
     * fixture.same-canonical@1.0.0|https://fixture.example/fhir/StructureDefinition/SharedRecord
     * fixture.same-canonical@2.0.0|https://fixture.example/fhir/StructureDefinition/SharedRecord
     */
    it("rejects schemas sharing a canonical across concrete package versions", async () => {
        const register = {
            allFs: () => [sameCanonicalV1, sameCanonicalV2] as RichFHIRSchema[],
            allVs: () => [],
        } as unknown as Register;

        const problems: string[] = [];
        try {
            const result = await generateTypeSchemas(register);
            const generated = result.schemas
                .map(({ identifier }) => `${identifier.package}@${identifier.version}|${identifier.url}`)
                .sort();
            problems.push(`expected rejection; generated ${generated.join(", ")}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            for (const token of [
                "fixture.same-canonical@1.0.0",
                "fixture.same-canonical@2.0.0",
                "https://fixture.example/fhir/StructureDefinition/SharedRecord",
            ]) {
                if (!message.includes(token)) problems.push(`diagnostic omitted ${token}`);
            }
            if (!/conflict|different versions|multiple versions|unsupported/i.test(message)) {
                problems.push("diagnostic did not explain the unsupported version conflict");
            }
        }

        expect(problems).toEqual([]);
    });

    /**
     * Worked example source: codegen-za2 Acceptance Criterion 3, collision-safe package directories.
     * Pointer: codegen-za2/acceptance-criteria/3/physical-package-identity.
     * Literal allocated directories: fixture-versioned-1-0-0, fixture-versioned-2-0-0,
     * fixture-collision--1, and fixture-collision--2.
     */
    it("allocates deterministic directories for versions and sanitized-name collisions", async () => {
        const identifier = (packageName: string, version: string, name: string, url: string): TypeIdentifier => ({
            kind: "logical",
            package: packageName,
            version,
            name: name as Name,
            url: url as CanonicalUrl,
        });
        const makeSchemas = (): TypeSchema[] => {
            const versionOne = identifier(
                "fixture.versioned",
                "1.0.0",
                "VersionOne",
                "https://fixture.test/VersionOne",
            );
            const collisionBase = identifier(
                "fixture-collision",
                "1.0.0",
                "CollisionBase",
                "https://fixture.test/CollisionBase",
            );
            return [
                { identifier: versionOne },
                {
                    identifier: identifier(
                        "fixture.versioned",
                        "2.0.0",
                        "VersionTwo",
                        "https://fixture.test/VersionTwo",
                    ),
                    base: versionOne,
                    dependencies: [versionOne],
                },
                { identifier: collisionBase },
                {
                    identifier: identifier(
                        "fixture.collision",
                        "1.0.0",
                        "CollisionChild",
                        "https://fixture.test/CollisionChild",
                    ),
                    base: collisionBase,
                    dependencies: [collisionBase],
                },
            ] as TypeSchema[];
        };
        const render = async (schemas: TypeSchema[]): Promise<Record<string, string>> => {
            const writer = new TypeScript({
                outputDir: "generated/types",
                inMemoryOnly: true,
                tabSize: 4,
                commentLinePrefix: "//",
                logger: mkSilentLogger(),
                openResourceTypeSet: false,
                primitiveTypeExtension: true,
                generateProfile: true,
                moduleSpecifierStyle: "node-esm",
            });
            await writer.generateAsync(mkTypeSchemaIndex(schemas, { logger: mkSilentLogger() }));
            return Object.fromEntries(writer.writtenFiles().map(({ relPath, content }) => [relPath, content]));
        };

        const forward = await render(makeSchemas());
        const reversed = await render(makeSchemas().reverse());

        expect(reversed).toEqual(forward);
        expect(Object.keys(forward).sort()).toEqual([
            "generated/types/fixture-collision--1/CollisionBase.ts",
            "generated/types/fixture-collision--1/index.ts",
            "generated/types/fixture-collision--2/CollisionChild.ts",
            "generated/types/fixture-collision--2/index.ts",
            "generated/types/fixture-versioned-1-0-0/VersionOne.ts",
            "generated/types/fixture-versioned-1-0-0/index.ts",
            "generated/types/fixture-versioned-2-0-0/VersionTwo.ts",
            "generated/types/fixture-versioned-2-0-0/index.ts",
        ]);
        expect(forward["generated/types/fixture-versioned-2-0-0/VersionTwo.ts"]).toContain(
            'from "../fixture-versioned-1-0-0/VersionOne.js"',
        );
        expect(forward["generated/types/fixture-collision--2/CollisionChild.ts"]).toContain(
            'from "../fixture-collision--1/CollisionBase.js"',
        );
    });
});
