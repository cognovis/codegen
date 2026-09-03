import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// Golden snapshot of the generated kjernejournal profile modules. The
// on-the-fly fhir-types output is not committed, so this snapshot is what
// makes generator-driven changes to the norge output reviewable. Run
// `bun run examples/on-the-fly/norge-r4/generate.ts` first (the Makefile
// target does), and refresh with `bun test kjernejournal-profiles -u` after
// an intentional generator change.

const profilesDir = `${import.meta.dir}/fhir-types/nhn-fhir-no-kjernejournal/profiles`;

describe("norge-r4 kjernejournal generated profiles", () => {
    const files = readdirSync(profilesDir)
        .filter((f) => f.endsWith(".ts"))
        .sort();

    it("generates the expected profile set", () => {
        expect(files).toMatchSnapshot();
    });

    it("matches golden output for every profile module", () => {
        for (const file of files) expect(readFileSync(`${profilesDir}/${file}`, "utf8")).toMatchSnapshot(file);
    });
});
