/**
 * High-Level API Builder
 *
 * Provides a fluent, chainable API for common codegen use cases with pre-built generators.
 * This builder pattern allows users to configure generation in a declarative way.
 */

import assert from "node:assert";
import * as fs from "node:fs";
import * as Path from "node:path";
import {
    CanonicalManager,
    type LocalPackageConfig,
    type PreprocessContext,
    type TgzPackageConfig,
} from "@atomic-ehr/fhir-canonical-manager";
import { CSharp, type CSharpGeneratorOptions } from "@root/api/writer-generator/csharp/csharp";
import { Python, type PythonGeneratorOptions } from "@root/api/writer-generator/python/writer";
import { generateTypeSchemas } from "@root/typeschema";
import { promoteLogical } from "@root/typeschema/ir/logic-promotion";
import { treeShake } from "@root/typeschema/ir/tree-shake";
import type { IrConf } from "@root/typeschema/ir/types";
import { type Register, registerFromManager } from "@root/typeschema/register";
import { type PackageMeta, packageMetaToNpm } from "@root/typeschema/types";
import { mkTypeSchemaIndex, type TypeSchemaIndex } from "@root/typeschema/utils";
import type { CodegenLogManager } from "@root/utils/log";
import { mkLogger } from "@root/utils/log";
import { IntrospectionWriter, type IntrospectionWriterOptions } from "./writer-generator/introspection";
import { IrReportWriterWriter, type IrReportWriterWriterOptions } from "./writer-generator/ir-report";
import type { FileBasedMustacheGeneratorOptions } from "./writer-generator/mustache";
import * as Mustache from "./writer-generator/mustache";
import { TypeScript, type TypeScriptOptions } from "./writer-generator/typescript/writer";
import type { FileBuffer, FileSystemWriter, FileSystemWriterOptions, WriterOptions } from "./writer-generator/writer";

/**
 * Configuration options for the API builder
 */
export interface APIBuilderOptions {
    outputDir: string;
    cleanOutput: boolean;
    throwException: boolean;
    typeSchema?: IrConf;

    /** Custom FHIR package registry URL (default: https://fs.get-ig.org/pkgs/) */
    registry: string | undefined;
    /** Drop the canonical manager cache */
    dropCanonicalManagerCache: boolean;
}

export type GenerationReport = {
    success: boolean;
    outputDir: string;
    /** Generated files nested by generator name, then by path: `filesGenerated[generator][path] = content`. */
    filesGenerated: Record<string, Record<string, string>>;
    errors: string[];
    warnings: string[];
    duration: number;
};

function countLinesByMatches(text: string): number {
    if (text === "") return 0;
    const m = text.match(/\n/g);
    return m ? m.length + 1 : 1;
}

const formatLoc = (loc: number): string => {
    if (loc >= 10000) return `${Math.round(loc / 1000)} kloc`;
    if (loc >= 1000) return `${(loc / 1000).toFixed(1)} kloc`;
    return `${loc} loc`;
};

export interface PrettyReportOptions {
    /** When a generator produces more than this many files, aggregate them by directory instead of listing each file. */
    fileLimit?: number;
}

