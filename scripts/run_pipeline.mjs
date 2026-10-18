#!/usr/bin/env node
/**
 * Cross-platform runner for D'Maps Python pipeline tools.
 * Resolves virtual environment python automatically on Windows and Unix.
 *
 * Usage:
 *   node scripts/run_pipeline.mjs [script_name_or_module] [args...]
 * Default runs scripts/build_region.py
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

const venvPython = isWin
  ? join(root, 'pipeline', '.venv', 'Scripts', 'python.exe')
  : join(root, 'pipeline', '.venv', 'bin', 'python');

if (!existsSync(venvPython)) {
  console.error(`[!] Virtual environment python not found at: ${venvPython}`);
  console.error(`    Run: python -m venv pipeline/.venv && ... to initialize it.`);
  process.exit(1);
}

const userArgs = process.argv.slice(2);
let targetScript = join(root, 'scripts', 'build_region.py');
let scriptArgs = userArgs;

if (userArgs.length > 0 && userArgs[0].endsWith('.py')) {
  targetScript = join(root, userArgs[0]);
  scriptArgs = userArgs.slice(1);
}

const child = spawn(venvPython, ['-I', targetScript, ...scriptArgs], {
  cwd: root,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

