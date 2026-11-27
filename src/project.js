import { isTransmissionType, normalizeSettings, createSimulator } from './model.js';
import limits from './project-limits.json' with { type: 'json' };

export const PROJECT_VERSION = 2;
export const COMPARISON_LIMIT = 4;
export const { maxProjectBytes, projectSizeError } = limits;
const encoder = new TextEncoder();
const format = 'transmission-lab-project';
const copy = value => JSON.parse(JSON.stringify(value));
const metrics = ['time', 'inputRpm', 'outputRpm', 'ratio', 'inputTorque', 'outputTorque', 'inputPowerKW', 'outputPowerKW', 'lossPowerKW'];

export function csvCell(value) {
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ');
  // Imported project text must stay data when a spreadsheet opens the CSV.
  const safe = typeof value === 'string' && /^[\s]*[=+\-@\uff1d\uff0b\uff0d\uff20]/u.test(text)
    ? `\t${text.trimStart()}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function checkProjectBytes(size) {
  if (size > maxProjectBytes) throw new Error(projectSizeError);
}

function checkProjectText(content) {
  if (typeof content !== 'string') throw new Error(projectSizeError);
  checkProjectBytes(content.length);
  checkProjectBytes(encoder.encode(content).byteLength);
}

function boundedSnapshot(value, budget, depth = 0) {
  if (depth > 8 || --budget.nodes < 0) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 2000 && (budget.text -= value.length) >= 0;
  if (Array.isArray(value)) return value.length <= 200 && value.every(child => boundedSnapshot(child, budget, depth + 1));
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value);
  return entries.length <= 150 && entries.every(([key, child]) =>
    key.length <= 100 && !['__proto__', 'constructor', 'prototype'].includes(key) &&
    (budget.text -= key.length) >= 0 && boundedSnapshot(child, budget, depth + 1));
}

export function captureComparison(settings, snapshot, name, appVersion = '') {
  if (!isTransmissionType(settings?.type)) throw new Error('비교 결과의 변속기 형식이 올바르지 않습니다.');
  const normalized=normalizeSettings(settings);
  // Keep historical calculation detail within a per-record budget before copying it.
  if (snapshot?.type !== normalized.type || snapshot.gear !== normalized.gear || snapshot.inputRpm !== normalized.rpm ||
      !metrics.every(key => Number.isFinite(snapshot[key])) || !boundedSnapshot(snapshot, { nodes: 2048, text: 8192 })) {
    throw new Error('비교 조건과 저장한 계산값이 올바르지 않습니다.');
  }
  return { type: normalized.type, settings: normalized, snapshot: copy(snapshot), name: (typeof name === 'string' && name ? name : normalized.type).slice(0, 100), source: 'captured', appVersion: typeof appVersion === 'string' ? appVersion.slice(0, 30) : '' };
}

function readComparison(record, legacy) {
  if (!isTransmissionType(record?.type) || record.settings?.type !== record.type) throw new Error('비교 조건의 변속기 형식이 올바르지 않습니다.');
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
  return { format, version: PROJECT_VERSION, appVersion, createdAt: new Date().toISOString(), settings: copy(settings), view: { ...view, selectedPart: null }, comparisons: copy(comparisons), experiment: experiment ? copy(experiment) : null };
}

export function serializeProject(project, space) {
  const content = JSON.stringify(project, null, space);
  checkProjectText(content);
  return content;
}

export function readProject(content, { storageVersion } = {}) {
  checkProjectText(content);
  let data = JSON.parse(content);
  if (storageVersion && data === null) return null;
  if (storageVersion === 1 && data && !data.format) data = { ...data, format, version: 1 };
  if (data?.format !== format || ![1, PROJECT_VERSION].includes(data.version) || !isTransmissionType(data.settings?.type)) throw new Error('지원되는 Transmission Lab 프로젝트 파일이 아닙니다.');
  if (data.comparisons !== undefined && !Array.isArray(data.comparisons)) throw new Error('비교 결과 목록이 올바르지 않습니다.');
  if ((data.comparisons?.length || 0) > COMPARISON_LIMIT) throw new Error('비교 결과는 최대 4개까지 열 수 있습니다.');
  const comparisons = (data.comparisons || []).map(record => readComparison(record, data.version === 1));
  let experiment = null;
  if (data.experiment != null) {
    if (typeof data.experiment !== 'object' || Array.isArray(data.experiment)) throw new Error('자동 실험 결과가 올바르지 않습니다.');
    const before = readComparison(data.experiment.before, false), after = readComparison(data.experiment.after, false);
    if (before.type !== after.type || !Number.isFinite(data.experiment.duration) || data.experiment.duration < 0 || data.experiment.duration > 60) throw new Error('자동 실험 결과가 올바르지 않습니다.');
    experiment = { before, after, duration: data.experiment.duration };
  }
  return { settings: normalizeSettings(data.settings), view: data.view, comparisons, experiment, legacy: comparisons.some(c => c.source === 'recalculated-legacy') };
}