export const prettyReport = (report: GenerationReport, options: PrettyReportOptions = {}): string => {
    const { success, filesGenerated, errors, warnings, duration } = report;
    const fileLimit = options.fileLimit ?? 20;
    const errorsStr = errors.length > 0 ? `Errors: ${errors.join(", ")}` : undefined;
    const warningsStr = warnings.length > 0 ? `Warnings: ${warnings.join(", ")}` : undefined;

    let totalFiles = 0;
    let totalLoc = 0;

    const aggregateByDir = (files: Record<string, number>): { dir: string; count: number; loc: number }[] => {
        const byDir: Record<string, { count: number; loc: number }> = {};
        for (const [p, loc] of Object.entries(files)) {
            const dir = Path.dirname(p);
            byDir[dir] ??= { count: 0, loc: 0 };
            byDir[dir].count += 1;
            byDir[dir].loc += loc;
        }
        return Object.entries(byDir)
            .map(([dir, v]) => ({ dir, count: v.count, loc: v.loc }))
            .sort((a, b) => a.dir.localeCompare(b.dir));
    };

    const groupStrs = Object.entries(filesGenerated).map(([name, files]) => {
        const locByPath: Record<string, number> = {};
        let groupLoc = 0;
        for (const [path, content] of Object.entries(files)) {
            const loc = countLinesByMatches(content);
            locByPath[path] = loc;
            groupLoc += loc;
        }
        const count = Object.keys(files).length;
        totalFiles += count;
        totalLoc += groupLoc;

        const header = `  ${name} (${count} files, ${formatLoc(groupLoc)}):`;
        if (count === 0) return header;
        if (count > fileLimit) {
            const dirs = aggregateByDir(locByPath);
            const dirLines = dirs.map((d) => `    - ${d.dir}/ (${d.count} files, ${formatLoc(d.loc)})`).join("\n");
            return `${header}\n${dirLines}`;
        }
        const fileLines = Object.entries(locByPath)
            .map(([p, loc]) => `    - ${p} (${loc} loc)`)
            .join("\n");
        return `${header}\n${fileLines}`;
    });

    return [
        `Generated files (${totalFiles} files, ${formatLoc(totalLoc)}):`,
        ...groupStrs,
        errorsStr,
        warningsStr,
        `Duration: ${Math.round(duration)}ms`,
        `Status: ${success ? "🟩 Success" : "🟥 Failure"}`,
    ]
        .filter((e) => e)
        .join("\n");
};

export interface LocalStructureDefinitionConfig {
    package: PackageMeta;
    path: string;
    dependencies?: PackageMeta[];
}

