import { describe, expect, it } from "bun:test";
import { type CanonicalUrl, isLogicalTypeSchema, type Name } from "@root/typeschema/types";
import type { PFS } from "@typeschema-test/utils";
import { mkR4Register, mkR5Register, mkTestLogger, registerFsAndMkTs } from "@typeschema-test/utils";

// Current behavior of logical models specializing the FHIR `Base` canonical,
// pinned on both R4 and R5. R4 does not ship StructureDefinition-Base.json
// (`Base` is a virtual root), so transformation currently fails; R5 ships it
// as a physical abstract complex-type, so transformation succeeds.
//
// PR #209 makes R4 accept the virtual root. After it merges, refresh the R4
// snapshots (`bun test logical-base -u`): the recorded rejections become
// generated schemas with `base: undefined`. The R5 cases must NOT change —
// they guard that #209 stays inert where `Base` is resolvable.

const mkDocument = (base: string, name: string): PFS => ({
    base,
    url: `http://example.org/StructureDefinition/${name}`,
    name,
    kind: "logical",
    derivation: "specialization",
    elements: {
        title: { type: "string" },
    },
});

describe("TypeSchema: logical model specializing FHIR Base (R4, virtual root)", async () => {
    const r4 = await mkR4Register();
    const logger = mkTestLogger();

    // FIXME(#209): the snapshots currently record the rejection. After the merge,
    // refresh with `bun test logical-base -u`: they become generated schemas with
    // `base: undefined`.
    it("versioned Base parent", async () => {
        const doc = mkDocument("http://hl7.org/fhir/StructureDefinition/Base|4.0.1", "DocumentVersioned");
        const outcome = await registerFsAndMkTs(r4, doc, logger).catch((e: unknown) =>
            e instanceof Error ? `rejected: ${e.message}` : `rejected: ${String(e)}`,
        );
        expect(outcome).toMatchSnapshot();
    });

    it("unversioned Base parent", async () => {
        const doc = mkDocument("http://hl7.org/fhir/StructureDefinition/Base", "DocumentPlain");
        const outcome = await registerFsAndMkTs(r4, doc, logger).catch((e: unknown) =>
            e instanceof Error ? `rejected: ${e.message}` : `rejected: ${String(e)}`,
        );
        expect(outcome).toMatchSnapshot();
    });

    it("rejects an unknown missing parent", async () => {
        const doc = mkDocument("http://example.org/StructureDefinition/MissingParent", "BrokenDocument");
        await expect(registerFsAndMkTs(r4, doc, logger)).rejects.toThrow(
            "Base resource not found 'http://example.org/StructureDefinition/MissingParent'",
        );
    });
});

describe("TypeSchema: logical model specializing FHIR Base (R5, physical root)", async () => {
    const r5 = await mkR5Register();
    const logger = mkTestLogger();

    it("accepts a versioned Base parent and links it as base", async () => {
        const doc = mkDocument("http://hl7.org/fhir/StructureDefinition/Base|5.0.0", "DocumentVersioned");
        const [ts] = await registerFsAndMkTs(r5, doc, logger);

        if (!ts || !isLogicalTypeSchema(ts)) throw new Error("Expected a logical TypeSchema");
        expect(ts.identifier.name).toEqual("DocumentVersioned" as Name);
        expect(ts.base?.name).toEqual("Base" as Name);
        expect(ts.base?.url).toEqual("http://hl7.org/fhir/StructureDefinition/Base" as CanonicalUrl);
    });

    it("accepts an unversioned Base parent, full shape pinned", async () => {
        const doc = mkDocument("http://hl7.org/fhir/StructureDefinition/Base", "DocumentPlain");
        const schemas = await registerFsAndMkTs(r5, doc, logger);

        expect(schemas.length).toEqual(1);
        expect(schemas[0]).toMatchSnapshot();
    });

    it("rejects an unknown missing parent", async () => {
        const doc = mkDocument("http://example.org/StructureDefinition/MissingParent", "BrokenDocument");
        await expect(registerFsAndMkTs(r5, doc, logger)).rejects.toThrow(
            "Base resource not found 'http://example.org/StructureDefinition/MissingParent'",
        );
    });
});
