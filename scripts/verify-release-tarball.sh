#!/usr/bin/env bash
set -euo pipefail

tarball_path=${1:?Usage: scripts/verify-release-tarball.sh <tarball> <sliced-choice-fixture-dir>}
fixture_dir=${2:?Usage: scripts/verify-release-tarball.sh <tarball> <sliced-choice-fixture-dir>}

test -f "$tarball_path"
test -d "$fixture_dir"
tarball_path="$(cd "$(dirname "$tarball_path")" && pwd)/$(basename "$tarball_path")"

verification_dir=$(mktemp -d)
package_root="$verification_dir/installed-package"
generated_root="$verification_dir/generated"
config_path="$verification_dir/codegen.json"

mkdir -p "$package_root"
pushd "$package_root" >/dev/null
npm init --yes >/dev/null
npm install --ignore-scripts --no-audit --no-fund "$tarball_path"
popd >/dev/null

cli_path="$package_root/node_modules/.bin/atomic-codegen"
test -x "$cli_path"
"$cli_path" --help >/dev/null

cat >"$config_path" <<EOF
{
  "version": 1,
  "builders": [
    {
      "name": "sliced-choice",
      "localStructureDefinitions": [
        {
          "package": { "name": "example.test.slicedchoice", "version": "0.0.1" },
          "path": "${fixture_dir}",
          "dependencies": [{ "name": "hl7.fhir.r4.core", "version": "4.0.1" }]
        }
      ],
      "typescript": { "generateProfile": true, "withDebugComment": false },
      "outputTo": "${generated_root}",
      "cleanOutput": true
    }
  ]
}
EOF

"$cli_path" --log-level SILENT generate --config "$config_path"

# TypeScript import specifiers are preserved by this transpilation. Node therefore
# resolves the same ESM module graph consumers receive from generated output.
bun -e '
const root = process.argv[1];
const fs = await import("node:fs/promises");
const path = await import("node:path");
const ts = new Bun.Transpiler({ loader: "ts" });
for (const entry of await fs.readdir(root, { recursive: true })) {
    if (!entry.endsWith(".ts")) continue;
    const source = path.join(root, entry);
    await Bun.write(source.replace(/\.ts$/, ".js"), ts.transformSync(await Bun.file(source).text()));
}
await Bun.write(`${root}/package.json`, JSON.stringify({ type: "module" }));
' "$generated_root"

GENERATED_ROOT="$generated_root" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import * as Path from "node:path";
import { pathToFileURL } from "node:url";

const profileModule = await import(
    pathToFileURL(
        Path.join(
            process.env.GENERATED_ROOT,
            "example-test-slicedchoice/profiles/Observation_SlicedChoiceObservation.js",
        ),
    ).href,
);
const { SlicedChoiceObservationProfile } = profileModule;
const baseArgs = {
    status: "final",
    code: { coding: [{ system: "http://example.test/CodeSystem/observation-kind", code: "example" }] },
};

const present = SlicedChoiceObservationProfile.apply(SlicedChoiceObservationProfile.createResource(baseArgs));
present.setCodedFinding({ coding: [{ system: "http://example.test/CodeSystem/finding", code: "present" }] });
present.setMeasuredFinding({ valueQuantity: { value: 3, unit: "mm" } });
assert.doesNotThrow(() => SlicedChoiceObservationProfile.from(present.toResource()));

const missing = SlicedChoiceObservationProfile.apply(SlicedChoiceObservationProfile.createResource(baseArgs));
missing.setCodedFinding({ coding: [{ system: "http://example.test/CodeSystem/finding", code: "present" }] });
missing.setMeasuredFinding({});
assert.throws(
    () => SlicedChoiceObservationProfile.from(missing.toResource()),
    /at least one of valueQuantity, valueString is required/,
);
NODE
