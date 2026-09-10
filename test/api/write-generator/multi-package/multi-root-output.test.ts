import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as Path from "node:path";
import { pathToFileURL } from "node:url";
import { APIBuilder, type GenerationReport } from "@root/api/builder";
import { parseGenerateConfig, runGenerateConfig } from "@root/api/generate-config";
import { mkSilentLogger } from "@typeschema-test/utils";

const roots = {
    provenance: {
        package: { name: "fixture.multi-root.provenance", version: "1.0.0" },
        path: Path.join(__dirname, "../../../assets/profile-inherited-required"),
        dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
    },
    serviceRequest: {
        package: { name: "fixture.multi-root.service-request", version: "1.0.0" },
        path: Path.join(__dirname, "../../../assets/profile-optional-constraint"),
        dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
    },
};

const generateFromApi = async (order: (keyof typeof roots)[]): Promise<GenerationReport> => {
    let builder = new APIBuilder({ logger: mkSilentLogger() });
    for (const key of order) builder = builder.localStructureDefinitions(roots[key]);
    return builder
        .typescript({
            inMemoryOnly: true,
            generateProfile: true,
            withDebugComment: false,
            moduleSpecifierStyle: "node-esm",
            terminology: {
                enabled: true,
                packages: ["hl7.fhir.r4.core@4.0.1"],
                packageVerification: { "hl7.fhir.r4.core@4.0.1": "registry-integrity" },
            },
        })
        .generate();
};

const typeScriptFiles = (report: GenerationReport): Record<string, string> => report.filesGenerated.typescript ?? {};

