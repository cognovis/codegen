/**
 * Naming utilities for Python profile generation.
 *
 * Mirrors `src/api/writer-generator/typescript/name.ts`, but emits
 * snake_case method / field names and `module_file.py` filenames.
 *
 * Used by the Python profile generator — kept in its own file so
 * the existing `naming-utils.ts` stays focused on the core type writer.
 */

import { LEADING_DIGIT_RE, PYTHON_KEYWORDS } from "@root/api/writer-generator/python/naming-utils";
import { pascalCase, snakeCase } from "@root/api/writer-generator/utils";
import type {
    ProfileExtension,
    ProfileTypeSchema,
    SnapshotProfileTypeSchema,
    TypeIdentifier,
} from "@root/typeschema/types";
import type { TypeSchemaIndex } from "@root/typeschema/utils";
import type { SliceDef } from "./profile-slices";

// ---------------------------------------------------------------------------
// Identifier sanitisation
// ---------------------------------------------------------------------------

/** Make a raw FHIR name safe to use as a Python identifier. */
export const normalizePyName = (n: string): string => {
    let out = n.replace(/\[x\]/g, "_x_").replace(/[- :./]/g, "_");
    if (PYTHON_KEYWORDS.has(out)) out = `${out}_`;
    if (LEADING_DIGIT_RE.test(out)) out = `_${out}`;
    return out;
};

/** Snake-case conversion that first strips `[x]` and FHIR slice separators. */
export const pySnakeName = (name: string): string => {
    if (!name) return "";
    const cleaned = name.replace(/\[x\]/g, "").replace(/[:./]/g, "_");
    return snakeCase(cleaned);
};

/** Format a field name per the active field-naming mode (defaults to snake_case),
 *  escaping Python keywords. The result must match the model's field name, so the
 *  same `formatName` used to generate the models is threaded through. */
export const pyFieldName = (n: string, formatName: (s: string) => string = snakeCase): string => {
    const cleaned = n.replace(/\[x\]/g, "").replace(/[:./]/g, "_");
    const out = formatName(cleaned);
    return PYTHON_KEYWORDS.has(out) ? `${out}_` : out;
};

// ---------------------------------------------------------------------------
// Profile module + class names
// ---------------------------------------------------------------------------

/** PascalCase class name for a profile, suffixed with `Profile` (or
 *  `Extension` when the profile already ends in "Extension"). Mirrors
 *  `tsProfileClassName` exactly. */
export const pyProfileClassName = (schema: ProfileTypeSchema | SnapshotProfileTypeSchema): string => {
    const name = pascalCase(normalizePyName(schema.identifier.name));
    if (schema.base.name === "Extension") {
        return name.endsWith("Extension") ? name : `${name}Extension`;
    }
    return name.endsWith("Profile") ? name : `${name}Profile`;
};

/** snake_case module stem: `<base>_<profile-identifier>`, mirroring TS
 *  `tsProfileModuleName`. The profile portion uses the raw identifier name
 *  (NOT the class name), so e.g. R4 `bodyweight` → `observation_bodyweight`
 *  and US Core `USCorePatientProfile` → `patient_us_core_patient_profile`. */
export const pyProfileModuleName = (
    tsIndex: TypeSchemaIndex,
    schema: ProfileTypeSchema | SnapshotProfileTypeSchema,
): string => {
    const baseSchema = tsIndex.findLastSpecialization(schema);
    const baseName = snakeCase(normalizePyName(baseSchema.identifier.name));
    const profileName = snakeCase(normalizePyName(schema.identifier.name));
    return `${baseName}_${profileName}`;
};

// ---------------------------------------------------------------------------
// Slice / extension method base names + collision resolution
// ---------------------------------------------------------------------------

/** Key of one slice in the resolved name maps: its field and its slice name. */
export const pySliceKey = (fieldName: string, sliceName: string): string => `${fieldName}:${sliceName}`;

/** The FHIR `value[x]` field name for a TypeIdentifier, formatted per the active
 *  field-naming mode (e.g. `value_coding` for snake_case, `valueCoding` for camelCase). */
