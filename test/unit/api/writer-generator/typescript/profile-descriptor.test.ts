import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APIBuilder } from "@root/api/builder";
import { mkErrorLogger, r4Manager } from "@typeschema-test/utils";

const PROFILE_PATH = "generated/types/hl7-fhir-r4-core/profiles/Observation_observation_bodyweight.ts";
const PROFILE_IMPORT = "./generated/types/hl7-fhir-r4-core/profiles/Observation_observation_bodyweight";

const consumerSource = `import { observation_bodyweightProfile } from "${PROFILE_IMPORT}";

type ProfileDescriptor = {
    readonly resourceType: string;
    readonly canonicalUrl: string;
    from: (resource: never) => unknown;
    createResource: (args: never) => unknown;
};

const _descriptor: ProfileDescriptor = observation_bodyweightProfile;
void _descriptor;
`;

describe("generated profile structural descriptor", () => {
    test("a generated profile class is assignable without a Cognovis-specific import", async () => {
        const result = await new APIBuilder({ register: r4Manager, logger: mkErrorLogger() })
            .typeSchema({
                treeShake: {
                    "hl7.fhir.r4.core": {
                        "http://hl7.org/fhir/StructureDefinition/bodyweight": {},
                    },
                },
            })
            .typescript({
                inMemoryOnly: true,
                withDebugComment: false,
                generateProfile: true,
                openResourceTypeSet: false,
            })
            .generate();

        expect(result.success).toBeTrue();
        const files = result.filesGenerated.typescript!;
        expect(files[PROFILE_PATH]).toBeDefined();

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-dzn-descriptor-"));
        try {
            for (const [relPath, content] of Object.entries(files)) {
                const absPath = path.join(tmpDir, relPath);
                fs.mkdirSync(path.dirname(absPath), { recursive: true });
                fs.writeFileSync(absPath, content);
            }
            fs.writeFileSync(path.join(tmpDir, "consumer.ts"), consumerSource);
            fs.writeFileSync(
                path.join(tmpDir, "tsconfig.json"),
                JSON.stringify({
                    compilerOptions: {
                        strict: true,
                        module: "esnext",
                        moduleResolution: "bundler",
                        target: "esnext",
                        skipLibCheck: true,
                        noEmit: true,
                    },
                    include: ["consumer.ts", "generated/**/*.ts"],
                }),
            );

            const tsc = spawnSync("bunx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
                cwd: tmpDir,
                encoding: "utf8",
            });
            expect(tsc.status, tsc.stdout + tsc.stderr).toBe(0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
