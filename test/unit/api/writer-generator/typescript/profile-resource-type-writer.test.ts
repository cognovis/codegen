import { describe, expect, test } from "bun:test";
import { generateProfileClass } from "@root/api/writer-generator/typescript/profile";
import { TypeScript } from "@root/api/writer-generator/typescript/writer";
import type {
    CanonicalUrl,
    Name,
    PrimitiveTypeSchema,
    SnapshotProfileTypeSchema,
    TypeIdentifier,
} from "@root/typeschema/types";
import { mkTypeSchemaIndex } from "@root/typeschema/utils";
import { mkCodegenLogger } from "@root/utils/log";

const primitiveBase: TypeIdentifier = {
    kind: "primitive-type",
    name: "base64Binary" as Name,
    package: "hl7.fhir.r4.core",
    version: "4.0.1",
    url: "http://hl7.org/fhir/StructureDefinition/base64Binary" as CanonicalUrl,
};

const elementBase: TypeIdentifier = {
    kind: "complex-type",
    name: "Element" as Name,
    package: "hl7.fhir.r4.core",
    version: "4.0.1",
    url: "http://hl7.org/fhir/StructureDefinition/Element" as CanonicalUrl,
};

const primitiveSchema: PrimitiveTypeSchema = {
    identifier: primitiveBase,
    base: elementBase,
};

const unsupportedSnapshot: SnapshotProfileTypeSchema = {
    identifier: {
        kind: "profile-snapshot",
        name: "UnsupportedPrimitive" as Name,
        package: "codegen.test",
        version: "1.0.0",
        url: "http://example.org/StructureDefinition/UnsupportedPrimitive" as CanonicalUrl,
    },
    base: primitiveBase,
    fields: {},
};

const generateUnsupportedProfile = () => {
    const logger = mkCodegenLogger({ level: "ERROR" });
    const w = new TypeScript({
        outputDir: "/tmp/codegen-dzn-profile-resource-type",
        inMemoryOnly: true,
        tabSize: 4,
        commentLinePrefix: "//",
        logger,
        openResourceTypeSet: false,
        primitiveTypeExtension: true,
        generateProfile: true,
    });
    const tsIndex = mkTypeSchemaIndex([primitiveSchema], { logger });
    w.cd("/", () => {
        w.cat("UnsupportedPrimitiveProfile.ts", () => {
            generateProfileClass(w, tsIndex, unsupportedSnapshot);
        });
    });
    const generated = w.writtenFiles()[0]?.content ?? "";
    return { logger, generated };
};

describe("TypeScript profile writer unsupported resourceType root", () => {
    test("emits an actionable diagnostic and omits static resourceType", () => {
        const { logger, generated } = generateUnsupportedProfile();
        const errors = logger
            .buffer()
            .filter((e) => e.level === "ERROR")
            .map((e) => e.message);

        expect(
            errors.some((msg) => /UnsupportedPrimitive/.test(msg) && /resource type|supported FHIR/i.test(msg)),
        ).toBe(true);
        expect(generated).toContain("export class UnsupportedPrimitiveProfile");
        expect(generated).not.toContain("static readonly resourceType");
    });
});
