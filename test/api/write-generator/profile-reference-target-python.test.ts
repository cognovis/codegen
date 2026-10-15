import { describe, expect, it } from "bun:test";
import * as Path from "node:path";
import { APIBuilder } from "@root/api/builder";
import { mkSilentLogger } from "@typeschema-test/utils";

const FIXTURE_PATH = Path.join(__dirname, "../../assets/profile-reference-target");

/**
 * Regression, the Python half of #242: `Task.focus` is `Reference(Any)`, and the
 * profile restates it with nothing but `mustSupport`. The emitted check used to
 * list `Resource` as the only allowed type, which no instance can ever carry as
 * its `resourceType`, so every conformant reference was rejected.
 *
 * #242 fixed that by expanding the family into the allow-list. That is right for
 * the *types*, which is where `effectiveResource` is still consumed, but wrong
 * for validation: the expansion is the set of resources the index holds, so tree
 * shaking turns it into a list that rejects references the profile permits. The
 * validation seam now treats an open declared target as open and emits no check.
 * The fixture is the StructureDefinition of the TypeScript test, so the two
 * writers are pinned against one profile.
 */
describe("Python profile reference targets", async () => {
    const result = await new APIBuilder({ logger: mkSilentLogger() })
        .localStructureDefinitions({
            package: { name: "example.test.referencetarget", version: "0.1.0" },
            path: FIXTURE_PATH,
            dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
        })
        .python({ inMemoryOnly: true, generateProfile: true, client: "none" })
        .generate();

    const profileKey = "generated/example_test_referencetarget/profiles/task_reference_target_task.py";
    const profileFile = result.filesGenerated.python?.[profileKey];

    it("should succeed", () => {
        expect(result.success).toBeTrue();
        expect(profileFile).toBeDefined();
    });

    // `Task.focus` is Reference(Any): an open declared target set, which no closed
    // allow-list can represent. The family members the index happens to hold are
    // not the constraint, so none of them may be emitted as one.
    it("emits no reference check for an open declared target", () => {
        expect(profileFile).not.toContain('validate_reference(self._resource, profile_name, "focus"');
        expect(profileFile).not.toContain('"Organization"');
        expect(profileFile).not.toContain('"ServiceRequest"');
    });

    it("never names the family root as an allowed type", () => {
        expect(profileFile).not.toContain('"Resource"');
        expect(profileFile).not.toContain('"DomainResource"');
    });

    it("leaves an explicit target alone", () => {
        expect(profileFile).toContain('validate_reference(self._resource, profile_name, "requester", [');
        expect(profileFile).toContain('"Practitioner"');
    });

    it("matches snapshot", () => {
        expect(profileFile).toMatchSnapshot();
    });
});
