import type { PreprocessContext } from "@atomic-ehr/fhir-canonical-manager";
import { APIBuilder, prettyReport } from "../src/api/builder";

// Reproduce the case:
//   kbv.ita.for@1.3.1
//   de.basisprofil.r4@1.6.0-ballot2  (newer than kbv.ita.for's pin)
//   kbv.basis@1.8.0                  (newer than kbv.ita.for's pin)
//
// Goal: see whether — after the canonical-resolver fix is in place —
// codegen reaches and trips on the R5-only types in
// hl7.fhir.uv.extensions.r4@5.2.0 (PR #153 territory).

const preprocessPackage = (ctx: PreprocessContext): PreprocessContext => {
    if (ctx.kind !== "package") return ctx;
    const json = ctx.packageJson;
    const name = json.name as string;

    // de.basisprofil.r4 doesn't declare hl7.fhir.r4.core as a dependency
    if (name === "de.basisprofil.r4") {
        const deps = (json.dependencies as Record<string, string>) || {};
        if (!deps["hl7.fhir.r4.core"]) {
            return {
                ...ctx,
                kind: "package",
                packageJson: {
                    ...json,
                    dependencies: { ...deps, "hl7.fhir.r4.core": "4.0.1" },
                },
            };
        }
    }
    return ctx;
};

console.log("Generating KBV ITA For (1.3.1) with newer transitive de.basisprofil.r4 + kbv.basis...");

const builder = new APIBuilder({
    preprocessPackage,
    registry: "https://packages.simplifier.net",
    ignorePackageIndex: true,
})
    .fromPackage("hl7.fhir.r4.core", "4.0.1")
    .fromPackage("kbv.ita.for", "1.3.1")
    .fromPackage("de.basisprofil.r4", "1.6.0-ballot2")
    .fromPackage("kbv.basis", "1.8.0")
    .throwException()
    .typescript({
        withDebugComment: false,
        generateProfile: true,
        openResourceTypeSet: false,
    })
    .typeSchema({})
    .outputTo("./var/repro-kbv-newer-deps/fhir-types")
    .cleanOutput(true);

try {
    const report = await builder.generate();
    console.log(prettyReport(report));
    console.log(report.success ? "SUCCESS" : "FAILED");
    if (!report.success) process.exit(1);
} catch (e) {
    console.error("THROWN:", e instanceof Error ? e.message : String(e));
    process.exit(1);
}
