import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as Path from "node:path";
import type { GenerationReport } from "@root/api/builder";
import type { GenerationBuilder } from "@root/api/generate-config";
import { generateCommand, runGenerateCommand } from "@root/cli/commands/generate";

const mkReport = (success: boolean, errors: string[]): GenerationReport => ({
    success,
    outputDir: "",
    filesGenerated: {},
    errors,
    warnings: [],
    duration: 0,
});

/** A builder that accepts every call and reports the configured outcome. */
const mkStubBuilder = (outcome: { success: boolean; errors?: string[] }): GenerationBuilder => {
    const builder = {
        generate: async () => mkReport(outcome.success, outcome.errors ?? []),
    } as GenerationBuilder;
    const methods = [
        "fromPackage",
        "fromPackageRef",
        "localTgzPackage",
        "localStructureDefinitions",
        "typeSchema",
        "introspection",
        "typescript",
        "python",
        "csharp",
        "outputTo",
        "cleanOutput",
        "throwException",
    ] as const;
    for (const method of methods) {
        (builder as unknown as Record<string, () => GenerationBuilder>)[method] = () => builder;
    }
    return builder;
};

const writeConfig = (content: unknown | string): string => {
    const dir = mkdtempSync(Path.join(tmpdir(), "atomic-codegen-cli-"));
    const configPath = Path.join(dir, "codegen.json");
    writeFileSync(configPath, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf-8");
    return configPath;
};

const twoBuilderConfig = {
    version: 1,
    builders: [
        {
            name: "core",
            fromPackages: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
            typescript: {},
            outputTo: "./out/core",
        },
        {
            name: "extras",
            fromPackages: [{ name: "example.extras", version: "1.0.0" }],
            typescript: {},
            outputTo: "./out/extras",
        },
    ],
};

type Captured = { lines: string[]; restore: () => void };

const captureConsole = (): Captured => {
    const lines: string[] = [];
    const push =
        () =>
        (...args: unknown[]): void => {
            lines.push(args.map(String).join(" "));
        };
    const log = spyOn(console, "log").mockImplementation(push());
    const error = spyOn(console, "error").mockImplementation(push());
    const warn = spyOn(console, "warn").mockImplementation(push());
    return {
        lines,
        restore: () => {
            log.mockRestore();
            error.mockRestore();
            warn.mockRestore();
        },
    };
};

let captured: Captured | undefined;

afterEach(() => {
    captured?.restore();
    captured = undefined;
});

describe("generate command module", () => {
    it("exposes an accurate command surface", () => {
        expect(generateCommand.command).toBe("generate");
        expect(generateCommand.describe).toBe("Generate code from a JSON configuration file");

        const options = generateCommand.builder as Record<string, Record<string, unknown>>;
        expect(options.config!.demandOption).toBe(true);
        expect(options.config!.alias).toBe("c");
        expect(options.config!.type).toBe("string");
        expect(String(options.config!.describe)).toContain("resolve against its directory");
        expect(options["dry-run"]!.type).toBe("boolean");
        expect(options["dry-run"]!.default).toBe(false);
    });
});

describe("runGenerateCommand", () => {
    it("returns 0 and reports each builder on success", async () => {
        const configPath = writeConfig(twoBuilderConfig);
        captured = captureConsole();

        const code = await runGenerateCommand(
            { config: configPath },
            { createBuilder: () => mkStubBuilder({ success: true }) },
        );

        expect(code).toBe(0);
        const output = captured.lines.join("\n");
        expect(output).toContain("core: generated into");
        expect(output).toContain("extras: generated into");
    });

    it("dry run prints the plan and generates nothing", async () => {
        const configPath = writeConfig(twoBuilderConfig);
        const outputDir = Path.join(Path.dirname(configPath), "out");
        captured = captureConsole();

        const code = await runGenerateCommand(
            { config: configPath, dryRun: true },
            {
                createBuilder: () => {
                    throw new Error("dry run must not construct a builder");
                },
            },
        );

        expect(code).toBe(0);
        expect(existsSync(outputDir)).toBe(false);
        const output = captured.lines.join("\n");
        expect(output).toContain("Generate plan (2 builder(s)):");
        expect(output).toContain(Path.join(outputDir, "core"));
        expect(output).toContain("Dry run: nothing was generated");
    });

    it("returns 1 and lists every failing builder", async () => {
        const configPath = writeConfig(twoBuilderConfig);
        captured = captureConsole();
        const outcomes = [
            { success: false, errors: ["typescript generator failed: boom"] },
            { success: false, errors: ["python generator failed: kaboom"] },
        ];
        let index = 0;

        const code = await runGenerateCommand(
            { config: configPath },
            {
                createBuilder: () => {
                    const outcome = outcomes[index] ?? { success: true };
                    index += 1;
                    return mkStubBuilder(outcome);
                },
            },
        );

        expect(code).toBe(1);
        const output = captured.lines.join("\n");
        expect(output).toContain("core: FAILED");
        expect(output).toContain("typescript generator failed: boom");
        expect(output).toContain("extras: FAILED");
        expect(output).toContain("python generator failed: kaboom");
        expect(output).toContain("2 of 2 builder(s) failed: core, extras");
    });

    it("keeps going after one builder fails", async () => {
        const configPath = writeConfig(twoBuilderConfig);
        captured = captureConsole();
        let constructed = 0;

        const code = await runGenerateCommand(
            { config: configPath },
            {
                createBuilder: () => {
                    constructed += 1;
                    return mkStubBuilder(constructed === 1 ? { success: false, errors: ["boom"] } : { success: true });
                },
            },
        );

        expect(code).toBe(1);
        expect(constructed).toBe(2);
        const output = captured.lines.join("\n");
        expect(output).toContain("extras: generated into");
        expect(output).toContain("1 of 2 builder(s) failed: core");
    });

    it("returns 1 with a config error naming the offending path", async () => {
        const configPath = writeConfig({
            version: 1,
            builders: [{ name: "core", fromPackages: [{ name: "x", version: "1.0.0" }], typescript: {} }],
        });
        captured = captureConsole();

        const code = await runGenerateCommand({ config: configPath });

        expect(code).toBe(1);
        expect(captured.lines.join("\n")).toContain("builders[0].outputTo: outputTo is required");
    });

    it("returns 1 when the config file is not valid JSON", async () => {
        const configPath = writeConfig("{ not json");
        captured = captureConsole();

        const code = await runGenerateCommand({ config: configPath });

        expect(code).toBe(1);
        expect(captured.lines.join("\n")).toContain("is not valid JSON");
    });

    it("returns 1 when the config file does not exist", async () => {
        const configPath = Path.join(mkdtempSync(Path.join(tmpdir(), "atomic-codegen-cli-")), "missing.json");
        captured = captureConsole();

        const code = await runGenerateCommand({ config: configPath });

        expect(code).toBe(1);
        expect(captured.lines.join("\n")).toContain("Cannot read config file");
    });
});
