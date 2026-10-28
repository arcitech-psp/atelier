import test from "node:test";
import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {DEFAULT_SCHEMA, load, Type} from "js-yaml";
const jsTag = new Type("tag:yaml.org,2002:js", {kind: "scalar", construct: value => value});
const schema = DEFAULT_SCHEMA.extend([jsTag]);

const root = resolve(fileURLToPath(new URL("../../../../..", import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, "RELEASE_MANIFEST.json"), "utf8"));
const presets = resolve(root, "harness/packages/preset/agent-presets/presets");
for (const id of manifest.agentPresets) {
  test(`loads ${id} and lists its tools`, () => {
    const folder = resolve(presets, id);
    const metadata = load(readFileSync(resolve(folder, "preset.yml"), "utf8"), {schema});
    const rows = load(readFileSync(resolve(folder, "agent.cordis.yml"), "utf8"), {schema});
    assert.ok(metadata.name); assert.ok(Array.isArray(rows));
    const plugins = []; const tools = [];
    const visit = entries => { for (const row of entries) {
      assert.equal(typeof row.name, "string", `${id}: every row must name a plugin`);
      assert.ok(!row.name.startsWith("file:"), `${id}: local file routes are not public`);
      if (row.name.startsWith("@")) {
        const packageName = row.name.split("/").slice(0, 2).join("/");
        assert.ok(existsSync(resolve(root, "node_modules", packageName, "package.json")), `${id}: missing ${packageName}`);
        plugins.push(row.name);
      }
      if (row.id && row.id !== "persona") tools.push(row.id);
      if (row.group) visit(row.config);
    }};
    visit(rows); console.log(`${id}: tools [${tools.join(", ")}] plugins [${plugins.join(", ")}]`);
  });
}
