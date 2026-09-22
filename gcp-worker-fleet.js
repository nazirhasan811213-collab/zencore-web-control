'use strict';

const ALLOWED_FIELDS = new Set([
  'projectId', 'zone', 'instanceName', 'serviceAccountEmail', 'capacity'
]);

function workerConfigError(message) {
  const error = new Error(message);
  error.code = 'INVALID_GCP_WORKER_FLEET';
  return error;
}

function normaliseWorker(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !ALLOWED_FIELDS.has(key))) {
    throw workerConfigError('ZENCORE_GCP_WORKER_FLEET_JSON contains invalid fields.');
  }
  const worker = {
    projectId: String(input.projectId || ''),
    zone: String(input.zone || ''),
    instanceName: String(input.instanceName || ''),
    serviceAccountEmail: String(input.serviceAccountEmail || ''),
    capacity: Math.min(50, Math.max(1, Number(input.capacity) || 10))
  };
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(worker.projectId) ||
      !/^[a-z]+-[a-z]+\d-[a-z]$/.test(worker.zone) ||
      !/^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(worker.instanceName) ||
      !/^[a-z0-9-]{6,30}@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(worker.serviceAccountEmail) ||
      !Number.isInteger(Number(input.capacity ?? 10)) || Number(input.capacity ?? 10) < 1 ||
      Number(input.capacity ?? 10) > 50) {
    throw workerConfigError('ZENCORE_GCP_WORKER_FLEET_JSON contains an invalid worker.');
  }
  return Object.freeze(worker);
}

function parseGcpWorkerFleet(rawJson, fallback = {}) {
  const raw = String(rawJson || '').trim();
  let values;
  if (raw) {
    try { values = JSON.parse(raw); } catch (_) {
      throw workerConfigError('ZENCORE_GCP_WORKER_FLEET_JSON must be valid JSON.');
    }
    if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
      throw workerConfigError('ZENCORE_GCP_WORKER_FLEET_JSON must contain 1 to 50 workers.');
    }
  } else {
    values = [fallback];
  }
  const workers = values.map(normaliseWorker);
  const identities = new Set();
  for (const worker of workers) {
    const key = `${worker.projectId}|${worker.zone}|${worker.instanceName}`;
    if (identities.has(key)) {
      throw workerConfigError('ZENCORE_GCP_WORKER_FLEET_JSON contains a duplicate worker.');
    }
    identities.add(key);
  }
  return Object.freeze(workers);
}

module.exports = { parseGcpWorkerFleet, normaliseWorker };
