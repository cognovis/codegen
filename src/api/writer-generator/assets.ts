/**
 * Static asset resolution for the code generators.
 *
 * Generators copy files verbatim out of `assets/api/writer-generator/<language>/`.
 * That directory sits at the package root and ships alongside `dist`, but the module
 * asking for it can be at very different depths: `src/api/writer-generator/<language>/
 * writer.ts` when running from source, `dist/index.js` when importing the bundled
 * library, and `dist/cli/index.js` when running the bundled CLI.
 *
 * Rather than encode those depths, walk up from the calling module until the asset
 * tree is found. Any future entry point is then handled without a change here, and a
 * missing asset reports every path that was tried instead of failing later with an
 * ENOENT on a path nobody recognises.
 */

import { existsSync } from "node:fs";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_ROOT_SEGMENTS = ["assets", "api", "writer-generator"] as const;

/** Directories walked upwards before giving up. Generous; the real depth is at most 4. */
const MAX_LOOKUP_DEPTH = 12;

/**
 * Resolve one static asset shipped with the package.
 *
 * @param moduleUrl - `import.meta.url` of the calling generator module.
 * @param language - Asset subdirectory, e.g. `"typescript"`.
 * @param fn - File name inside that subdirectory.
 * @returns Absolute path to the asset.
 * @throws When no ancestor directory carries the asset tree.
 *
 * @example
 * ```typescript
 * const helpers = resolveGeneratorAsset(import.meta.url, "typescript", "profile-helpers.ts");
 * ```
 */
export const resolveGeneratorAsset = (moduleUrl: string, language: string, fn: string): string => {
    const searched: string[] = [];
    let directory = Path.dirname(fileURLToPath(moduleUrl));

    for (let depth = 0; depth < MAX_LOOKUP_DEPTH; depth++) {
        const candidate = Path.resolve(directory, ...ASSET_ROOT_SEGMENTS, language, fn);
        searched.push(candidate);
        if (existsSync(candidate)) return candidate;

        const parent = Path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }

    throw new Error(`Cannot locate generator asset ${language}/${fn}. Looked in:\n  ${searched.join("\n  ")}`);
};
