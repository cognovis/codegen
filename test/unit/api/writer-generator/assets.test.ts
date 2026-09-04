import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as Path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveGeneratorAsset } from "@root/api/writer-generator/assets";
import { resolvePyAssets } from "@root/api/writer-generator/python/writer";
import { resolveTsAssets } from "@root/api/writer-generator/typescript/writer";

/**
 * Build a package layout carrying the asset tree, and return its root.
 *
 * `entryPoints` are created as files so a resolver can be pointed at any of them,
 * standing in for the depths a real install produces: the bundled library entry,
 * the bundled CLI entry, and a source module.
 */
const mkPackage = (entryPoints: string[]): { root: string; asset: string } => {
    const root = mkdtempSync(Path.join(tmpdir(), "codegen-assets-"));
    const assetDir = Path.join(root, "assets", "api", "writer-generator", "typescript");
    mkdirSync(assetDir, { recursive: true });
    const asset = Path.join(assetDir, "profile-helpers.ts");
    writeFileSync(asset, "export const helper = 1;\n");

    for (const entry of entryPoints) {
        const entryPath = Path.join(root, entry);
        mkdirSync(Path.dirname(entryPath), { recursive: true });
        writeFileSync(entryPath, "");
    }
    return { root, asset };
};

describe("resolveGeneratorAsset", () => {
    it("resolves assets from the bundled library entry point", () => {
        const { root, asset } = mkPackage(["dist/index.js"]);
        const moduleUrl = pathToFileURL(Path.join(root, "dist/index.js")).href;

        expect(resolveGeneratorAsset(moduleUrl, "typescript", "profile-helpers.ts")).toBe(asset);
    });

    it("resolves assets from the bundled CLI entry point", () => {
        // Regression: the CLI lives at dist/cli/index.js, one level deeper than the
        // library entry. Matching the library filename sent this case up past the
        // package root and it died with ENOENT on a directory outside the package.
        const { root, asset } = mkPackage(["dist/cli/index.js"]);
        const moduleUrl = pathToFileURL(Path.join(root, "dist/cli/index.js")).href;

        expect(resolveGeneratorAsset(moduleUrl, "typescript", "profile-helpers.ts")).toBe(asset);
    });

    it("resolves assets from a source module", () => {
        const { root, asset } = mkPackage(["src/api/writer-generator/typescript/writer.ts"]);
        const moduleUrl = pathToFileURL(Path.join(root, "src/api/writer-generator/typescript/writer.ts")).href;

        expect(resolveGeneratorAsset(moduleUrl, "typescript", "profile-helpers.ts")).toBe(asset);
    });

    it("names every path it tried when the asset is absent", () => {
        const { root } = mkPackage(["dist/cli/index.js"]);
        const moduleUrl = pathToFileURL(Path.join(root, "dist/cli/index.js")).href;

        expect(() => resolveGeneratorAsset(moduleUrl, "typescript", "missing.ts")).toThrow(
            /Cannot locate generator asset typescript\/missing\.ts/,
        );
    });

    it("resolves the real assets this package ships", () => {
        // Whatever layout the suite itself runs in, the shipped assets must resolve.
        const helpers = resolveTsAssets("profile-helpers.ts");
        const requirements = resolvePyAssets("requirements.txt");

        expect(existsSync(helpers)).toBe(true);
        expect(existsSync(requirements)).toBe(true);
    });
});
