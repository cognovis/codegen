import {
    camelCase,
    kebabCase,
    uppercaseFirstLetter,
    uppercaseFirstLetterOfEach,
} from "@root/api/writer-generator/utils";
import { compareCollisionSources } from "@root/typeschema/collision-order";
import {
    type CanonicalUrl,
    extractNameFromCanonical,
    packageMeta,
    packageMetaToNpm,
    type SnapshotProfileTypeSchema,
    type TypeIdentifier,
} from "@root/typeschema/types";
import type { TypeSchemaIndex } from "@root/typeschema/utils";

// biome-ignore format: too long
const tsKeywords = new Set([ "class", "function", "return", "if", "for", "while", "const", "let", "var", "import", "export", "interface" ]);

export const normalizeTsName = (n: string): string => {
    if (tsKeywords.has(n)) n = `${n}_`;
    return n.replace(/\[x\]/g, "_x_").replace(/[- :.]/g, "_");
};

export const tsCamelCase = (name: string): string => {
    if (!name) return "";
    // Remove [x] suffix and normalize special characters before camelCase
    const normalized = name.replace(/\[x\]/g, "").replace(/:/g, "_");
    return camelCase(normalized);
};

export const tsPackageDir = (name: string): string => {
    return kebabCase(name.replace(/[@/]/g, "_"));
};

export const tsModuleName = (id: TypeIdentifier): string => {
    // NOTE: Why not pascal case?
    // In hl7-fhir-uv-xver-r5-r4 we have:
    // - http://hl7.org/fhir/5.0/StructureDefinition/extension-Subscription.topic (subscription_topic)
    // - http://hl7.org/fhir/5.0/StructureDefinition/extension-SubscriptionTopic (SubscriptionTopic)
    // And they should not clash the names.
    return uppercaseFirstLetter(tsResourceName(id));
};

export const tsModuleFileName = (id: TypeIdentifier): string => {
    return `${tsModuleName(id)}.ts`;
};

export const tsNameFromCanonical = (canonical: string | undefined, dropFragment = true) => {
    if (!canonical) return undefined;
    const localName = extractNameFromCanonical(canonical as CanonicalUrl, dropFragment);
    if (!localName) return undefined;
    return normalizeTsName(localName);
};

export const tsResourceName = (id: TypeIdentifier): string => {
    if (id.kind === "nested") {
        const url = id.url;
        // Extract name from URL without normalizing dots (needed for fragment splitting)
        const localName = extractNameFromCanonical(url as CanonicalUrl, false);
        if (!localName) return "";
        const [resourceName, fragment] = localName.split("#");
        const name = uppercaseFirstLetterOfEach((fragment ?? "").split(".")).join("");
        return normalizeTsName([resourceName, name].join(""));
    }
    const name = id.name.includes("/")
        ? (extractNameFromCanonical(id.name as unknown as CanonicalUrl) ?? id.name)
        : id.name;
    return normalizeTsName(name);
};

export const tsFieldName = (n: string): string => {
    if (tsKeywords.has(n)) return `"${n}"`;
    if (n.includes(" ") || n.includes("-")) return `"${n}"`;
    return n;
};

type TsProfileName = { moduleName: string; className: string };

export type TsProfileNameCollision = {
    /** Package whose `profiles/` directory holds the colliding modules (`name@version`). */
    package: string;
    /** The class name every definition of the group derives from its `StructureDefinition.name`. */
    sharedClassName: string;
    /** The definition that keeps its name-derived module and class: the highest canonical in code-unit order. */
    winner: TsProfileName & { canonical: string };
    /** The other definitions in canonical order, emitted under canonical-derived names. */
    additional: (TsProfileName & { canonical: string; nameDerivedModuleName: string; derivedModuleName: string })[];
};

type TsProfileNames = { byProfile: Record<string, TsProfileName>; collisions: TsProfileNameCollision[] };

const profileNameKey = (schema: SnapshotProfileTypeSchema): string =>
    `${packageMetaToNpm(packageMeta(schema))}\u0000${schema.identifier.url}`;

const profileClassNameOf = (name: string): string => (name.endsWith("Profile") ? name : `${name}Profile`);

const profileBaseName = (tsIndex: TypeSchemaIndex, schema: SnapshotProfileTypeSchema): string =>
    uppercaseFirstLetter(normalizeTsName(tsIndex.findLastSpecializationByIdentifier(schema.identifier).name));

const nameDerivedProfileName = (tsIndex: TypeSchemaIndex, schema: SnapshotProfileTypeSchema): TsProfileName => {
    const name = normalizeTsName(schema.identifier.name);
    return { moduleName: `${profileBaseName(tsIndex, schema)}_${name}`, className: profileClassNameOf(name) };
};

const profileNamesByIndex = new WeakMap<TypeSchemaIndex, TsProfileNames>();

/**
 * Resolve the module and class name of every snapshot profile once per index.
 *
 * Profiles of one package whose `StructureDefinition.name` derives the same class name (and
 * so possibly the same module file) form a collision group. The definition with the highest
 * canonical (code-unit order, as in `collision-order.ts`) keeps its name-derived names; every
 * other definition is emitted under `${Base}_${tsNameFromCanonical(url)}`, numbered when that
 * name is taken as well. The result does not depend on the order in which the package set
 * supplies the definitions.
 */