const cleanup = async (opts: APIBuilderOptions, logger: CodegenLogManager): Promise<void> => {
    logger.info(`Cleaning outputs...`);
    try {
        logger.info(`Clean ${opts.outputDir}`);
        fs.rmSync(opts.outputDir, { recursive: true, force: true });
    } catch (error) {
        logger.warn(`Error cleaning output directory: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const PACKAGE_PATH_OR_URL_RE = /^(?:https?:\/\/|\.{0,2}\/)/;
const EXACT_PACKAGE_VERSION_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const normalizedExactPackageVersion = (version: string): string | undefined => {
    const match = EXACT_PACKAGE_VERSION_RE.exec(version);
    if (!match) return undefined;
    const [, major, minor, patch, prerelease, build] = match;
    return `${major}.${minor}.${patch}${prerelease ?? ""}${build ?? ""}`;
};

const selectorAllowsResolvedVersion = (selector: string, resolvedVersion: string): boolean | undefined => {
    const declared = normalizedExactPackageVersion(selector);
    const resolved = normalizedExactPackageVersion(resolvedVersion);
    if (!declared || !resolved) return undefined;
    return declared === resolved;
};

const packageVersionConflicts = (packages: PackageMeta[]): string[][] => {
    const versionsByName: Record<string, Set<string>> = Object.create(null);
    for (const pkg of packages) {
        const version = normalizedExactPackageVersion(pkg.version);
        if (!version) continue;
        const versions = versionsByName[pkg.name] ?? new Set<string>();
        versions.add(version);
        versionsByName[pkg.name] = versions;
    }

    return Object.entries(versionsByName)
        .filter(([, versions]) => versions.size > 1)
        .map(([name, versions]) => [...versions].sort().map((version) => packageMetaToNpm({ name, version })))
        .sort(([left = ""], [right = ""]) => left.localeCompare(right));
};

const assertUnambiguousRootPackageVersions = (rootPackages: PackageMeta[]): void => {
    const conflicts = packageVersionConflicts(rootPackages);
    if (conflicts.length === 0) return;

    throw new Error(
        `Conflicting root package versions: ${conflicts.flat().join(", ")}. The canonical manager resolves one version per package name; select one version for each root package.`,
    );
};

const reportDependencyVersionMismatches = async (
    manager: ReturnType<typeof CanonicalManager>,
    resolvedRoots: PackageMeta[],
    result: GenerationReport,
    logger: CodegenLogManager,
): Promise<void> => {
    const resolvedPackages = typeof manager.packages === "function" ? await manager.packages() : resolvedRoots;
    const resolvedByName: Record<string, PackageMeta> = Object.create(null);
    for (const pkg of resolvedPackages) resolvedByName[pkg.name] = pkg;

    const seen = new Set<string>();
    for (const declaringPackage of [...resolvedPackages].sort((left, right) =>
        packageMetaToNpm(left).localeCompare(packageMetaToNpm(right)),
    )) {
        const manifest = await manager.packageJson(declaringPackage.name);
        for (const [dependencyName, selector] of Object.entries(manifest.dependencies ?? {}).sort(([left], [right]) =>
            left.localeCompare(right),
        )) {
            if (typeof selector !== "string") continue;
            const resolved = resolvedByName[dependencyName];
            if (!resolved || selectorAllowsResolvedVersion(selector, resolved.version) !== false) continue;
            const message = `${packageMetaToNpm(declaringPackage)} declares ${dependencyName}@${selector}, but the shared closure resolved ${packageMetaToNpm(resolved)}.`;
            if (seen.has(message)) continue;
            seen.add(message);
            logger.dryWarn("#packageVersionMismatch", message);
            result.warnings.push(message);
        }
    }
};

const packageMetaFromRef = (packageRef: string): PackageMeta | undefined => {
    if (PACKAGE_PATH_OR_URL_RE.test(packageRef) || packageRef.endsWith(".tgz")) return undefined;
    const separator = packageRef.lastIndexOf("@");
    if (separator <= 0) return { name: packageRef, version: "latest" };
    return { name: packageRef.slice(0, separator), version: packageRef.slice(separator + 1) || "latest" };
};

/**
 * High-Level API Builder class
 *
 * Provides a fluent interface for configuring and executing code generation
 * from FHIR packages or TypeSchema documents.
 */
export class APIBuilder {
    private options: APIBuilderOptions;
    private manager: ReturnType<typeof CanonicalManager>;
    private prebuiltRegister: Register | undefined;
    private managerInput: {
        npmPackages: string[];
        localSDs: LocalPackageConfig[];
        localTgzPackages: TgzPackageConfig[];
    };
    private logger: CodegenLogManager;
    private generators: { name: string; writer: FileSystemWriter }[] = [];
    private requestedPackages: PackageMeta[] = [];

    constructor(
        userOpts: Partial<APIBuilderOptions> & {
            manager?: ReturnType<typeof CanonicalManager>;
            register?: Register;
            preprocessPackage?: (context: PreprocessContext) => PreprocessContext;
            ignorePackageIndex?: boolean;
            logger?: CodegenLogManager;
        } = {},
    ) {
        const defaultOpts: APIBuilderOptions = {
            outputDir: "./generated",
            cleanOutput: true,
            throwException: false,
            registry: undefined,
            dropCanonicalManagerCache: false,
        };
        const apiBuilderKeys: (keyof APIBuilderOptions)[] = [
            "outputDir",
            "cleanOutput",
            "throwException",
            "typeSchema",
            "registry",
            "dropCanonicalManagerCache",
        ];
        const opts: APIBuilderOptions = {
            ...defaultOpts,
            ...Object.fromEntries(apiBuilderKeys.filter((k) => userOpts[k] !== undefined).map((k) => [k, userOpts[k]])),
        };

        if (userOpts.manager && userOpts.register) {
            throw new Error("Cannot provide both 'manager' and 'register' options. Use one or the other.");
        }

        this.managerInput = {
            npmPackages: [],
            localSDs: [],
            localTgzPackages: [],
        };
        this.prebuiltRegister = userOpts.register;
        this.manager =
            userOpts.manager ??
            CanonicalManager({
                packages: [],
                workingDir: ".codegen-cache/canonical-manager-cache",
                registry: userOpts.registry,
                dropCache: userOpts.dropCanonicalManagerCache,
                preprocessPackage: userOpts.preprocessPackage,
                ignorePackageIndex: userOpts.ignorePackageIndex,
            });
        this.logger = userOpts.logger ?? mkLogger({ prefix: "api" });
        this.options = opts;
    }

    fromPackage(packageName: string, version?: string): APIBuilder {
        const packageMeta = { name: packageName, version: version || "latest" };
        this.requestedPackages.push(packageMeta);
        this.managerInput.npmPackages.push(packageMetaToNpm(packageMeta));
        return this;
    }

    fromPackageRef(packageRef: string): APIBuilder {
        const packageMeta = packageMetaFromRef(packageRef);
        if (packageMeta) this.requestedPackages.push(packageMeta);
        this.managerInput.npmPackages.push(packageRef);
        return this;
    }

    localStructureDefinitions(config: LocalStructureDefinitionConfig): APIBuilder {
        this.logger.info(`Registering local StructureDefinitions for ${config.package.name}@${config.package.version}`);
        this.requestedPackages.push(config.package);
        this.managerInput.localSDs.push({
            name: config.package.name,
            version: config.package.version,
            path: config.path,
            dependencies: config.dependencies?.map((dep) => packageMetaToNpm(dep)),
        });
        return this;
    }

    localTgzPackage(archivePath: string): APIBuilder {
        this.logger.info(`Registering local tgz package: ${archivePath}`);
        this.managerInput.localTgzPackages.push({ archivePath: Path.resolve(archivePath) });
        return this;
    }

    introspection(userOpts?: Partial<IntrospectionWriterOptions>): APIBuilder {
        const defaultWriterOpts: FileSystemWriterOptions = {
            logger: this.logger,
            outputDir: this.options.outputDir,
            inMemoryOnly: false,
        };
        const opts: IntrospectionWriterOptions = {
            ...defaultWriterOpts,
            ...Object.fromEntries(Object.entries(userOpts ?? {}).filter(([_, v]) => v !== undefined)),
        };

        const writer = new IntrospectionWriter(opts);
        this.generators.push({ name: "introspection", writer });
        this.logger.debug(`Configured introspection generator (${JSON.stringify(opts, undefined, 2)})`);
        return this;
    }

    typescript(userOpts: Partial<TypeScriptOptions>) {
        const defaultWriterOpts: WriterOptions = {
            logger: this.logger,
            outputDir: Path.join(this.options.outputDir, "/types"),
            tabSize: 4,
            withDebugComment: false,
            commentLinePrefix: "//",
            generateProfile: true,
        };
        const defaultTsOpts: TypeScriptOptions = {
            ...defaultWriterOpts,
            openResourceTypeSet: false,
            primitiveTypeExtension: true,
        };
        const opts: TypeScriptOptions = {
            ...defaultTsOpts,
            ...Object.fromEntries(Object.entries(userOpts).filter(([_, v]) => v !== undefined)),
        };
        if (opts.terminology?.enabled) this.wantsTerminologyTypes = true;
        const generator = new TypeScript(opts);
        this.generators.push({ name: "typescript", writer: generator });
        this.logger.debug(`Configured TypeScript generator (${JSON.stringify(opts, undefined, 2)})`);
        return this;
    }

    python(userOptions: Partial<PythonGeneratorOptions>): APIBuilder {
        const defaultWriterOpts: WriterOptions = {
            logger: this.logger,
            outputDir: this.options.outputDir,
            tabSize: 4,
            withDebugComment: false,
            commentLinePrefix: "#",
        };

        const defaultPyOpts: PythonGeneratorOptions = {
            ...defaultWriterOpts,
            rootPackageName: "fhir_types",
            fieldFormat: "camelCase",
            primitiveTypeExtension: false,
        };

        const opts: PythonGeneratorOptions = {
            ...defaultPyOpts,
            ...Object.fromEntries(Object.entries(userOptions).filter(([_, v]) => v !== undefined)),
        };

        const generator = new Python(opts);
        this.generators.push({ name: "python", writer: generator });
        this.logger.debug(`Configured python generator`);
        return this;
    }

    mustache(templatePath: string, userOpts: Partial<FileSystemWriterOptions & FileBasedMustacheGeneratorOptions>) {
        const defaultWriterOpts: FileSystemWriterOptions = {
            logger: this.logger,
            outputDir: this.options.outputDir,
        };
        const defaultMustacheOpts: Partial<FileBasedMustacheGeneratorOptions> = {
            meta: {
                timestamp: new Date().toISOString(),
                generator: "atomic-codegen",
            },
        };
        const opts = {
            ...defaultWriterOpts,
            ...defaultMustacheOpts,
            ...userOpts,
        };
        const generator = Mustache.createGenerator(templatePath, opts);
        this.generators.push({ name: `mustache[${templatePath}]`, writer: generator });
        this.logger.debug(`Configured TypeScript generator (${JSON.stringify(opts, undefined, 2)})`);
        return this;
    }

    csharp(userOptions: Partial<CSharpGeneratorOptions>): APIBuilder {
        const defaultWriterOpts: WriterOptions = {
            logger: this.logger,
            outputDir: Path.join(this.options.outputDir, "/types"),
            tabSize: 4,
            withDebugComment: false,
            commentLinePrefix: "//",
        };

        const defaultCSharpOpts: CSharpGeneratorOptions = {
            ...defaultWriterOpts,
            rootNamespace: "Fhir.Types",
        };

        const opts: CSharpGeneratorOptions = {
            ...defaultCSharpOpts,
            ...Object.fromEntries(Object.entries(userOptions).filter(([_, v]) => v !== undefined)),
        };

        const generator = new CSharp(opts);
        this.generators.push({ name: "csharp", writer: generator });
        this.logger.debug(`Configured C# generator`);
        return this;
    }

    /**
     * Set the output directory for all generators
     */
    outputTo(directory: string): APIBuilder {
        this.logger.debug(`Setting output directory: ${directory}`);
        this.options.outputDir = directory;

        // Update all configured generators
        for (const gen of this.generators) {
            gen.writer.setOutputDir(directory);
        }

        return this;
    }

    throwException(enabled = true): APIBuilder {
        this.options.throwException = enabled;
        return this;
    }

    cleanOutput(enabled = true): APIBuilder {
        this.options.cleanOutput = enabled;
        return this;
    }

    /** Set when a TypeScript generator wants terminology modules: the emitted
     *  terminology types are derived from the generated CodeSystem type, so it
     *  must survive tree shaking even when the user's rules don't ask for it. */
    private wantsTerminologyTypes = false;

    typeSchema(cfg: IrConf) {
        this.options.typeSchema ??= {};
        if (cfg.treeShake) {
            assert(this.options.typeSchema.treeShake === undefined, "treeShake option is already set");
            this.options.typeSchema.treeShake = cfg.treeShake;
        }
        if (cfg.treeShakeDefaults) {
            assert(this.options.typeSchema.treeShakeDefaults === undefined, "treeShakeDefaults option is already set");
            this.options.typeSchema.treeShakeDefaults = cfg.treeShakeDefaults;
        }
        if (cfg.promoteLogical) {
            assert(this.options.typeSchema.promoteLogical === undefined, "promoteLogical option is already set");
            this.options.typeSchema.promoteLogical = cfg.promoteLogical;
        }
        if (cfg.resolveCollisions) {
            assert(this.options.typeSchema.resolveCollisions === undefined, "resolveCollisions option is already set");
            this.options.typeSchema.resolveCollisions = cfg.resolveCollisions;
        }
        this.irReport({});
        return this;
    }

    irReport(userOpts: Partial<IrReportWriterWriterOptions>) {
        const defaultWriterOpts: FileSystemWriterOptions = {
            logger: this.logger,
            outputDir: this.options.outputDir,
            inMemoryOnly: false,
        };
        const opts: IrReportWriterWriterOptions = {
            ...defaultWriterOpts,
            rootReadmeFileName: "README.md",
            ...Object.fromEntries(Object.entries(userOpts ?? {}).filter(([_, v]) => v !== undefined)),
        };

        const writer = new IrReportWriterWriter(opts);
        this.generators.push({ name: "ir-report", writer });
        this.logger.debug(`Configured ir-report generator (${JSON.stringify(opts, undefined, 2)})`);
        return this;
    }

    async generate(): Promise<GenerationReport> {
        const startTime = performance.now();
        const result: GenerationReport = {
            success: false,
            outputDir: this.options.outputDir,
            filesGenerated: {},
            errors: [],
            warnings: [],
            duration: 0,
        };

        this.logger.debug(`Starting generation with ${this.generators.length} generators`);
        try {
            assertUnambiguousRootPackageVersions(this.requestedPackages);
            if (this.options.cleanOutput) await cleanup(this.options, this.logger);

            let register: Register;
            if (this.prebuiltRegister) {
                this.logger.info("Using prebuilt register");
                register = this.prebuiltRegister;
            } else {
                this.logger.info("Initialize Canonical Manager");
                // Add all packages before initialization
                if (this.managerInput.npmPackages.length > 0) {
                    await this.manager.addPackages(...this.managerInput.npmPackages.sort());
                }
                // Add local packages and archives
                const resolvedLocalPackages: PackageMeta[] = [];
                for (const config of this.managerInput.localSDs) {
                    resolvedLocalPackages.push(await this.manager.addLocalPackage(config));
                }
                for (const tgzArchive of this.managerInput.localTgzPackages) {
                    resolvedLocalPackages.push(await this.manager.addTgzPackage(tgzArchive));
                }
                // Initialize after all packages are registered
                const ref2meta = await this.manager.init();

                const packageMetas = Object.values(ref2meta);
                const resolvedRoots = [...packageMetas, ...resolvedLocalPackages];
                assertUnambiguousRootPackageVersions([...this.requestedPackages, ...resolvedRoots]);
                await reportDependencyVersionMismatches(this.manager, resolvedRoots, result, this.logger);
                register = await registerFromManager(this.manager, {
                    logger: this.logger.fork("reg"),
                    focusedPackages: packageMetas,
                });
            }

            const tsLogger = this.logger.fork("ts");

            const { schemas: typeSchemas, collisions } = await generateTypeSchemas(
                register,
                this.options.typeSchema?.resolveCollisions,
                tsLogger,
            );

            const irReport = {
                resolveCollisions: this.options.typeSchema?.resolveCollisions,
                collisions,
            };
            const tsIndexOpts = { register, irReport, logger: tsLogger };
            let tsIndex = mkTypeSchemaIndex(typeSchemas, tsIndexOpts);
            if (this.options.typeSchema?.treeShake) {
                let shake = this.options.typeSchema.treeShake;
                if (this.wantsTerminologyTypes) {
                    const codeSystemCanonical = "http://hl7.org/fhir/StructureDefinition/CodeSystem";
                    const provider = tsIndex.schemas.find((schema) => schema.identifier.url === codeSystemCanonical);
                    if (provider) {
                        const pkg = provider.identifier.package;
                        shake = { ...shake, [pkg]: { ...(shake[pkg] ?? {}), [codeSystemCanonical]: {} } };
                    }
                }
                tsIndex = treeShake(tsIndex, shake, this.options.typeSchema.treeShakeDefaults);
            }
            if (this.options.typeSchema?.promoteLogical)
                tsIndex = promoteLogical(tsIndex, this.options.typeSchema.promoteLogical);

            tsLogger.printTagSummary();

            this.logger.debug(`Executing ${this.generators.length} generators`);

            await this.executeGenerators(result, tsIndex);

            this.logger.info("Generation completed successfully");

            result.success = result.errors.length === 0;

            const totalFiles = Object.values(result.filesGenerated).reduce((n, f) => n + Object.keys(f).length, 0);
            this.logger.debug(`Generation completed: ${totalFiles} files`);
        } catch (error) {
            this.logger.error(`Code generation failed: ${error instanceof Error ? error.message : String(error)}`);
            result.errors.push(error instanceof Error ? error.message : String(error));
            if (this.options.throwException) throw error;
        }

        return {
            ...result,
            success: result.errors.length === 0,
            duration: performance.now() - startTime,
        };
    }

    /**
     * Clear all configuration and start fresh
     */
    reset(): APIBuilder {
        this.generators = [];
        return this;
    }

    /**
     * Get configured generators (for inspection)
     */
    getGenerators(): string[] {
        return this.generators.map((g) => g.name);
    }

    private async executeGenerators(result: GenerationReport, tsIndex: TypeSchemaIndex): Promise<void> {
        for (const gen of this.generators) {
            this.logger.info(`Generating ${gen.name}...`);

            try {
                await gen.writer.generateAsync(tsIndex);
                const fileBuffer: FileBuffer[] = gen.writer.writtenFiles();
                const files = (result.filesGenerated[gen.name] ??= {});
                fileBuffer.forEach((buf) => {
                    files[buf.relPath] = buf.content;
                });
                this.logger.info(`Generating ${gen.name} finished successfully`);
            } catch (error) {
                result.errors.push(
                    `${gen.name} generator failed: ${error instanceof Error ? error.message : String(error)}`,
                );
                if (this.options.throwException) throw error;
            }
        }
    }
}
