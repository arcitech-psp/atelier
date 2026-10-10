#!/usr/bin/env node
// Atelier by ARCITECH, terminal entry point. See docs/CLI.md.
import {main} from '../src/main.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major >= 24 || (major === 22 && minor >= 19))) {
  process.stderr.write(`Atelier needs Node.js 24 (or 22.19 and newer); this is Node.js ${process.versions.node}.\n`);
  process.exit(1);
}
process.exitCode = await main();
// Let output drain; if a socket or timer is still open after that, do not hang the shell.
setTimeout(() => process.exit(), 1500).unref();
