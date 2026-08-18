/**
 * Generate Command
 *
 * Runs one or more `APIBuilder` pipelines described by a JSON configuration file, so a generation
 * setup can live in data instead of a hand-written script.
 */

import { readFile } from "node:fs/promises";
import * as Path from "node:path";
import {
    describeGenerateConfig,
    GenerateConfigError,
    type GenerateRunResult,
    parseGenerateConfig,
    runGenerateConfig,
} from "@root/api/generate-config";
import { complete, list } from "@root/utils/cli-fmt";
import { mkCodegenLogger } from "@root/utils/log";
import type { CommandModule } from "yargs";

type GenerateArgs = {
    config: string;
    dryRun?: boolean;
};

export type GenerateCommandDeps = Parameters<typeof runGenerateConfig>[1];

const readConfigFile = async (configPath: string): Promise<unknown> => {
    let content: string;
    try {
        content = await readFile(configPath, "utf-8");
    } catch (error) {
        throw new Error(`Cannot read config file ${configPath}: ${error instanceof Error ? error.message : error}`);
    }
    try {
        return JSON.parse(content);
    } catch (error) {
        throw new Error(
            `Config file ${configPath} is not valid JSON: ${error instanceof Error ? error.message : error}`,
        );
    }
};

const reportRun = (result: GenerateRunResult): void => {
    for (const builder of result.builders) {
        if (builder.success) {
            complete(`${builder.name}: generated into ${builder.outputDir}`);
            continue;
        }
        console.error(`${builder.name}: FAILED`);
        list(builder.errors.length > 0 ? builder.errors : ["generation reported no details"]);
    }
};

/**
 * Execute the command and return the process exit code.
 *
 * Kept separate from the yargs handler so the behaviour is callable and testable without a
 * process boundary.
 */
export const runGenerateCommand = async (args: GenerateArgs, deps: GenerateCommandDeps = {}): Promise<number> => {
    const logger = mkCodegenLogger({ prefix: "generate" });
    const configPath = Path.resolve(args.config);

    let result: GenerateRunResult;
    try {
        const config = parseGenerateConfig(await readConfigFile(configPath), configPath);

        if (args.dryRun) {
            console.log(describeGenerateConfig(config));
            logger.info("Dry run: nothing was generated");
            return 0;
        }

        result = await runGenerateConfig(config, { logger, ...deps });
    } catch (error) {
        if (error instanceof GenerateConfigError) logger.error(error.message);
        else logger.error(error instanceof Error ? error.message : String(error));
        return 1;
    }

    reportRun(result);
    if (result.success) return 0;

    const failed = result.builders.filter((builder) => !builder.success).map((builder) => builder.name);
    logger.error(`${failed.length} of ${result.builders.length} builder(s) failed: ${failed.join(", ")}`);
    return 1;
};

export const generateCommand: CommandModule<Record<string, unknown>, GenerateArgs> = {
    command: "generate",
    describe: "Generate code from a JSON configuration file",
    builder: {
        config: {
            alias: "c",
            type: "string",
            demandOption: true,
            describe: "Path to the JSON generation config. Relative paths inside it resolve against its directory",
        },
        "dry-run": {
            type: "boolean",
            default: false,
            describe: "Validate the config and print the resolved plan without generating anything",
        },
    },
    handler: async (argv) => {
        const code = await runGenerateCommand({ config: argv.config, dryRun: argv.dryRun });
        if (code !== 0) process.exit(code);
    },
};