export const tsProfileNames = (tsIndex: TypeSchemaIndex): TsProfileNames => {
    const cached = profileNamesByIndex.get(tsIndex);
    if (cached) return cached;

    const groupsByPackage: Record<string, Record<string, SnapshotProfileTypeSchema[]>> = {};
    for (const schema of tsIndex.collectSnapshotProfiles()) {
        const groups = (groupsByPackage[packageMetaToNpm(packageMeta(schema))] ??= {});
        (groups[nameDerivedProfileName(tsIndex, schema).className] ??= []).push(schema);
    }

    const byProfile: Record<string, TsProfileName> = {};
    const collisions: TsProfileNameCollision[] = [];
    for (const pkg of Object.keys(groupsByPackage).sort()) {
        const groups = groupsByPackage[pkg] ?? {};
        const usedClassNames = new Set(Object.keys(groups));
        const usedModuleNames = new Set(
            Object.values(groups).flatMap((group) => group.map((s) => nameDerivedProfileName(tsIndex, s).moduleName)),
        );
        for (const sharedClassName of Object.keys(groups).sort()) {
            const group = [...(groups[sharedClassName] ?? [])].sort((left, right) =>
                compareCollisionSources(
                    { sourcePackage: pkg, sourceCanonical: left.identifier.url },
                    { sourcePackage: pkg, sourceCanonical: right.identifier.url },
                ),
            );
            const winner = group.pop();
            if (!winner) continue;
            const winnerName = nameDerivedProfileName(tsIndex, winner);
            byProfile[profileNameKey(winner)] = winnerName;
            if (group.length === 0) continue;

            const additional: TsProfileNameCollision["additional"] = [];
            for (const schema of group) {
                const base = profileBaseName(tsIndex, schema);
                const derivedLocal =
                    tsNameFromCanonical(schema.identifier.url) ?? normalizeTsName(schema.identifier.name);
                let local = derivedLocal;
                let suffix = 2;
                while (usedModuleNames.has(`${base}_${local}`) || usedClassNames.has(profileClassNameOf(local))) {
                    local = `${derivedLocal}_${suffix}`;
                    suffix += 1;
                }
                const name = { moduleName: `${base}_${local}`, className: profileClassNameOf(local) };
                usedModuleNames.add(name.moduleName);
                usedClassNames.add(name.className);
                byProfile[profileNameKey(schema)] = name;
                additional.push({
                    ...name,
                    canonical: schema.identifier.url,
                    nameDerivedModuleName: nameDerivedProfileName(tsIndex, schema).moduleName,
                    derivedModuleName: `${base}_${derivedLocal}`,
                });
            }
            collisions.push({
                package: pkg,
                sharedClassName,
                winner: { ...winnerName, canonical: winner.identifier.url },
                additional,
            });
        }
    }

    const names = { byProfile, collisions };
    profileNamesByIndex.set(tsIndex, names);
    return names;
};

/** One report line for a collision group: the shared name, the winning canonical and each additional name. */
export const tsProfileNameCollisionReport = ({ package: pkg, winner, additional }: TsProfileNameCollision): string => {
    const entries = additional.map((entry) => {
        const notes = [
            entry.nameDerivedModuleName !== winner.moduleName && `name-derived module '${entry.nameDerivedModuleName}'`,
            entry.moduleName !== entry.derivedModuleName &&
                `canonical-derived name '${entry.derivedModuleName}' is taken`,
        ].filter(Boolean);
        return `'${entry.moduleName}' (class '${entry.className}') for ${entry.canonical}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
    });
    return `Profile name collision in ${pkg}: '${winner.moduleName}' (class '${winner.className}') keeps ${winner.canonical} (highest canonical); additionally generated ${entries.join(", ")}`;
};

const tsProfileName = (tsIndex: TypeSchemaIndex, schema: SnapshotProfileTypeSchema): TsProfileName =>
    tsProfileNames(tsIndex).byProfile[profileNameKey(schema)] ?? nameDerivedProfileName(tsIndex, schema);

export const tsProfileModuleName = (tsIndex: TypeSchemaIndex, schema: SnapshotProfileTypeSchema): string =>
    tsProfileName(tsIndex, schema).moduleName;

export const tsProfileModuleFileName = (tsIndex: TypeSchemaIndex, schema: SnapshotProfileTypeSchema): string => {
    return `${tsProfileModuleName(tsIndex, schema)}.ts`;
};

export const tsProfileClassName = (tsIndex: TypeSchemaIndex, schema: SnapshotProfileTypeSchema): string =>
    tsProfileName(tsIndex, schema).className;

export const tsSliceFlatTypeName = (profileName: string, fieldName: string, sliceName: string): string => {
    return `${uppercaseFirstLetter(profileName)}_${uppercaseFirstLetter(normalizeTsName(fieldName))}_${uppercaseFirstLetter(normalizeTsName(sliceName))}SliceFlat`;
};

export const tsSliceFlatAllTypeName = (profileName: string, fieldName: string, sliceName: string): string => {
    return `${uppercaseFirstLetter(profileName)}_${uppercaseFirstLetter(normalizeTsName(fieldName))}_${uppercaseFirstLetter(normalizeTsName(sliceName))}SliceFlatAll`;
};

export const tsExtensionFlatTypeName = (profileName: string, extensionName: string): string => {
    return `${uppercaseFirstLetter(profileName)}_${uppercaseFirstLetter(normalizeTsName(extensionName))}Flat`;
};

export const tsSliceStaticName = (name: string): string => name.replace(/\[x\]/g, "").replace(/[^a-zA-Z0-9_$]/g, "_");

export const tsValueFieldName = (id: TypeIdentifier): string => `value${uppercaseFirstLetter(id.name)}`;

const TS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** An object-literal property key for emitted value code: bare when it is a
 *  valid identifier, quoted otherwise — and computed for "__proto__", whose
 *  plain form is the prototype setter and would not create an own property. */
export const tsObjectKey = (key: string): string => {
    if (key === "__proto__") return '["__proto__"]';
    return TS_IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
};
