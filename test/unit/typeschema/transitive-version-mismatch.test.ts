/**
 * Regression tests for transitive package version mismatch in canonical resolution.
 *
 * Scenario (codegen-7y9):
 * - de.basisprofil.r4@1.6.0-ballot2 is loaded as a top-level focused package
 * - kbv.basis@1.8.0 is also loaded; it depends on de.basisprofil.r4@1.5.4 (an older version)
 * - The canonical manager installs:
 *   - nodeModulesPath/de.basisprofil.r4/ → 1.6.0-ballot2 (top-level, WRONG for kbv.basis)
 *   - nodeModulesPath/kbv.basis/node_modules/de.basisprofil.r4/ → 1.5.4 (nested, if present)
 *
 * Root cause: scanNodeModulesPackage only scans the flat top-level path, picking up
 * 1.6.0-ballot2 files when kbv.basis needs 1.5.4. Since de.basisprofil.r4 1.6.0-ballot2
 * also has a null-id .index.json entry, the fallback scanner is triggered. It reads from
 * the flat top-level path (1.6.0-ballot2) and labels those resources as 1.5.4. As a result,
 * the FHIR resource's own `version` field reports "1.6.0-ballot" even though the package_meta
 * says "1.5.4".
 *
 * Fix: scanNodeModulesPackage checks the package.json version in the flat path first.
 * If it doesn't match the requested version, scan nested paths:
 *   nodeModulesPath/<parentDir>/node_modules/<pkg.name>/
 * Return the first directory whose package.json version matches. Fall back to the flat
 * path if no exact-version nested path is found (graceful degradation).
 *
 * See: codegen-7y9
 */
import { beforeAll, describe, expect, it } from "bun:test";
import type { CanonicalUrl } from "@root/typeschema/types";
import type { Register } from "@typeschema/register";
import { registerFromPackageMetas } from "@typeschema/register";

// Top-level package: newer version (1.6.0-ballot2 has a null-id .index.json entry too,
// so scanNodeModulesPackage is triggered for it as well)
const basisprofilNew = { name: "de.basisprofil.r4", version: "1.6.0-ballot2" };
// kbv.basis@1.8.0 depends on de.basisprofil.r4@1.5.4 (older version)
const kbvPkg = { name: "kbv.basis", version: "1.8.0" };

describe("Transitive version mismatch resolution (codegen-7y9)", () => {
    let register: Register;

    beforeAll(async () => {
        // Register with the NEWER basisprofil version as top-level + kbv.basis.
        // kbv.basis internally depends on de.basisprofil.r4@1.5.4.
        // The canonical manager installs 1.6.0-ballot2 at the flat top-level path.
        // For kbv.basis's dependency on 1.5.4: either a nested path exists at
        //   kbv.basis/node_modules/de.basisprofil.r4/ (1.5.4), OR the flat top-level
        //   path is reused (wrong version scenario).
        register = await registerFromPackageMetas([basisprofilNew, kbvPkg], {
            registry: "https://packages.simplifier.net",
        });
    }, 120000);

    describe("resolveFs — cross-package base type lookup", () => {
        it("finds observation-de-pflegegrad from kbv.basis context", () => {
            const url = "http://fhir.de/StructureDefinition/observation-de-pflegegrad" as CanonicalUrl;
            const resolved = register.resolveFs(kbvPkg, url);
            expect(resolved, "observation-de-pflegegrad must be resolvable from kbv.basis context").toBeDefined();
            expect(resolved?.url).toBe(url);
        });

        it("resolves KBV_PR_Base_Observation_Care_Level without throwing", () => {
            const careLevelUrl =
                "https://fhir.kbv.de/StructureDefinition/KBV_PR_Base_Observation_Care_Level" as CanonicalUrl;
            const resolved = register.resolveFs(kbvPkg, careLevelUrl);
            expect(resolved, "KBV_PR_Base_Observation_Care_Level must be resolvable").toBeDefined();
        });

        it("resolves base type chain for KBV_PR_Base_Observation_Care_Level", () => {
            const careLevelUrl =
                "https://fhir.kbv.de/StructureDefinition/KBV_PR_Base_Observation_Care_Level" as CanonicalUrl;
            const careLevel = register.resolveFs(kbvPkg, careLevelUrl);
            expect(careLevel, "KBV_PR_Base_Observation_Care_Level must be resolvable").toBeDefined();

            const strippedBase = register.ensureSpecializationCanonicalUrl(careLevel!.base!);
            const baseResolved = register.resolveFs(kbvPkg, strippedBase);
            expect(
                baseResolved,
                `Base type '${strippedBase}' (from '${careLevel!.base}') must resolve`,
            ).toBeDefined();
        });
    });

    describe("version accuracy — nested path preferred over flat wrong-version", () => {
        it("resolved observation-de-pflegegrad has FHIR version 1.5.4, not 1.6.0-ballot content", () => {
            // This is the core 7y9 bug: before the fix, scanNodeModulesPackage returns
            // resources from the flat 1.6.0-ballot2 path for a 1.5.4 dependency request.
            // The resource is tagged with package_meta.version="1.5.4" but its own FHIR
            // `version` field says "1.6.0-ballot" (content from the wrong package).
            //
            // After the fix: when the flat path holds a different version than requested,
            // nested paths are scanned first for an exact match.
            // If kbv.basis/node_modules/de.basisprofil.r4 exists and has version 1.5.4,
            // those resources should be used (FHIR version field = "1.5.4").
            // If no nested path exists, we fall back to flat (graceful degradation) and
            // the FHIR version field would still be "1.6.0-ballot" — but the canonical
            // resolution must at least not silently mislabel.
            const pflegegradUrl =
                "http://fhir.de/StructureDefinition/observation-de-pflegegrad" as CanonicalUrl;

            const resolvedFromKbv = register.resolveFs(kbvPkg, pflegegradUrl);
            expect(resolvedFromKbv, "pflegegrad must resolve from kbv.basis context").toBeDefined();

            // The FHIR resource's own `version` field must match 1.5.4 (the genuine version
            // of de.basisprofil.r4 that kbv.basis pins). If it says "1.6.0-ballot", it
            // means the wrong version's content was loaded (the 7y9 bug).
            expect(
                resolvedFromKbv!.version,
                "resolved pflegegrad should have FHIR version 1.5.4 (from nested path), " +
                "not 1.6.0-ballot (from flat wrong-version path)",
            ).toBe("1.5.4");
        });
    });
});
