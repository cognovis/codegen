import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
const tarballVerifier = readFileSync("scripts/verify-release-tarball.sh", "utf8");
const contributingGuide = readFileSync("CONTRIBUTING.md", "utf8");

describe("stable release artifact contract (codegen-8ja)", () => {
    it("verifies and publishes the same named npm tarball", () => {
        const tarballOutput = "${" + "{ steps.package.outputs.tarball }" + "}";

        expect(releaseWorkflow).toContain("bash scripts/verify-release-tarball.sh");
        expect(releaseWorkflow).toContain(`TARBALL: ${tarballOutput}`);
        expect(releaseWorkflow).toContain('npm publish "$TARBALL" --tag latest');
    });

    it("records registry metadata and freshly downloaded package bytes", () => {
        expect(releaseWorkflow).toContain("Verify published package identity");
        expect(releaseWorkflow).toContain("registry-dist.json");
        expect(releaseWorkflow).toContain("release-evidence.json");
    });

    it("uploads hidden release evidence and fails rather than silently omitting it", () => {
        const evidenceStep = releaseWorkflow.slice(
            releaseWorkflow.indexOf("Upload release package evidence"),
            releaseWorkflow.indexOf("Create Github Release"),
        );

        expect(evidenceStep).toContain("include-hidden-files: true");
        expect(evidenceStep).toContain("if-no-files-found: error");
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

    it("does not forward registry credentials to an untrusted tarball origin or redirect", () => {
        expect(releaseWorkflow).toContain('REGISTRY_URL="$(npm config get @cognovis:registry)"');
        expect(releaseWorkflow).toContain('registry.protocol !== "https:"');
        expect(releaseWorkflow).toContain("tarball.origin !== registry.origin");
        expect(releaseWorkflow).toContain("tarball.username || tarball.password");
        expect(releaseWorkflow).toContain("--location --max-redirs 0");
    });

    it("pins uploaded evidence and rejects tags not merged into main", () => {
        const releaseSection = releaseWorkflow.slice(releaseWorkflow.indexOf("\n  release:\n"));
        const reachabilityGuard = releaseSection.indexOf("Validate release commit reaches origin/main");
        const packageStep = releaseSection.indexOf("Pack release artifact");

        expect(releaseSection).toContain("fetch-depth: 0");
        expect(reachabilityGuard).toBeGreaterThan(-1);
        expect(packageStep).toBeGreaterThan(reachabilityGuard);
        expect(releaseSection).toContain('git rev-parse "$GITHUB_REF^{commit}"');
        expect(releaseSection).toContain('git merge-base --is-ancestor "$TAG_COMMIT" origin/main^{commit}');
        expect(releaseWorkflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2");
    });

    it("uses setup-node's scoped registry as the tarball trust anchor", () => {
        const configDirectory = mkdtempSync(join(tmpdir(), "codegen-release-npm-config-"));
        const npmConfig = join(configDirectory, ".npmrc");

        writeFileSync(
            npmConfig,
            ["registry=https://registry.npmjs.org/", "@cognovis:registry=https://npm.cognovis.de"].join("\n"),
        );
        const result = Bun.spawnSync(["npm", "config", "get", "@cognovis:registry", "--userconfig", npmConfig]);
        rmSync(configDirectory, { recursive: true });

        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString().trim()).toBe("https://npm.cognovis.de");
        expect(releaseWorkflow).toContain('registry-url: "https://npm.cognovis.de"');
        expect(releaseWorkflow).toContain('scope: "@cognovis"');
        expect(releaseWorkflow).toContain("npm config get @cognovis:registry");
        expect(releaseWorkflow).not.toContain('REGISTRY_URL="$(npm config get registry)"');
    });

    it("treats a first-publish npm E404 without depending on ripgrep", () => {
        expect(releaseWorkflow).toContain('grep -q "E404" .release-artifacts/existing-dist.err');
        expect(releaseWorkflow).not.toContain('rg -q "E404"');
    });

    it("pins release tooling and permits a tagged main ancestor when main advances", () => {
        const releaseSection = releaseWorkflow.slice(releaseWorkflow.indexOf("\n  release:\n"));

        expect(releaseSection).toContain("oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76 # v2.0.2");
        expect(releaseSection).toContain('bun-version: "1.3.14"');
        expect(releaseWorkflow).toContain("npm install -g npm@11.8.0");
        expect(releaseSection).toContain('git merge-base --is-ancestor "$TAG_COMMIT" origin/main^{commit}');
        expect(releaseSection).not.toContain('test "$TAG_COMMIT" = "$MAIN_COMMIT"');
    });

    it("avoids expression interpolation of the tarball path and cleans verifier scratch space", () => {
        const tarballOutput = "${" + "{ steps.package.outputs.tarball }" + "}";

        expect(releaseWorkflow).toContain(`TARBALL: ${tarballOutput}`);
        expect(releaseWorkflow).toContain('bash scripts/verify-release-tarball.sh "$TARBALL"');
        expect(tarballVerifier).toContain("trap 'rm -r \"$verification_dir\"' EXIT");
    });

    it("documents the pinned workflow and ancestor-based tag admission", () => {
        expect(contributingGuide).toContain("Bun 1.3.14 and npm 11.8.0");
        expect(contributingGuide).toContain("ancestor of the current `origin/main`");
    });

    it("documents the v0.2.0 evidence artifact exception", () => {
        expect(contributingGuide).toContain("tag run `32945564978`");
        expect(contributingGuide).toContain("hidden-file upload fix landed after the immutable tag");
        expect(contributingGuide).toContain("authoritative from the next release onward");
    });
});