const packageInventory = (files: Record<string, string>): string[] =>
    [
        ...new Set(
            Object.keys(files).flatMap((path) => {
                const match = path.replaceAll("\\", "/").match(/\/types\/([^/]+)\//);
                return match?.[1] ? [match[1]] : [];
            }),
        ),
    ].sort();

const normalizedTypeScriptFileMap = (files: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
        Object.entries(files)
            .map(([path, content]) => {
                const normalizedPath = path.replaceAll("\\", "/");
                const typesMarker = "/types/";
                const markerIndex = normalizedPath.lastIndexOf(typesMarker);
                if (markerIndex < 0) throw new Error(`generated path has no types directory: ${path}`);
                return [normalizedPath.slice(markerIndex + typesMarker.length), content] as const;
            })
            .sort(([left], [right]) => left.localeCompare(right)),
    );

/**
 * Worked example source: codegen-za2 Acceptance Criteria 1 and 2.
 * Pointer: codegen-za2/acceptance-criteria/1-2/shared-r4-diamond.
 * The two fixture roots both declare hl7.fhir.r4.core@4.0.1 and are expected as sibling package directories.
 */
describe("flat TypeScript output for a local multi-root diamond", async () => {
    const forward = await generateFromApi(["provenance", "serviceRequest"]);
    const reversed = await generateFromApi(["serviceRequest", "provenance"]);
    const projectionDir = await fs.mkdtemp(Path.join(os.tmpdir(), "codegen-za2-multi-root-"));
    afterAll(() => fs.rm(projectionDir, { recursive: true, force: true }));
    for (const [relativePath, content] of Object.entries(typeScriptFiles(forward))) {
        const destination = Path.join(projectionDir, relativePath);
        await fs.mkdir(Path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, content);
    }
    await fs.writeFile(Path.join(projectionDir, "package.json"), JSON.stringify({ type: "module" }));

    it("emits one deterministic sibling directory per package identity", () => {
        expect(forward.success).toBeTrue();
        expect(packageInventory(typeScriptFiles(forward))).toEqual([
            "fixture-multi-root-provenance",
            "fixture-multi-root-service-request",
            "hl7-fhir-r4-core",
        ]);
        expect(typeScriptFiles(reversed)).toEqual(typeScriptFiles(forward));
    });

    it("shares the profile helper and imports the common core package relatively", () => {
        const files = typeScriptFiles(forward);
        expect(Object.keys(files).filter((path) => path.endsWith("/profile-helpers.ts"))).toHaveLength(1);
        expect(Object.keys(files).filter((path) => path.endsWith("/terminology-types.ts"))).toHaveLength(1);
        expect(Object.keys(files).filter((path) => path.endsWith("/terminology.ts"))).toEqual([
            "generated/types/hl7-fhir-r4-core/terminology.ts",
        ]);
        const profileSources = Object.entries(files)
            .filter(([path]) => path.includes("/profiles/"))
            .map(([, source]) => source)
            .join("\n");
        expect(profileSources).toContain("../../hl7-fhir-r4-core/");
        const serviceRequestProfile = Object.entries(files).find(([path]) =>
            path.endsWith("profiles/ServiceRequest_OptionalCategoryServiceRequest.ts"),
        )?.[1];
        expect(serviceRequestProfile).toContain("RequestIntentCodeSystem");
        expect(serviceRequestProfile).toMatch(
            /validateEnum\(res, profileName, "intent", \[\.\.\.RequestIntentCodeSystem[^.]*\.codes\]\)/,
        );
    });

    it("produces the complete same generated file map through parsed JSON configuration", async () => {
        const raw = JSON.parse(
            JSON.stringify({
                version: 1,
                builders: [
                    {
                        name: "shared-types",
                        localStructureDefinitions: Object.values(roots),
                        typescript: {
                            inMemoryOnly: true,
                            generateProfile: true,
                            withDebugComment: false,
                            moduleSpecifierStyle: "node-esm",
                            terminology: {
                                enabled: true,
                                packages: ["hl7.fhir.r4.core@4.0.1"],
                                packageVerification: { "hl7.fhir.r4.core@4.0.1": "registry-integrity" },
                            },
                        },
                        outputTo: "./generated/types",
                    },
                ],
            }),
        );
        const config = parseGenerateConfig(raw, Path.join(process.cwd(), "codegen.json"));
        const result = await runGenerateConfig(config, { logger: mkSilentLogger() });
        const report = result.builders[0]?.report;

        expect(result.success).toBeTrue();
        expect(report).toBeDefined();
        expect(normalizedTypeScriptFileMap(typeScriptFiles(report!))).toEqual(
            normalizedTypeScriptFileMap(typeScriptFiles(forward)),
        );
    });

    it("compiles the actual shared output under NodeNext and Bundler resolution", async () => {
        const sourceFiles = Object.keys(typeScriptFiles(forward)).map((path) => Path.join(projectionDir, path));
        const compile = async (module: "NodeNext" | "ESNext", moduleResolution: "NodeNext" | "Bundler") => {
            const proc = Bun.spawn(
                [
                    "bunx",
                    "tsc",
                    "--noEmit",
                    "--strict",
                    "--skipLibCheck",
                    "--target",
                    "ES2022",
                    "--module",
                    module,
                    "--moduleResolution",
                    moduleResolution,
                    ...sourceFiles,
                ],
                { stdout: "pipe", stderr: "pipe" },
            );
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ]);
            return { exitCode, output: `${stdout}\n${stderr}`.trim() };
        };

        const nodeNext = await compile("NodeNext", "NodeNext");
        const bundler = await compile("ESNext", "Bundler");
        expect(nodeNext.output).toBe("");
        expect(nodeNext.exitCode).toBe(0);
        expect(bundler.output).toBe("");
        expect(bundler.exitCode).toBe(0);
    });

    it("loads a generated profile in Node ESM and rejects invalid input", async () => {
        const transpiler = new Bun.Transpiler({ loader: "ts" });
        for (const relativePath of Object.keys(typeScriptFiles(forward))) {
            const sourcePath = Path.join(projectionDir, relativePath);
            await fs.writeFile(
                sourcePath.replace(/\.ts$/, ".js"),
                transpiler.transformSync(await fs.readFile(sourcePath, "utf8")),
            );
        }
        const profilePath = Object.keys(typeScriptFiles(forward)).find((path) =>
            path.endsWith("profiles/ServiceRequest_OptionalCategoryServiceRequest.ts"),
        );
        if (!profilePath) throw new Error("generated ServiceRequest profile is missing");
        const profileUrl = pathToFileURL(Path.join(projectionDir, profilePath.replace(/\.ts$/, ".js"))).href;
        const script = `
            const { OptionalCategoryServiceRequestProfile: Profile } = await import(${JSON.stringify(profileUrl)});
            const valid = {
                resourceType: "ServiceRequest",
                meta: { profile: ["http://example.test/StructureDefinition/optional-category-service-request"] },
                status: "active",
                intent: "order",
                subject: { reference: "Patient/example" }
            };
            Profile.from(valid);
            try {
                Profile.from({ ...valid, intent: "not-a-request-intent" });
                console.error("out-of-system intent was accepted");
                process.exit(4);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes("is not in allowed values")) {
                    console.error("enum-linked terminology error missing: " + message);
                    process.exit(5);
                }
                if (!message.includes("does not match expected fixed value")) {
                    console.error("fixed-profile error missing: " + message);
                    process.exit(6);
                }
            }
        `;
        const proc = Bun.spawn(["node", "--input-type=module", "-e", script], { stdout: "pipe", stderr: "pipe" });
        const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
    });
});
