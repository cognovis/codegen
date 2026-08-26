import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
const tarballVerifier = readFileSync("scripts/verify-release-tarball.sh", "utf8");

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

    it("validates tag and packed manifest identity before a publish can occur", () => {
        const tagValidation = releaseWorkflow.indexOf("Validate release tag and package");
        const packageStep = releaseWorkflow.indexOf("Pack release artifact");
        const publishStep = releaseWorkflow.indexOf("Publish release");

        expect(tagValidation).toBeGreaterThan(-1);
        expect(packageStep).toBeGreaterThan(tagValidation);
        expect(publishStep).toBeGreaterThan(packageStep);
        expect(releaseWorkflow).toContain("candidate.name !== process.env.PACKAGE_NAME");
        expect(releaseWorkflow).toContain("candidate.version !== process.env.VERSION");
    });

    it("handles a matching already-published package as a verified rerun and rejects a mismatch", () => {
        expect(releaseWorkflow).toContain("Detect existing release");
        expect(releaseWorkflow).toContain("already_published=true");
        expect(releaseWorkflow).toContain("Existing package bytes do not match the freshly packed release candidate");
        expect(releaseWorkflow).toContain("steps.release-state.outputs.already_published != 'true'");
        expect(releaseWorkflow).toContain("for attempt in $(seq 1 5)");
        expect(releaseWorkflow).toContain("if: always()");
    });

    it("checks the fixture's multi-variant sliced choice through Node", () => {
        expect(tarballVerifier).toContain("setMeasuredFinding({ valueQuantity:");
        expect(tarballVerifier).toContain("missing.setMeasuredFinding({});");
        expect(tarballVerifier).toContain("node --input-type=module");
    });
});
