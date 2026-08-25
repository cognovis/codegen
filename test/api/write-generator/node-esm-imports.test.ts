import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as Path from "node:path";
import { APIBuilder } from "@root/api/builder";
import { mkSilentLogger } from "@typeschema-test/utils";

const FIXTURE_PATH = Path.join(__dirname, "../../assets/profile-inherited-required");
const PACKAGE_DIR = "cognovis-test-praxis";

/**
 * Generate a projection on disk and turn it into the shape it is published in:
 * plain `.js` modules under `"type": "module"`. Transpiling only erases types —
 * it rewrites no import specifier — so what Node resolves here is exactly what
 * the generator emitted.
 */
const buildPublishedProjection = async (): Promise<string> => {
    const dir = await fs.mkdtemp(Path.join(os.tmpdir(), "codegen-wgn-"));
    await new APIBuilder({ logger: mkSilentLogger() })
        .localStructureDefinitions({
            package: { name: "cognovis.test.praxis", version: "0.0.1" },
            path: FIXTURE_PATH,
            dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
        })
        .typescript({ generateProfile: true, withDebugComment: false })
        .outputTo(dir)
        .generate();

    const transpiler = new Bun.Transpiler({ loader: "ts" });
    for (const entry of await fs.readdir(dir, { recursive: true })) {
        if (!entry.endsWith(".ts")) continue;
        const source = Path.join(dir, entry);
        await fs.writeFile(source.replace(/\.ts$/, ".js"), transpiler.transformSync(await fs.readFile(source, "utf8")));
    }
    await fs.writeFile(Path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
    return dir;
};

/**
 * Regression for codegen-wgn: generated modules used extensionless relative
 * import specifiers. Bun's resolver accepts them, Node's ESM resolver does not,
 * so a projection published as `"type": "module"` failed on Node with
 * ERR_MODULE_NOT_FOUND. The check runs the real `node` binary — under bun the
 * defect is invisible.
 *
 * It enters through the package index so the whole chain is exercised: index →
 * profiles barrel → profile module → the shared profile-helpers module.
 */
describe("Generated modules under the Node ESM resolver (codegen-wgn)", async () => {
    const dir = await buildPublishedProjection();

    const importFromNode = async (specifier: string, symbol: string) => {
        const url = new URL(`file://${Path.join(dir, specifier)}`).href;
        const script = `const m = await import(${JSON.stringify(url)}); if (typeof m[${JSON.stringify(symbol)}] !== "function") { console.error("missing export ${symbol}"); process.exit(3); }`;
        const proc = Bun.spawn(["node", "--input-type=module", "-e", script], { stdout: "pipe", stderr: "pipe" });
        const stderr = await new Response(proc.stderr).text();
        return { exitCode: await proc.exited, stderr };
    };

    it("resolves the whole chain from the package index", async () => {
        const { exitCode, stderr } = await importFromNode(`${PACKAGE_DIR}/index.js`, "PraxisProposalProvenanceProfile");

        expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
        expect(exitCode).toBe(0);
    });

    it("resolves a profile module imported directly", async () => {
        const { exitCode, stderr } = await importFromNode(
            `${PACKAGE_DIR}/profiles/Provenance_PraxisProposalProvenance.js`,
            "PraxisProposalProvenanceProfile",
        );

        expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
        expect(exitCode).toBe(0);
    });

    it("emits no extensionless relative specifier anywhere in the projection", async () => {
        const offenders: string[] = [];
        for (const entry of await fs.readdir(dir, { recursive: true })) {
            if (!entry.endsWith(".ts")) continue;
            const source = await fs.readFile(Path.join(dir, entry), "utf8");
            for (const [, specifier] of source.matchAll(/ from "(\.[^"]*)"/g)) {
                if (!specifier?.endsWith(".js")) offenders.push(`${entry}: ${specifier}`);
            }
        }

        expect(offenders).toEqual([]);
    });
});
