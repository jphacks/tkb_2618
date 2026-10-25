import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../app/', import.meta.url));
const require = createRequire(import.meta.url);
const exec = promisify(execFile);
const cacheRoot = path.join(os.tmpdir(), 'tap-collect-app');
const pending = new Map();
const args = [
  '--ignoreConfig', '--target', 'ES2022', '--module', 'Node16',
  '--moduleResolution', 'Node16', '--strict', '--skipLibCheck', '--rootDir', 'src',
  'src/main/protocols/detector.ts', 'src/shared/calibration.ts',
  'src/shared/tap-procedure.ts', 'src/main/recorder.ts'
];

function sources(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? sources(file) : entry.isFile() && file.endsWith('.ts') ? [file] : [];
  });
}

async function compile(tsc, out) {
  if (fs.existsSync(path.join(out, 'ready'))) return;
  fs.mkdirSync(cacheRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(cacheRoot, '.compile-'));
  try {
    await exec(process.execPath, [tsc, ...args, '--outDir', staging], { cwd: root });
    fs.writeFileSync(path.join(staging, 'ready'), '');
    try {
      fs.renameSync(staging, out);
    } catch (error) {
      // Another process may have finished the identical compilation first.
      if (!fs.existsSync(path.join(out, 'ready'))) throw error;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Compile with the app's tsc once per source hash, shared by collection and scoring. */
export async function loadAppCode() {
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  if (!fs.existsSync(tsc)) throw Error('app/node_modules/typescript が必要です。app で npm ci を実行してください');
  const hash = createHash('sha256').update(JSON.stringify(args));
  hash.update(fs.readFileSync(path.join(root, 'node_modules/typescript/package.json')));
  const files = [...sources('src/shared'), ...sources('src/main/protocols'), 'src/main/recorder.ts'].sort();
  for (const file of files) hash.update(JSON.stringify([file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const key = hash.digest('hex');
  if (!pending.has(key)) {
    const out = path.join(cacheRoot, key);
    const loaded = compile(tsc, out).then(() => ({
      procedure: require(path.join(out, 'shared/tap-procedure.js')),
      Detector: require(path.join(out, 'main/protocols/detector.js')).Detector,
      calculateCalibration: require(path.join(out, 'shared/calibration.js')).calculateCalibration
    }));
    pending.set(key, loaded);
    loaded.catch(() => pending.delete(key));
  }
  return pending.get(key);
}
