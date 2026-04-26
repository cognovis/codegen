/**
 * Regression tests for transitive package version mismatch in canonical resolution.
 *
 * Scenario (codegen-7y9):
 * - de.basisprofil.r4@1.6.0-ballot2 is loaded as a top-level focused package
 * - kbv.basis@1.8.0 is also loaded; it depends on de.basisprofil.r4@1.5.4 (an older version)
 *
 * In npm-based environments the canonical manager installs:
 *   - nodeModulesPath/de.basisprofil.r4/ → 1.6.0-ballot2 (top-level, WRONG for kbv.basis)
 *   - nodeModulesPath/kbv.basis/node_modules/de.basisprofil.r4/ → 1.5.4 (nested, correct)
 *
 * In bun-based environments (current), bun overrides kbv.basis's 1.5.4 dep with the
 * user-specified 1.6.0-ballot2, so only one version exists at the flat path.
 *
 * Root cause: scanNodeModulesPackage only scanned the flat top-level path, picking up
 * wrong-version content when kbv.basis needs a different version.
 *
 * Fix: scanNodeModulesPackage checks the package.json version in the flat path first.
 * If it doesn't match the requested version, scan nested paths:
 *   nodeModulesPath/<parentDir>/node_modules/<pkg.name>/
 * Return the first directory whose version matches. Fall back to flat if none found.
 *
 * See: codegen-7y9
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CanonicalManager } from "@atomic-ehr/fhir-canonical-manager";
import type { CanonicalUrl } from "@root/typeschema/types";
import type { Register } from "@typeschema/register";
import { registerFromManager, registerFromPackageMetas } from "@typeschema/register";

const kbvPkg = { name: "kbv.basis", version: "1.8.0" };
const basisprofilNew = { name: "de.basisprofil.r4", version: "1.6.0-ballot2" };
const basisprofilOld = { name: "de.basisprofil.r4", version: "1.5.4" };

/**
 * Integration test: registers de.basisprofil.r4@1.6.0-ballot2 + kbv.basis@1.8.0.
 *
 * In bun environments:
 * - The canonical manager installs 1.6.0-ballot2 at the flat path (user override wins)
 * - kbv.basis depends on 1.5.4, but bun uses 1.6.0-ballot2 for the dep install
 * - scanNodeModulesPackage finds 1.6.0-ballot2 at flat (version MATCHES the requested 1.6.0-ballot2 focused pkg)
 * - For the 1.5.4 transitive dep: 1.6.0-ballot2 is at flat (version MISMATCH) → falls back to flat
 *
 * Key behaviour: resolution must not throw, and the pflegegrad URL must resolve.
 */
describe("Integration: 1.6.0-ballot2 top-level + kbv.basis@1.8.0 (codegen-7y9)", () => {
    let register: Register;

    beforeAll(async () => {
        register = await registerFromPackageMetas([basisprofilNew, kbvPkg], {
            registry: "https://packages.simplifier.net",
        });
    }, 120000);

    it("resolves observation-de-pflegegrad from kbv.basis context without throwing", () => {
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
        expect(careLevel).toBeDefined();
        const strippedBase = register.ensureSpecializationCanonicalUrl(careLevel!.base!);
        const baseResolved = register.resolveFs(kbvPkg, strippedBase);
        expect(baseResolved, `Base type '${strippedBase}' (from '${careLevel!.base}') must resolve`).toBeDefined();
    });
});

/**
 * Unit test for nested-path preference in scanNodeModulesPackage.
 *
 * Creates a synthetic node_modules layout that mimics npm-style nested installs:
 *   tempDir/
 *     de.basisprofil.r4/          ← flat path (version 1.6.0-ballot2, WRONG for kbv.basis dep)
 *       package.json
 *       StructureDefinition-obs-wrong.json  (FHIR version: 1.6.0-ballot)
 *     kbv.basis/
 *       node_modules/
 *         de.basisprofil.r4/      ← nested path (version 1.5.4, CORRECT)
 *           package.json
 *           StructureDefinition-observation-de-pflegegrad.json  (FHIR version: 1.5.4)
 *
 * When scanNodeModulesPackage is called for de.basisprofil.r4@1.5.4:
 * - BEFORE fix: uses flat path → returns 1.6.0-ballot content tagged as 1.5.4
 * - AFTER fix:  detects version mismatch at flat path → scans nested paths → finds 1.5.4 → uses it
 */
