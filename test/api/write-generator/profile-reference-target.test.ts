import { describe, expect, it } from "bun:test";
import * as Path from "node:path";
import { APIBuilder } from "@root/api/builder";
import { mkSilentLogger } from "@typeschema-test/utils";
import * as helpers from "../../../assets/api/writer-generator/typescript/profile-helpers";

const IMPORT_STATEMENT_RE = /import[\s\S]*?from\s+["'][^"']+["'];/g;
const EXPORT_KEYWORD_RE = /export /g;

// Execute the generated module without touching the file system: type-level
// imports are erased and the runtime helpers are injected as function
// parameters, so the class runs against the production helper implementations.
const instantiateProfile = (source: string): { from: (resource: unknown) => unknown } => {
    const javascript = new Bun.Transpiler({ loader: "ts" })
        .transformSync(source.replace(IMPORT_STATEMENT_RE, ""))
        .replace(EXPORT_KEYWORD_RE, "");
    return new Function(...Object.keys(helpers), `${javascript}; return ReferenceTargetTaskProfile;`)(
        ...Object.values(helpers),
    );
};

describe("Reference target validation", async () => {
    const result = await new APIBuilder({ logger: mkSilentLogger() })
        .localStructureDefinitions({
            package: { name: "example.test.referencetarget", version: "0.1.0" },
            path: Path.join(__dirname, "../../assets/profile-reference-target"),
            dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
        })
        .typescript({ inMemoryOnly: true, generateProfile: true, withDebugComment: false })
        .generate();
    if (!result.success) throw new Error("Profile generation failed");
    const files = result.filesGenerated.typescript ?? {};
    const profilePath = Object.keys(files).find((key) => key.includes("Task_ReferenceTargetTask"));
    if (!profilePath) throw new Error("Generated Task profile is missing");
    const profileSource = files[profilePath] ?? "";

    const profile = instantiateProfile(profileSource);
    const resource = {
        resourceType: "Task",
        meta: { profile: ["http://example.test/StructureDefinition/reference-target-task"] },
        status: "requested",
        intent: "order",
    };

    it("captures the generated profile module", () => {
        expect(profileSource).toMatchSnapshot();
    });

    it("accepts a concrete reference for the abstract Resource target", () => {
        expect(() => profile.from({ ...resource, focus: { reference: "Organization/synthetic" } })).not.toThrow();
    });

    // `Task.focus` is Reference(Any): the declared target set is open, so there is
    // no closed list to check against. The concrete resources the index holds are
    // not the constraint — tree shaking changes them — so emitting them as one
    // rejects valid references, which is the regression the tree-shaken block
    // below pins. An unknown type is consequently not caught here.
    it("emits no reference check for an open declared target", () => {
        expect(profileSource).not.toContain('validateReference(res, profileName, "focus"');
        expect(() => profile.from({ ...resource, focus: { reference: "NotAResource/synthetic" } })).not.toThrow();
    });

    it("accepts a matching explicit reference target", () => {
        expect(() => profile.from({ ...resource, requester: { reference: "Practitioner/synthetic" } })).not.toThrow();
    });

    it("rejects a mismatching explicit reference target", () => {
        expect(() => profile.from({ ...resource, requester: { reference: "Organization/synthetic" } })).toThrow(
            "field 'requester' references 'Organization' but only Practitioner are allowed",
        );
    });
});

/**
 * The same profile under tree shaking, which is how the cognovis-fhir release
 * generates. Shaking removes most resources from the index, so the family behind
 * `Reference(Any)` is a small subset of FHIR's resources. Expanding it into a
 * closed allow-list therefore rejects references that the profile permits — the
 * defect the verifier reproduced on `Provenance.target` with `Organization/org-1`.
 * An explicit target list is unaffected by shaking, because concrete targets are
 * never expanded, and must still be enforced.
 */
describe("Reference target validation under tree shaking", async () => {
    const result = await new APIBuilder({ logger: mkSilentLogger() })
        .localStructureDefinitions({
            package: { name: "example.test.referencetarget", version: "0.1.0" },
            path: Path.join(__dirname, "../../assets/profile-reference-target"),
            dependencies: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
        })
        .typeSchema({
            treeShake: {
                "example.test.referencetarget": {
                    "http://example.test/StructureDefinition/reference-target-task": {},
                },
            },
        })
        .typescript({ inMemoryOnly: true, generateProfile: true, withDebugComment: false })
        .generate();
    if (!result.success) throw new Error("Profile generation failed");
    const files = result.filesGenerated.typescript ?? {};
    const shakenPath = Object.keys(files).find((key) => key.includes("Task_ReferenceTargetTask"));
    if (!shakenPath) throw new Error("Generated Task profile is missing");
    const shakenSource = files[shakenPath] ?? "";
    const shakenProfile = instantiateProfile(shakenSource);
    const resource = {
        resourceType: "Task",
        meta: { profile: ["http://example.test/StructureDefinition/reference-target-task"] },
        status: "requested",
        intent: "order",
    };

    it("shakes Organization out of the index", () => {
        expect(Object.keys(files).some((key) => key.includes("Organization"))).toBeFalse();
    });

    it("accepts a permitted reference whose type the shaken index does not hold", () => {
        expect(() => shakenProfile.from({ ...resource, focus: { reference: "Organization/org-1" } })).not.toThrow();
    });

    it("still rejects a mismatching explicit reference target", () => {
        expect(() => shakenProfile.from({ ...resource, requester: { reference: "Organization/org-1" } })).toThrow(
            "field 'requester' references 'Organization' but only Practitioner are allowed",
        );
    });
});
