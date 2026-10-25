import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { diagnose } from '../diagnostics.mjs';
import { samples, zones, contains } from '../scoring.mjs';
function hashFolder(dir, hash = createHash('sha256'), prefix = '') {
  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true
  }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) hashFolder(path.join(dir, entry.name), hash, name + '/');else if (entry.isFile()) hash.update(name + '\0').update(fs.readFileSync(path.join(dir, entry.name))).update('\0');else throw Error('takker フォルダ内のリンクは使用できません');
  }
  return hash;
}

export async function create(o) {
  if (!o.takker) throw Error('--takker <sensor-runtime のフォルダ> が必要です');
  const dir = fs.realpathSync(o.takker);
  const channels = (o.channels ?? 'D0,D4').split(',');
  if (channels.length !== 2 || new Set(channels).size !== 2 || channels.some(c => !['D0', 'D1', 'D3', 'D4'].includes(c))) throw Error('--channels は異なる 2 入力です');
  const {
    SensorPipeline
  } = await import(pathToFileURL(path.join(dir, 'pipeline.js')));
  const {
    features,
    classify,
    Gestures,
    TARGETS,
    REQUIRED
  } = await import(pathToFileURL(path.join(dir, 'calibration.js')));
  function pipeline(session, params) {
    const options = {
      ...params.pipeline,
      sampleRate: session.meta.rate,
      activeChannels: channels
    };
    return new SensorPipeline(options);
  }
  return {
    version: hashFolder(dir).digest('hex'),
    timing: 'takker の startSample。2 回は最初の打撃。Gestures のタイマーはサンプル時計で実行。',
    async train(sessions, select, params) {
      for (const k of Object.keys(params)) if (!['pipeline', 'gestures'].includes(k)) throw Error(`不明な takker params: ${k}（pipeline / gestures に指定）`);
      if (params.pipeline?.sampleRate !== undefined || params.pipeline?.activeChannels !== undefined) throw Error('sampleRate / activeChannels はログと --channels で指定します');
      if (params.gestures && Object.keys(params.gestures).some(k => k !== 'doubleMs')) throw Error('gestures は doubleMs のみ指定できます');
      if (params.gestures?.doubleMs !== undefined && !(Number.isFinite(params.gestures.doubleMs) && params.gestures.doubleMs > 0)) throw Error('doubleMs が不正です');
      const trainingZones = [...new Set(sessions.flatMap(s => s.trials.filter(t => select(t) && t.kind === 'cal_single').map(t => t.zone)))];
      const diagonal = channels.map(c => zones[['D0', 'D1', 'D3', 'D4'].indexOf(c)]);
      if (trainingZones.length !== 4 && !(trainingZones.length === 2 && diagonal.every(z => trainingZones.includes(z)) && [['D0', 'D4'], ['D1', 'D3']].some(pair => pair.every(c => channels.includes(c))))) throw Error('キャリブレーションする領域は全 4 領域、または --channels に対応する対角 2 領域にしてください');
      const activeTargets = TARGETS.filter(t => trainingZones.includes(zones[t.region])).map(t => t.id);
      if (!activeTargets.length) throw Error('キャリブレーションする領域がありません');
      const diagnosticHits = [];
      const learned = Array.from({
          length: 8
        }, () => []),
        calibration = [];
      for (const session of sessions) {
        const trials = session.trials.filter(t => select(t) && t.kind === 'cal_single' && t.count === 1);
        const p = pipeline(session, params);
        p.on('calibrated', e => calibration.push(e));
        p.on('tap', tap => {
          diagnosticHits.push({ session: session.dir, i: tap.startSample, amplitude: Math.hypot(...channels.map(c => tap.peaks[c])), saturated: !!tap.clipped });
          const trial = trials.find(t => contains(t, tap.startSample, session.meta.rate));
          if (!trial || !['weak', 'strong'].includes(trial.strength)) return;
          const target = zones.indexOf(trial.zone) * 2 + (trial.strength === 'strong' ? 1 : 0);
          if (learned[target].length >= REQUIRED) return;
          try {
            learned[target].push(features(tap, channels));
          } catch {/* Same rejection as the training UI. */}
        });
        for await (const {
          i,
          values
        } of samples(session)) p.accept({
          type: 'sample',
          values
        }, i * 1000 / session.meta.rate);
      }
      const centers = learned.map(rows => rows.length ? rows[0].map((_, i) => rows.reduce((n, r) => n + r[i], 0) / rows.length) : null);
      const spread = [0.20, 0.06, 0.25, 0.25, 0.6].map((floor, i) => {
        const residuals = activeTargets.flatMap(id => learned[id].map(r => (r[i] - centers[id][i]) ** 2));
        return Math.max(floor, Math.sqrt(residuals.reduce((n, v) => n + v, 0) / Math.max(1, residuals.length)));
      });
      const diagnostics = diagnose(sessions, diagnosticHits, params.gestures?.doubleMs ?? 420, { centers, spread });
      if (activeTargets.some(id => learned[id].length < REQUIRED)) {
        const error = Error(`キャリブレーションの打数不足（必要 ${REQUIRED}）: ${activeTargets.map(id => `${zones[Math.floor(id / 2)]}/${id % 2 ? 'strong' : 'weak'}:${learned[id].length}`).join(', ')}`);
        error.diagnostics = diagnostics;
        throw error;
      }
      return {
        diagnostics,
        samples: learned,
        activeTargets,
        regions: trainingZones,
        channels,
        params,
        calibration
      };
    },
    async replay(session, model) {
      const p = pipeline(session, model.params),
        taps = [],
        timers = new Map();
      let now = 0,
        next = 0,
        totalSamples = 0;
      const advance = time => {
        while (true) {
          const due = [...timers].filter(([, t]) => t.at <= time).sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          timers.delete(due[0]);
          now = due[1].at;
          due[1].fn();
        }
        now = time;
      };
      const gestures = new Gestures(e => taps.push({
        ...e,
        i: e.firstSample ?? e.startSample,
        zone: zones[e.region],
        strength: e.strength ? 'strong' : 'weak'
      }), {
        ...model.params.gestures,
        setTimer(fn, ms) {
          const id = ++next;
          timers.set(id, {
            fn,
            at: now + ms
          });
          return id;
        },
        clearTimer(id) {
          timers.delete(id);
        }
      });
      p.on('tap', tap => {
        try {
          const hit = classify(model.samples, features(tap, channels), model.activeTargets);
          if (hit.accepted) {
            const previous = gestures.pending;
            const isDouble = previous && previous.region === hit.region && previous.strength === hit.strength && tap.estimatedStartMs - previous.estimatedStartMs >= 80 && tap.estimatedStartMs - previous.estimatedStartMs <= gestures.doubleMs;
            gestures.accept({
              ...tap,
              ...hit,
              firstSample: isDouble ? previous.startSample : tap.startSample
            });
          }
        } catch {/* Rejected waveform produces no gesture. */}
      });
      for await (const {
        i,
        values
      } of samples(session)) {
        advance(i * 1000 / session.meta.rate);
        p.accept({
          type: 'sample',
          values
        }, now);
        totalSamples = i + 1;
      }
      advance(Infinity);
      gestures.clear();
      return {
        taps,
        totalSamples
      };
    },
    close() {}
  };
}
