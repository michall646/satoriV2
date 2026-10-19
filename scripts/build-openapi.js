// Regenerate openapi.json from openapi.yaml. Run after editing the YAML.
// Requires a YAML parser available to node (js-yaml is a dev-only convenience).
//   npm i -D js-yaml
//   node scripts/build-openapi.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

let yaml;
try {
  yaml = require('js-yaml');
} catch {
  console.error('build-openapi: js-yaml is required. Run `npm i -D js-yaml` first.');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const src = path.join(root, 'openapi.yaml');
const dst = path.join(root, 'openapi.json');
const doc = yaml.load(fs.readFileSync(src, 'utf8'));
fs.writeFileSync(dst, JSON.stringify(doc, null, 2) + '\n');
console.log(`openapi.json: ${Object.keys(doc.paths || {}).length} paths`);