describe("scanNodeModulesPackage: nested path preferred over flat wrong-version", () => {
    let tempDir: string;

    // Real package data paths (from codegen 1.5.4 + kbv.basis cache, already downloaded)
    const REAL_CACHE_154 = join(
        process.cwd(),
        ".codegen-cache/canonical-manager-cache/ea1701c1997c0dae99123aa0a7f5e067ace35b494c1f4638888aed16d63d5655/node/node_modules",
    );

    const pflegegradUrl = "http://fhir.de/StructureDefinition/observation-de-pflegegrad" as CanonicalUrl;

    beforeAll(async () => {
        tempDir = join(process.cwd(), ".test-tmp-transitive-version-mismatch-" + Date.now());
        await mkdir(tempDir, { recursive: true });

        // Set up flat path: de.basisprofil.r4 at version 1.6.0-ballot2 (wrong version)
        const flatDir = join(tempDir, "de.basisprofil.r4");
        await mkdir(flatDir, { recursive: true });
        await writeFile(
            join(flatDir, "package.json"),
            JSON.stringify({ name: "de.basisprofil.r4", version: "1.6.0-ballot2" }),
        );
        // Add a fake FHIR resource with wrong version (would be returned if flat path used)
        await writeFile(
            join(flatDir, "StructureDefinition-wrong-version.json"),
            JSON.stringify({
                resourceType: "StructureDefinition",
                url: pflegegradUrl,
                version: "1.6.0-ballot",
                name: "ObservationDePflegegrad",
                kind: "resource",
                abstract: false,
                status: "active",
                type: "Observation",
                baseDefinition: "http://hl7.org/fhir/StructureDefinition/Observation",
                derivation: "constraint",
            }),
        );

        // Set up nested path: kbv.basis/node_modules/de.basisprofil.r4 at version 1.5.4 (correct)
        const nestedDir = join(tempDir, "kbv.basis", "node_modules", "de.basisprofil.r4");
        await mkdir(nestedDir, { recursive: true });
        await writeFile(
            join(nestedDir, "package.json"),
            JSON.stringify({ name: "de.basisprofil.r4", version: "1.5.4" }),
        );
        // Copy the real 1.5.4 pflegegrad resource if the cache exists, otherwise create a stub
        const realPflegegrad = join(
            REAL_CACHE_154,
            "de.basisprofil.r4",
            "StructureDefinition-observation-de-pflegegrad.json",
        );
        if (existsSync(realPflegegrad)) {
            await cp(realPflegegrad, join(nestedDir, "StructureDefinition-observation-de-pflegegrad.json"));
        } else {
            // Stub with 1.5.4 version field
            await writeFile(
                join(nestedDir, "StructureDefinition-observation-de-pflegegrad.json"),
                JSON.stringify({
                    resourceType: "StructureDefinition",
                    url: pflegegradUrl,
                    version: "1.5.4",
                    name: "ObservationDePflegegrad",
                    kind: "resource",
                    abstract: false,
                    status: "active",
                    type: "Observation",
                    baseDefinition: "http://hl7.org/fhir/StructureDefinition/Observation",
                    derivation: "constraint",
                }),
            );
        }

        // Also set up a minimal kbv.basis dir in the flat path so manager can find it
        const kbvDir = join(tempDir, "kbv.basis");
        await writeFile(
            join(kbvDir, "package.json"),
            JSON.stringify({
                name: "kbv.basis",
                version: "1.8.0",
                dependencies: { "de.basisprofil.r4": "1.5.4" },
            }),
        );
    }, 30000);

    afterAll(async () => {
        if (tempDir && existsSync(tempDir)) {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it("uses nested path content (version 1.5.4) when flat path has wrong version (1.6.0-ballot2)", async () => {
        // Create a minimal CanonicalManager that will report 0 resources for both packages
        // (simulating the null-id .index.json scenario).
        // We use the real packages + nodeModulesPath override to exercise the fallback path.
        //
        // The manager must be initialized (it downloads packages), but we override
        // nodeModulesPath to point at our synthetic temp dir.
        // The manager will index 0 resources → fallback kicks in → reads from tempDir.
        const manager = CanonicalManager({
            packages: ["kbv.basis@1.8.0", "de.basisprofil.r4@1.5.4"],
            workingDir: ".codegen-cache/canonical-manager-cache",
            registry: "https://packages.simplifier.net",
        });
        await manager.init();

        // Override nodeModulesPath with our synthetic structure.
        // This forces scanNodeModulesPackage to use tempDir instead of the real cache.
        // For de.basisprofil.r4@1.5.4:
        //   - flat path (tempDir/de.basisprofil.r4) has version 1.6.0-ballot2 → MISMATCH
        //   - nested path (tempDir/kbv.basis/node_modules/de.basisprofil.r4) has version 1.5.4 → MATCH
        // After fix: nested path should be preferred, returning 1.5.4 content.
        const register = await registerFromManager(manager, {
            focusedPackages: [basisprofilOld, kbvPkg],
            nodeModulesPath: tempDir,
        });

        // The pflegegrad resource loaded from the nested 1.5.4 path should have version "1.5.4"
        const resolved = register.resolveFs(basisprofilOld, pflegegradUrl);
        expect(resolved, "pflegegrad must resolve from nested 1.5.4 path").toBeDefined();
        expect(
            resolved!.version,
            "resolved pflegegrad should have FHIR version 1.5.4 (from nested path), " +
                "not 1.6.0-ballot (from flat wrong-version path)",
        ).toBe("1.5.4");
    }, 60000);
});
