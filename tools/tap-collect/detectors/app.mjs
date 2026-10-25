import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { diagnose } from '../diagnostics.mjs';
import { samples, zones, contains } from '../scoring.mjs';

export async function create() {
  const root = fileURLToPath(new URL('../../../app/', import.meta.url));
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  if (!fs.existsSync(tsc)) throw Error('app/node_modules/typescript が必要です。app の依存を準備してください');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-score-app-'));
  try {
    const require = createRequire(import.meta.url);
    await promisify(execFile)(process.execPath, [
      tsc,
      '--ignoreConfig',
      '--target',
      'ES2022',
      '--module',
      'Node16',
      '--moduleResolution',
      'Node16',
      '--strict',
      '--skipLibCheck',
      '--outDir',
      out,
      '--rootDir',
      'src',
      'src/main/protocols/detector.ts',
      'src/shared/calibration.ts'
    ], {
      cwd: root
    });
    const {
      Detector
    } = require(path.join(out, 'main/protocols/detector.js'));
    const {
      calculateCalibration
    } = require(path.join(out, 'shared/calibration.js'));
    return {
      version: (await promisify(execFile)('git', ['rev-parse', 'HEAD'], {
        cwd: root
      })).stdout.trim(),
      timing: 'app の hitStartUs をサンプル番号に換算（読み取りのみ）。2 回は最初の打撃。',
      async train(sessions, select, params) {
        const diagnosticHits = [];
        const hits = Array.from({
            length: 8
          }, () => []),
          noises = [];
        for (const session of sessions) {
          const trials = session.trials.filter(t => select(t));
          let current = 0;
          const detector = new Detector(e => {
            if (e.t === 'noise') noises.push(e);
            if (e.t === 'hit') {
              diagnosticHits.push({ session: session.dir, i: Math.round(detector.hitStartUs * session.meta.rate / 1e6), amplitude: Math.max(...e.peaks), saturated: !!e.sat });
              const trial = trials.find(t => t.kind === 'cal_single' && current >= t.cue && current < t.to);
              const index = trial ? zones.indexOf(trial.zone) * 2 + (trial.strength === 'strong' ? 1 : 0) : -1;
              if (index >= 0 && ['weak', 'strong'].includes(trial.strength) && !e.sat && hits[index].length < 3) hits[index].push(e);
            }
          });
          detector.setMode('calibrate');
          for await (const {
            i,
            values
          } of samples(session)) {
            current = i;
            const noise = trials.find(t => t.kind === 'calibration' && t.cue === i);
            if (noise) detector.measureNoise((noise.to - noise.cue) * 1000 / session.meta.rate, i * 1e6 / session.meta.rate);
            detector.sample(values, i * 1e6 / session.meta.rate);
          }
        }
        if (!noises.length) throw Error('キャリブレーション側にノイズ測定（calibration 試行）がありません');
        const noise = {
          t: 'noise',
          peak: [0, 1, 2, 3].map(c => Math.max(...noises.map(n => n.peak[c]))),
          rms: noises[0].rms
        };
        for (const k of Object.keys(params)) if (!['threshold', 'strongMin', 'doubleWindowMs', 'refractoryMs'].includes(k)) throw Error(`不明な app params: ${k}`);
        let calibration;
        try {
          const missing = hits.map((h, i) => `${zones[Math.floor(i / 2)]}/${i % 2 ? 'strong' : 'weak'}:${h.length}/3`);
          if (hits.some(h => h.length < 3)) throw Error(`キャリブレーションの打数不足: ${missing.join(', ')}`);
          calibration = { ...calculateCalibration(noise, hits), ...params };
          if (!new Detector(() => {}).setCalibration(calibration)) throw Error('上書き後の校正値が不正です');
        } catch (e) {
          e.diagnostics = diagnose(sessions, diagnosticHits, params.doubleWindowMs ?? 350, { error: e.message });
          throw e;
        }
        return {
          diagnostics: diagnose(sessions, diagnosticHits, calibration.doubleWindowMs, calibration),
          calibration,
          noise,
          hits
        };
      },
      async replay(session, model) {
        const taps = [];
        let i = 0;
        const detector = new Detector(e => {
          if (e.t === 'tap') taps.push({
            ...e,
            i: Math.round(detector.pendingStartUs * session.meta.rate / 1e6),
            zone: zones[e.region]
          });
        });
        // TS private fields are ordinary JS properties; no source rewriting is needed.
        detector.setCalibration(model.calibration);
        for await (const row of samples(session)) {
          i = row.i;
          detector.sample(row.values, i * 1e6 / session.meta.rate);
        }
        return {
          taps,
          totalSamples: i + 1
        };
      },
      close() {
        fs.rmSync(out, {
          recursive: true,
          force: true
        });
      }
    };
  } catch (e) {
    fs.rmSync(out, {
      recursive: true,
      force: true
    });
    throw e;
  }
}
