import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { diagnose } from '../diagnostics.mjs';
import { samples, zones } from '../scoring.mjs';
import { loadAppCode } from '../app-code.mjs';

export async function create() {
  const root = fileURLToPath(new URL('../../../app/', import.meta.url));
  const { Detector, calculateCalibration, procedure } = await loadAppCode();
  const { MountainCounter, restFrom, baselineOf, mountainThreshold, pickHits, TAPS_PER_STEP } = procedure;
  return {
    version: (await promisify(execFile)('git', ['rev-parse', 'HEAD'], {
      cwd: root
    })).stdout.trim(),
    timing: 'app の hitStartUs をサンプル番号に換算（読み取りのみ）。2 回は最初の打撃。',
    async train(sessions, select, params) {
      const diagnosticHits = [];
      const calibrationThresholds = [];
      const candidates = Array.from({
          length: zones.length
        }, () => []),
        noises = [];
      for (const session of sessions) {
        const sections = session.trials.filter(select).sort((a, b) => a.from - b.from).map(trial => ({ trial, rows: [] }));
        let section = 0;
        for await (const { i, values } of samples(session)) {
          while (section < sections.length && i >= sections[section].trial.to) section++;
          if (section === sections.length) break;
          if (i >= sections[section].trial.from) sections[section].rows.push(values);
        }
        let rest;
        for (const { trial, rows } of sections) {
          if (trial.kind === 'calibration') {
            const cue = trial.cue - trial.from;
            const { baseline, ...measured } = restFrom(rows.slice(0, cue), rows.slice(cue));
            rest = measured;
            noises.push(rest);
            calibrationThresholds.push({ session: session.dir, peak: rest.peak,
              threshold: mountainThreshold(rest.peak) });
            continue;
          }
          if (!['cal_single', 'cal_double'].includes(trial.kind)) continue;
          if (!rest) throw Error('校正用の打撃より前に静止の測定がありません');
          const pre = rows.slice(0, trial.cue - trial.from);
          const baseline = baselineOf(pre);
          const found = [];
          // Use the app's prompted recorder, not the run-mode detector, to extract calibration hits.
          const counter = new MountainCounter(baseline, rest.peak, session.meta.rate, hit => {
            found.push(hit);
            diagnosticHits.push({ session: session.dir, i: trial.cue + counter.start,
              saturated: !!hit.sat });
          });
          for (const row of rows.slice(trial.cue - trial.from)) counter.push(row);
          counter.finish();
          const index = trial.kind === 'cal_single' ? zones.indexOf(trial.zone) : -1;
          if (index >= 0) {
            // Pool every trial for this region, including both halves of legacy logs.
            candidates[index].push(...found);
          }
        }
      }
      if (!noises.length) throw Error('キャリブレーション側にノイズ測定（calibration 試行）がありません');
      const noise = {
        t: 'noise',
        peak: [0, 1, 2, 3].map(c => Math.max(...noises.map(n => n.peak[c]))),
        rms: noises[0].rms
      };
      for (const k of Object.keys(params)) if (!['threshold', 'doubleWindowMs', 'refractoryMs'].includes(k)) throw Error(`不明な app params: ${k}`);
      const hits = candidates.map(found => pickHits(found, Math.min(TAPS_PER_STEP, found.filter(h => !h.sat).length)));
      let calibration;
      try {
        const missing = hits.map((h, i) => `${zones[i]}:${h.length}/${TAPS_PER_STEP}`);
        if (hits.some(h => h.length < TAPS_PER_STEP)) throw Error(`キャリブレーションの打数不足: ${missing.join(', ')}`);
        calibration = { ...calculateCalibration(noise, hits), ...params };
        if (!new Detector(() => {}).setCalibration(calibration)) throw Error('上書き後の校正値が不正です');
      } catch (e) {
        e.diagnostics = diagnose(sessions, diagnosticHits, params.doubleWindowMs ?? 350, { error: e.message, calibrationThresholds });
        throw e;
      }
      return {
        diagnostics: diagnose(sessions, diagnosticHits, calibration.doubleWindowMs, calibration),
        calibration,
        calibrationThresholds,
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
    // Compiled code is shared with core.mjs and retained for the next run.
    close() {}
  };
}
