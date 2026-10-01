import { TRANSMISSIONS, normalizeSettings, createSimulator } from './model.js';

export const PROJECT_VERSION = 2;
export const COMPARISON_LIMIT = 4;
const validType = type => Object.hasOwn(TRANSMISSIONS, type);
const copy = value => JSON.parse(JSON.stringify(value));
const metrics = ['time', 'inputRpm', 'outputRpm', 'ratio', 'inputTorque', 'outputTorque', 'inputPowerKW', 'outputPowerKW', 'lossPowerKW'];

function finiteTree(value, depth = 0) {
  if (depth > 8) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 2000;
  if (Array.isArray(value)) return value.length <= 200 && value.every(v => finiteTree(v, depth + 1));
  if (value && typeof value === 'object') return Object.keys(value).length <= 150 && Object.entries(value).every(([key, v]) => !['__proto__', 'constructor', 'prototype'].includes(key) && finiteTree(v, depth + 1));
  return false;
}

export function captureComparison(settings, snapshot, name, appVersion = '') {
  if (!validType(settings?.type))throw new Error('비교 결과의 변속기 형식이 올바르지 않습니다.');
  const normalized=normalizeSettings(settings);
  if (snapshot?.type !== normalized.type || snapshot.gear !== normalized.gear || snapshot.inputRpm!==normalized.rpm || !metrics.every(key => Number.isFinite(snapshot[key])) || !finiteTree(snapshot)) throw new Error('비교 조건과 저장한 계산값이 올바르지 않습니다.');
  return { type: normalized.type, settings: copy(normalized), snapshot: copy(snapshot), name: String(name || normalized.type).slice(0, 100), source: 'captured', appVersion: String(appVersion).slice(0, 30) };
}

function readComparison(record, legacy) {
  if (!validType(record?.type) || record.settings?.type !== record.type) throw new Error('비교 조건의 변속기 형식이 올바르지 않습니다.');
  const settings = normalizeSettings(record.settings);
  if (!record.snapshot) {
    if (!legacy) throw new Error('저장한 순간의 비교 결과가 없습니다.');
    const simulator = createSimulator(settings);
    simulator.step(1);
    return { ...captureComparison(settings, simulator.snapshot(), record.name), source: 'recalculated-legacy' };
  }
  const next = captureComparison(settings, record.snapshot, record.name, record.appVersion);
  if (record.source === 'recalculated-legacy') next.source = record.source;
  return next;
}

export function createProject({ settings, view, comparisons = [], experiment = null, appVersion = '' }) {
  return { format: 'transmission-lab-project', version: PROJECT_VERSION, appVersion, createdAt: new Date().toISOString(), settings: copy(settings), view: { ...view, selectedPart: null }, comparisons: copy(comparisons), experiment: experiment ? copy(experiment) : null };
}

export function readProject(content) {
  if (typeof content !== 'string' || content.length > 2 * 1024 * 1024) throw new Error('프로젝트 파일은 2 MB 이하인 JSON이어야 합니다.');
  const data = JSON.parse(content);
  if (data?.format !== 'transmission-lab-project' || ![1, PROJECT_VERSION].includes(data.version) || !validType(data.settings?.type)) throw new Error('지원되는 Transmission Lab 프로젝트 파일이 아닙니다.');
  if (data.comparisons !== undefined && !Array.isArray(data.comparisons)) throw new Error('비교 결과 목록이 올바르지 않습니다.');
  if ((data.comparisons?.length || 0) > COMPARISON_LIMIT) throw new Error('비교 결과는 최대 4개까지 열 수 있습니다.');
  const comparisons = (data.comparisons || []).map(record => readComparison(record, data.version === 1));
  let experiment = null;
  if (data.experiment) {
    const before = readComparison(data.experiment.before, false), after = readComparison(data.experiment.after, false);
    if (before.type !== after.type || !Number.isFinite(data.experiment.duration) || data.experiment.duration < 0 || data.experiment.duration > 60) throw new Error('자동 실험 결과가 올바르지 않습니다.');
    experiment = { before, after, duration: data.experiment.duration };
  }
  return { settings: normalizeSettings(data.settings), view: data.view, comparisons, experiment, legacy: comparisons.some(c => c.source === 'recalculated-legacy') };
}