export const pyValueFieldName = (id: TypeIdentifier, formatName: (s: string) => string = snakeCase): string =>
    formatName(`value${pascalCase(normalizePyName(id.name))}`);

export type ResolvedProfileMethods = {
    extensions: Record<string, string>;
    slices: Record<string, string>;
    /** Static class attribute holding each slice's match, keyed like `slices`. */
    sliceMatches: Record<string, string>;
    allBaseNames: Set<string>;
};

/** Look up a slice's match constant; every slice that is emitted has one. */
export const pySliceMatchName = (resolved: ResolvedProfileMethods, fieldName: string, sliceName: string): string => {
    const name = resolved.sliceMatches[pySliceKey(fieldName, sliceName)];
    if (!name) throw new Error(`No match constant resolved for slice ${pySliceKey(fieldName, sliceName)}`);
    return name;
};

/**
 * Allocate one accessor base name, in snake case, avoiding names already taken.
 *
 * The shared resolver keeps candidates apart in Pascal space, where an
 * extension's `AlleleDatabase` and a slice's `Allele_database` are distinct.
 * `snakeCase` splits on both lower→Upper and `_`, so the two collapse onto one
 * Python name and the module would declare it twice — Python keeps the last
 * definition, silently shadowing the earlier accessor. Fall through the
 * remaining candidates, which are field-qualified, to find a free one.
 *
 * The candidates can run out: four slices `alleleDatabase`, `allele_database`,
 * `allele__database` and `allele___database` all snake-case alike, and there are
 * fewer field-qualified candidates than that. Returning the preferred name then
 * would hand out a reserved name and shadow an earlier accessor again, so suffix
 * it instead, as the TypeScript writer does for colliding profile names: the
 * first free one of `<preferred>_2`, `<preferred>_3`, ... The caller reserves
 * whatever this returns.
 */
const pyAccessorBaseName = (candidates: readonly string[], recommended: string, reserved: Set<string>): string => {
    const preferred = snakeCase(recommended);
    if (!reserved.has(preferred)) return preferred;
    for (const candidate of candidates) {
        const name = snakeCase(candidate);
        if (!reserved.has(name)) return name;
    }
    let suffix = 2;
    while (reserved.has(`${preferred}_${suffix}`)) suffix += 1;
    return `${preferred}_${suffix}`;
};

export const resolveProfileMethodBaseNames = (
    extensions: ProfileExtension[],
    sliceDefs: SliceDef[],
    fieldNames: readonly string[] = [],
): ResolvedProfileMethods => {
    // Field accessors are emitted from the same class, so their names are taken
    // before either extension or slice accessors get to pick.
    const reserved = new Set(fieldNames.map((name) => snakeCase(name)));

    const extensionsRecord: Record<string, string> = {};
    for (const ext of extensions) {
        if (!ext.url) continue;
        const name = pyAccessorBaseName(ext.nameCandidates.candidates, ext.nameCandidates.recommended, reserved);
        reserved.add(name);
        extensionsRecord[`${ext.url}:${ext.path}`] = name;
    }

    // Each slice's match constant is named from its own accessor base name. Those are
    // collision-free, so the constants are too. Naming the constant from the raw slice
    // name instead let two slices whose names snake-case alike declare one constant
    // twice; Python keeps the last, so both slices' accessors read and wrote the
    // second slice, and one slice's data overwrote the other's.
    const slicesRecord: Record<string, string> = {};
    const sliceMatches: Record<string, string> = {};
    for (const s of sliceDefs) {
        const name = pyAccessorBaseName(s.nameCandidates.candidates, s.nameCandidates.recommended, reserved);
        reserved.add(name);
        slicesRecord[pySliceKey(s.fieldName, s.sliceName)] = name;
        sliceMatches[pySliceKey(s.fieldName, s.sliceName)] = `_${name}_slice_match`;
    }

    const allBaseNames = new Set([...Object.values(extensionsRecord), ...Object.values(slicesRecord)]);
    return { extensions: extensionsRecord, slices: slicesRecord, sliceMatches, allBaseNames };
};
