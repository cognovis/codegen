import { describe, expect, it } from "bun:test";
import * as Path from "node:path";
import { APIBuilder } from "@root/api/builder";
import { mkSilentLogger } from "@typeschema-test/utils";

const FIXTURE_PATH = Path.join(__dirname, "../../assets/profile-sliced-choice");

const CODED_FINDING_MATCH =
    '{"code":{"coding":[{"system":"http://example.test/CodeSystem/component-kind","code":"coded-finding"}]}}';
const MEASURED_FINDING_MATCH =
    '{"code":{"coding":[{"system":"http://example.test/CodeSystem/component-kind","code":"measured-finding"}]}}';

/** The two emitted lines of a `validate_slice_fields` call carrying choice
 *  groups, matched against a dedented copy of the module. */
const sliceFieldsCall = (match: string, sliceName: string, requiredFields: string, groups: string): string =>
    [
        `validate_slice_fields(self._resource, profile_name, "component", ${match}, "${sliceName}", ${requiredFields}, [`,
        groups,
    ].join("\n");

/**
 * Regression, the Python twin of the TypeScript sliced choice fix: a slice that
 * constrains a choice element (`Observation.component:codedFinding.value[x]`
 * narrowed to CodeableConcept and required) used to be validated with all-of
 * semantics over `["value", "valueCodeableConcept"]`. `value` is not a FHIR
 * element on a flattened resource, so no conformant resource could ever satisfy
 * the generated validator.
 *
 * The fixture is the generic StructureDefinition of the TypeScript test, so the
 * fix has to be generic too.
 */
describe("Python sliced choice component validation", async () => {
    const result = await new APIBuilder({ logger: mkSilentLogger() })
        .localStructureDefinitions({
            package: { name: "example.test.slicedchoice", version: "0.0.1" },
            path: FIXTURE_PATH,
            dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
        })
        .python({ inMemoryOnly: true, generateProfile: true, client: "none" })
        .generate();

    const profileKey = "generated/example_test_slicedchoice/profiles/observation_sliced_choice_observation.py";
    const profileFile = result.filesGenerated.python?.[profileKey];
    const dedented = (profileFile ?? "").replace(/^[ \t]+/gm, "");

    it("should succeed", () => {
        expect(result.success).toBeTrue();
        expect(profileFile).toBeDefined();
    });

    it("does not require the choice base name inside a slice", () => {
        expect(profileFile).not.toContain('"value","valueCodeableConcept"');
        expect(dedented).not.toMatch(/validate_slice_fields\([^\n]*\n"value"[,\n]/);
    });

    it("emits an at-least-one choice group for a single-variant sliced choice element", () => {
        expect(dedented).toContain(
            sliceFieldsCall(CODED_FINDING_MATCH, "codedFinding", "[]", '["valueCodeableConcept"]'),
        );
    });

    it("emits every permitted variant in the choice group of a two-type slice", () => {
        expect(dedented).toContain(
            sliceFieldsCall(MEASURED_FINDING_MATCH, "measuredFinding", "[]", '["valueQuantity","valueString"]'),
        );
    });
});
