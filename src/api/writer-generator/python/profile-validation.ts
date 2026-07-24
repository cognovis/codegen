import {
    type ChoiceFieldInstance,
    isChoiceDeclarationField,
    isChoiceInstanceField,
    isNotChoiceDeclarationField,
    type RegularField,
    type SnapshotProfileTypeSchema,
} from "@root/typeschema/types";
import type { TypeSchemaIndex } from "@root/typeschema/utils";
import { pyFieldName } from "./profile-naming";

// ---------------------------------------------------------------------------
// Validation body collection
// ---------------------------------------------------------------------------

/** Walk fields once and emit validate() body lines into `out`, returning the
 *  set of helper function names referenced. Pure: no writer side effects. */
export const collectValidateBody = (
    flatProfile: SnapshotProfileTypeSchema,
    tsIndex: TypeSchemaIndex,
    errorLines: string[],
    warningLines: string[],
    formatName: (s: string) => string,
): Set<string> => {
    const helpers = new Set<string>();
    const fields = flatProfile.fields;
    for (const [name, field] of Object.entries(fields)) {
        const pyName = pyFieldName(name, formatName);
        if (isChoiceInstanceField(field)) continue;
        if (isChoiceDeclarationField(field)) {
            if (field.required) {
                helpers.add("validate_choice_required");
                const pyChoices = field.choices.map((c) => pyFieldName(c, formatName));
                errorLines.push(
                    `errors.extend(validate_choice_required(self._resource, profile_name, ${JSON.stringify(pyChoices)}))`,
                );
            }
            if (field.prohibited?.length) {
                helpers.add("validate_choice_prohibited");
                const pyProhibited = field.prohibited.map((c) => pyFieldName(c, formatName));
                errorLines.push(
                    "errors.extend(validate_choice_prohibited(self._resource, profile_name, [",
                    ...pyProhibited.map((c) => `    ${JSON.stringify(c)},`),
                    "]))",
                );
            }
            continue;
        }
        collectRegularFieldValidation(field, pyName, helpers, errorLines, warningLines, tsIndex, formatName);
    }
    // Base-resource required fields the profile chain did not re-state.
    // Emitted here (not via the regular field loop) because they intentionally
    // live outside `fields` to avoid pulling unrelated base metadata into the
    // profile's getter/setter surface.
    for (const inheritedName of flatProfile.inheritedRequiredFields ?? []) {
        helpers.add("validate_required");
        errorLines.push(
            `errors.extend(validate_required(self._resource, profile_name, ${JSON.stringify(pyFieldName(inheritedName, formatName))}))`,
        );
    }
    return helpers;
};

const collectRegularFieldValidation = (
    field: RegularField | ChoiceFieldInstance,
    pyName: string,
    helpers: Set<string>,
    errorLines: string[],
    warningLines: string[],
    tsIndex: TypeSchemaIndex,
    formatName: (s: string) => string,
): void => {
    if (field.excluded) {
        helpers.add("validate_excluded");
        errorLines.push(`errors.extend(validate_excluded(self._resource, profile_name, ${JSON.stringify(pyName)}))`);
        return;
    }
    if (field.required) {
        helpers.add("validate_required");
        errorLines.push(`errors.extend(validate_required(self._resource, profile_name, ${JSON.stringify(pyName)}))`);
    }
    if (field.valueConstraint) {
        helpers.add("validate_fixed_value");
        const value = JSON.stringify(field.valueConstraint.value);
        errorLines.push(
            `errors.extend(validate_fixed_value(self._resource, profile_name, ${JSON.stringify(pyName)}, ${value}))`,
        );
    }
    if (isNotChoiceDeclarationField(field)) {
        if (field.enum) {
            helpers.add("validate_enum");
            const target = field.enum.isOpen ? warningLines : errorLines;
            const listName = field.enum.isOpen ? "warnings" : "errors";
            target.push(
                `${listName}.extend(validate_enum(self._resource, profile_name, ${JSON.stringify(pyName)}, ${JSON.stringify(field.enum.values)}))`,
            );
        }
        if (field.mustSupport && !field.required) {
            helpers.add("validate_must_support");
            warningLines.push(
                `warnings.extend(validate_must_support(self._resource, profile_name, ${JSON.stringify(pyName)}))`,
            );
        }
        if (field.reference && field.reference.resource.length > 0) {
            helpers.add("validate_reference");
            const allowed = field.reference.resource.map((ref) => tsIndex.findLastSpecializationByIdentifier(ref).name);
            errorLines.push(
                `errors.extend(validate_reference(self._resource, profile_name, ${JSON.stringify(pyName)}, ${JSON.stringify(allowed)}))`,
            );
        }
        if (field.slicing?.slices) {
            collectSliceValidation(field, pyName, helpers, errorLines, tsIndex, formatName);
        }
    }
};

const collectSliceValidation = (
    field: RegularField | ChoiceFieldInstance,
    name: string,
    helpers: Set<string>,
    errorLines: string[],
    tsIndex: TypeSchemaIndex,
    formatName: (s: string) => string,
): void => {
    if (!field.slicing?.slices) return;
    for (const [sliceName, slice] of Object.entries(field.slicing.slices)) {
        const match = slice.match ?? {};
        if (Object.keys(match).length === 0) continue;
        if (slice.min !== undefined || slice.max !== undefined) {
            const min = slice.min ?? 0;
            const max = slice.max ?? 0;
            helpers.add("validate_slice_cardinality");
            errorLines.push(
                `errors.extend(validate_slice_cardinality(self._resource, profile_name, ${JSON.stringify(name)}, ${JSON.stringify(match)}, ${JSON.stringify(sliceName)}, ${min}, ${max}))`,
            );
        }
        // Collect required fields within the slice element
        const sliceRequiredFields: string[] = [];
        const matchKeys = new Set(Object.keys(match));
        for (const rf of slice.required ?? []) {
            if (!matchKeys.has(rf)) sliceRequiredFields.push(pyFieldName(rf, formatName));
        }
        // Constrained choice: the single variant is required
        if (field.type && slice.elements) {
            const cc = tsIndex.constrainedChoice(field.type.package, field.type, slice.elements);
            if (cc) sliceRequiredFields.push(pyFieldName(cc.variant, formatName));
        }
        if (sliceRequiredFields.length > 0) {
            helpers.add("validate_slice_fields");
            errorLines.push(
                `errors.extend(validate_slice_fields(self._resource, profile_name, ${JSON.stringify(name)}, ${JSON.stringify(match)}, ${JSON.stringify(sliceName)}, ${JSON.stringify(sliceRequiredFields)}))`,
            );
        }
    }
};
