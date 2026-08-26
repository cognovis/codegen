import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

describe("stable release artifact contract (codegen-8ja)", () => {
    it("verifies and publishes the same named npm tarball", () => {
        const tarballOutput = "${" + "{ steps.package.outputs.tarball }" + "}";

        expect(releaseWorkflow).toContain("bash scripts/verify-release-tarball.sh");
        expect(releaseWorkflow).toContain(`npm publish "${tarballOutput}" --tag latest`);
    });

    it("records registry metadata and freshly downloaded package bytes", () => {
        expect(releaseWorkflow).toContain("Verify published package identity");
        expect(releaseWorkflow).toContain("registry-dist.json");
        expect(releaseWorkflow).toContain("release-evidence.json");
    });
});
