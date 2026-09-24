import { describe, expect, it } from "bun:test";
import { Python } from "@root/api/writer-generator/python/writer";
import { TypeScript } from "@root/api/writer-generator/typescript/writer";
import { generateTypeSchemas } from "@root/typeschema";
import { mkTypeSchemaIndex } from "@root/typeschema/utils";
import { mkR4Register, mkSilentLogger, type PFS, registerFs } from "@typeschema-test/utils";

const pkg = { name: "codegen.test.nestedchoice", version: "1.0.0" };
const base = "http://hl7.org/fhir/StructureDefinition/Observation";
const restrictingProfile: PFS = {
    description: "Observation whose component value choice excludes Ratio and string",
    derivation: "constraint",
    type: "Observation",
    name: "RestrictedComponentObservation",
    kind: "resource",
    url: "http://example.org/StructureDefinition/restricted-component-observation",
    base,
    package_meta: pkg,
    elements: {
        component: {
            elements: {
                value: { choices: ["valueQuantity", "valueCodeableConcept", "valueBoolean", "valueInteger"] },
            },
        },
    },
};
const slicingProfile: PFS = {
    description: "Observation slicing component by code into Quantity and Ratio values",
    derivation: "constraint",
    type: "Observation",
    name: "SlicedComponentObservation",
    kind: "resource",
    url: "http://example.org/StructureDefinition/sliced-component-observation",
    base,
    package_meta: pkg,
    elements: {
        component: {
            elements: { code: {} },
            slicing: {
                slices: {
                    quantity: {
                        max: 1,
                        match: { code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] } },
                        schema: { elements: { value: { choices: ["valueQuantity"] }, valueQuantity: { type: "Quantity", choiceOf: "value" } } },
                    },
                    ratio: {
                        max: 1,
                        match: { code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] } },
                        schema: { elements: { value: { choices: ["valueRatio"] }, valueRatio: { type: "Ratio", choiceOf: "value" } } },
                    },
                },
            },
        },
    },
};

const register = await mkR4Register();
registerFs(register, restrictingProfile);
registerFs(register, slicingProfile);
const { schemas } = await generateTypeSchemas(register, undefined, mkSilentLogger());

const indexForOrder = (lastProfile: PFS) => {
    const profileSchemas = schemas.filter((schema) =>
        schema.identifier.url === restrictingProfile.url || schema.identifier.url === slicingProfile.url,
    );
    expect(profileSchemas).toHaveLength(2);
    const orderedSchemas = [
        ...schemas.filter((schema) => !profileSchemas.includes(schema)),
        ...profileSchemas.filter((schema) => schema.identifier.url !== lastProfile.url),
        ...profileSchemas.filter((schema) => schema.identifier.url === lastProfile.url),
    ];
    return mkTypeSchemaIndex(orderedSchemas, { register, logger: mkSilentLogger() });
};

const generate = async (lastProfile: PFS): Promise<string> => {
    const writer = new TypeScript({
        outputDir: "generated/types",
        inMemoryOnly: true,
        tabSize: 4,
        commentLinePrefix: "//",
        logger: mkSilentLogger(),
        openResourceTypeSet: false,
        primitiveTypeExtension: true,
        generateProfile: true,
        withDebugComment: false,
    });
    await writer.generateAsync(indexForOrder(lastProfile));
    const file = writer.writtenFiles().find(({ relPath }) =>
        relPath.endsWith("profiles/Observation_SlicedComponentObservation.ts"),
    );
    expect(file).toBeDefined();
    return file!.content;
};

const generatePython = async (lastProfile: PFS): Promise<string> => {
    const writer = new Python({
        outputDir: "generated",
        inMemoryOnly: true,
        tabSize: 4,
        commentLinePrefix: "#",
        logger: mkSilentLogger(),
        rootPackageName: "fhir_types",
        fieldFormat: "camelCase",
        primitiveTypeExtension: false,
        generateProfile: true,
        client: "none",
    });
    await writer.generateAsync(indexForOrder(lastProfile));
    const file = writer.writtenFiles().find(({ relPath }) =>
        relPath.endsWith("profiles/observation_sliced_component_observation.py"),
    );
    expect(file).toBeDefined();
    return file!.content;
};

// FHIR R4 Observation.component.value[x]: http://hl7.org/fhir/StructureDefinition/Observation#Observation.component.value[x].
// The specialization declares 11 variants; cognovis/codegen#20 AC1-AC3 requires other profiles not to narrow that base.
const baseChoiceOmit =
    '"code" | "value" | "valueQuantity" | "valueCodeableConcept" | "valueString" | "valueBoolean" | "valueInteger" | "valueRange" | "valueRatio" | "valueSampledData" | "valueTime" | "valueDateTime" | "valuePeriod"';

describe("Observation component slices use the R4 specialization's nested choice", async () => {
    const restrictFirst = await generate(slicingProfile);
    const restrictLast = await generate(restrictingProfile);

    it.each([
        ["restricting profile first", restrictFirst],
        ["restricting profile last", restrictLast],
    ])("omits every R4 component value choice in the Quantity slice when %s", (_order, source) => {
        expect(source).toContain(`SliceFlat = Omit<ObservationComponent, ${baseChoiceOmit}> & Quantity;`);
    });

    it.each([
        ["restricting profile first", restrictFirst],
        ["restricting profile last", restrictLast],
    ])("wraps a Ratio slice choice when %s", (_order, source) => {
        expect(source).toContain('wrapSliceChoice<ObservationComponent>(input ?? {}, "valueRatio")');
    });

    it("emits byte-identical slicing profile modules in either schema order", () => {
        expect(restrictFirst).toBe(restrictLast);
    });

    it("emits byte-identical Python slicing profiles in either schema order", async () => {
        expect(await generatePython(slicingProfile)).toBe(await generatePython(restrictingProfile));
    });
});
