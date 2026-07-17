import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distIndexPath = path.join(rootDir, 'dist', 'index.html');

function readGit(args, fallback) {
  try {
    return execSync(`git ${args}`, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
}

const commit = readGit('rev-parse --short=12 HEAD', 'unknown');
const commitDate = readGit('show -s --format=%cd --date=format:%Y-%m-%d-%H%M HEAD', 'unknown-date');
const dirty = readGit('status --porcelain', '') ? '-dirty' : '';
const appBuild = `ims-build-${commitDate}-${commit}${dirty}`;

let html = await fs.readFile(distIndexPath, 'utf8');
html = html
  .replace(/(<meta name="app-build" content=")([^"]*)(")/, (_match, prefix, _value, suffix) => `${prefix}${appBuild}${suffix}`)
  .replace(/(Build:\s*)([^<]*)/, (_match, prefix) => `${prefix}${appBuild}`)
  .replace(/(window\.__APP_BUILD__\s*=\s*')([^']*)(')/, (_match, prefix, _value, suffix) => `${prefix}${appBuild}${suffix}`);

await fs.writeFile(distIndexPath, html, 'utf8');
console.log(`Stamped build metadata: ${appBuild}`);
