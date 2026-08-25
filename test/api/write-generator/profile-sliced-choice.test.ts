import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as Path from "node:path";
import { APIBuilder } from "@root/api/builder";
import { mkSilentLogger } from "@typeschema-test/utils";

const FIXTURE_PATH = Path.join(__dirname, "../../assets/profile-sliced-choice");
const HELPERS_PATH = Path.join(__dirname, "../../../assets/api/writer-generator/typescript/profile-helpers.ts");

const CODED_FINDING_MATCH =
    '{"code":{"coding":[{"system":"http://example.test/CodeSystem/component-kind","code":"coded-finding"}]}}';
const MEASURED_FINDING_MATCH =
    '{"code":{"coding":[{"system":"http://example.test/CodeSystem/component-kind","code":"measured-finding"}]}}';

type ProfileInstance = {
    setCodedFinding: (input?: Record<string, unknown>) => unknown;
    setMeasuredFinding: (input?: Record<string, unknown>) => unknown;
    toResource: () => Record<string, unknown>;
};

type ProfileClass = {
    createResource: (args: Record<string, unknown>) => Record<string, unknown>;
    apply: (resource: Record<string, unknown>) => ProfileInstance;
    from: (resource: Record<string, unknown>) => unknown;
};

/**
 * Write the generated profile module next to a copy of the runtime helper asset
 * and import it, so the assertions run against the real generated setter and the
 * real generated validator rather than against emitted source text.
 */
const loadProfileModule = async (relativePath: string, source: string): Promise<ProfileClass> => {
    const dir = await fs.mkdtemp(Path.join(os.tmpdir(), "codegen-g5s-"));
    const dest = Path.join(dir, relativePath);
    await fs.mkdir(Path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, source);
    // The generated module imports "../../profile-helpers".
    const helpersDest = Path.resolve(Path.dirname(dest), "../../profile-helpers.ts");
    await fs.mkdir(Path.dirname(helpersDest), { recursive: true });
    await fs.copyFile(HELPERS_PATH, helpersDest);
    const mod = await import(dest);
    return mod.SlicedChoiceObservationProfile as ProfileClass;
};

/**
 * Regression for codegen-g5s: a slice that constrains a choice element
 * (`Observation.component:codedFinding.value[x]` narrowed to CodeableConcept and
 * required) used to be validated with all-of semantics over
 * `["value", "valueCodeableConcept"]`. `value` is not a FHIR element, so no
 * conformant resource — not even one written by the profile's own generated
 * setter — could ever satisfy the generated validator.
 *
 * The fixture is a generic StructureDefinition, not a copy of the profile the
 * defect was reported on, so the fix has to be generic too.
 */
describe("Sliced choice component validation (codegen-g5s)", async () => {
    const result = await new APIBuilder({ logger: mkSilentLogger() })
        .localStructureDefinitions({
            package: { name: "example.test.slicedchoice", version: "0.0.1" },
            path: FIXTURE_PATH,
            dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
        })
        .typescript({ inMemoryOnly: true, generateProfile: true, withDebugComment: false })
        .generate();

    const profileKey = Object.keys(result.filesGenerated.typescript ?? {}).find((k) =>
        k.includes("Observation_SlicedChoiceObservation"),
    );
    const profileFile = profileKey ? result.filesGenerated.typescript![profileKey] : undefined;

    it("should succeed", () => {
        expect(result.success).toBeTrue();
        expect(profileFile).toBeDefined();
    });

    it("does not require the choice base name inside the slice", () => {
        expect(profileFile).not.toContain(`"codedFinding", ["value"`);
    });

    it("emits an at-least-one choice group for the sliced choice element", () => {
        expect(profileFile).toContain(
            `validateSliceFields(res, profileName, "component", ${CODED_FINDING_MATCH}, "codedFinding", [], [["valueCodeableConcept"]])`,
        );
    });

    const profileClass = await loadProfileModule(profileKey ?? "profile.ts", profileFile ?? "");

    const baseArgs = {
        status: "final",
        code: { coding: [{ system: "http://example.test/CodeSystem/observation-kind", code: "example" }] },
    };

    it("accepts a slice element written by the profile's own generated setter", () => {
        const profile = profileClass.apply(profileClass.createResource(baseArgs));
        profile.setCodedFinding({ coding: [{ system: "http://example.test/CodeSystem/finding", code: "present" }] });
        const resource = profile.toResource();

        expect(() => profileClass.from(resource)).not.toThrow();
    });

    it("still rejects a slice element that carries no choice variant at all", () => {
        const profile = profileClass.apply(profileClass.createResource(baseArgs));
        profile.setCodedFinding({});
        const resource = profile.toResource();

        expect(() => profileClass.from(resource)).toThrow(/valueCodeableConcept is required/);
    });

    // The `measuredFinding` slice narrows value[x] to two types, so the choice
    // group holds more than one variant: any one of them satisfies it.
    const withCodedFinding = (): ProfileInstance => {
        const profile = profileClass.apply(profileClass.createResource(baseArgs));
        profile.setCodedFinding({ coding: [{ system: "http://example.test/CodeSystem/finding", code: "present" }] });
        return profile;
    };

    it("emits every permitted variant in the choice group of a two-type slice", () => {
        expect(profileFile).toContain(
            `validateSliceFields(res, profileName, "component", ${MEASURED_FINDING_MATCH}, "measuredFinding", [], [["valueQuantity","valueString"]])`,
        );
    });

    it("accepts the first permitted variant of a multi-variant choice slice", () => {
        const profile = withCodedFinding();
        profile.setMeasuredFinding({ valueQuantity: { value: 3, unit: "mm" } });

        expect(() => profileClass.from(profile.toResource())).not.toThrow();
    });

    it("accepts the second permitted variant of a multi-variant choice slice", () => {
        const profile = withCodedFinding();
        profile.setMeasuredFinding({ valueString: "three millimetres" });

        expect(() => profileClass.from(profile.toResource())).not.toThrow();
    });

    it("rejects a multi-variant choice slice carrying none of the permitted variants", () => {
        const profile = withCodedFinding();
        profile.setMeasuredFinding({});

        expect(() => profileClass.from(profile.toResource())).toThrow(
            "SlicedChoiceObservation.component[measuredFinding]: at least one of valueQuantity, valueString is required",
        );
    });
});
