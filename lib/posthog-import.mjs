/**
 * PostHog history import.
 *
 * Agent Analytics never calls PostHog and rejects bodies that contain a key
 * field. This module reads an export or pages PostHog, then posts event
 * objects to POST /imports/posthog. The personal API key is sent only to the
 * PostHog host, on the Authorization header, and is never returned to callers
 * that print a result.
 *
 * PostHog's GET /events/ list is deprecated: without `after` it returns only
 * the last 24 hours, and the window must be under a year. POST /query/
 * rejects OFFSET for personal API keys. History is paged with a HogQL keyset
 * on (timestamp, uuid) at POST /api/projects/:id/query/.
 *
 * A job does not list committed chunk ids. The chunk id is a hash of that
 * page's uuids, so a retry or --resume posts the same id. The server returns
 * the stored receipt (replayed: true) and does not write those rows again.
 */

import { createHash } from 'node:crypto';

export const CHUNK_EVENTS = 40;
export const BODY_MAX_BYTES = 512 * 1024;
export const JOB_EVENT_CAP = 1_000_000;
export const DEFAULT_POSTHOG_HOST = 'https://us.posthog.com';
export const SECRET_FIELD = /^(api_key|personal_api_key|posthog_api_key|posthog_key|authorization)$/i;
const UUID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const MAX_ATTEMPTS = 5;
const QUERY_NAME = 'agent-analytics posthog history import';

export function redactSecrets(text, secret) {
  let out = String(text ?? '');
  out = out.replace(/phx_[A-Za-z0-9_-]+/g, '[redacted]');
  if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  return out;
}

export function assertPosthogHost(host, agentAnalyticsUrl) {
  let url;
  try {
    url = new URL(host);
  } catch {
    throw new Error('POSTHOG_HOST must be an absolute URL. The default is https://us.posthog.com.');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('POSTHOG_HOST must use https. Loopback http is only for tests.');
  }
  if (agentAnalyticsUrl) {
    let agentUrl;
    try {
      agentUrl = new URL(agentAnalyticsUrl);
    } catch {
      agentUrl = null;
    }
    if (agentUrl && url.origin === agentUrl.origin) {
      throw new Error('POSTHOG_HOST points at the Agent Analytics API. The PostHog key is sent only to PostHog.');
    }
  }
  return url.origin;
}

export function assertPosthogProjectId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error('--posthog-project-id must be 1-64 letters, numbers, underscores, or dashes.');
  }
  return id;
}

export function parseTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return null;
    return numeric < 1e12 ? Math.round(numeric * 1000) : Math.round(numeric);
  }
  const normalized = normalizePosthogTimestamp(trimmed);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePosthogTimestamp(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    const withT = trimmed.replace(' ', 'T');
    return withT.endsWith('Z') ? withT : `${withT}Z`;
  }
  return trimmed;
}

export function parseBound(flag, raw, { end = false } = {}) {
  if (raw == null || String(raw).trim() === '') return null;
  const value = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const iso = end ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) throw new Error(`${flag} is not a valid date.`);
    return parsed;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be YYYY-MM-DD or an ISO-8601 timestamp.`);
  }
  return parsed;
}

export function parseLimit(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  if (!/^[1-9]\d*$/.test(String(raw).trim())) {
    throw new Error('--limit must be a positive integer.');
  }
  const limit = Number(raw);
  if (limit > JOB_EVENT_CAP) {
    throw new Error(`--limit cannot exceed ${JOB_EVENT_CAP}. That is the per-job cap.`);
  }
  return limit;
}

function stripSecretFields(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => stripSecretFields(item, depth + 1));
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) continue;
    out[key] = stripSecretFields(child, depth + 1);
  }
  return out;
}

function jsonHasSecret(value, secret) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return true;
  }
  if (json.includes('phx_')) return true;
  if (secret && secret.length >= 8 && json.includes(secret)) return true;
  return false;
}

function stringOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function prepareImportEvent(raw, secret) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { event: {} };
  }
  const slim = {};
  const uuid = stringOrNull(raw.uuid) || stringOrNull(raw.id);
  const name = stringOrNull(raw.event);
  const distinctId = stringOrNull(raw.distinct_id);
  if (uuid) slim.uuid = uuid;
  if (name) slim.event = name;
  if (distinctId) slim.distinct_id = distinctId;
  if (raw.timestamp != null && raw.timestamp !== '') {
    slim.timestamp = normalizePosthogTimestamp(raw.timestamp);
  }
  if (raw.properties && typeof raw.properties === 'object' && !Array.isArray(raw.properties)) {
    const properties = stripSecretFields(raw.properties);
    if (Object.keys(properties).length > 0) slim.properties = properties;
  }
  if (jsonHasSecret(slim, secret)) return { skipSecret: true };
  return { event: slim };
}

export function selectEvents(events, { fromMs = null, toMs = null, limit = null, secret = null } = {}) {
  const selected = [];
  let skippedSecret = 0;
  let skippedWindow = 0;
  const windowed = fromMs != null || toMs != null;
  for (const raw of events) {
    const prepared = prepareImportEvent(raw, secret);
    if (prepared.skipSecret) {
      skippedSecret += 1;
      continue;
    }
    if (windowed) {
      const timestamp = parseTimestampMs(prepared.event.timestamp);
      if (timestamp == null || (fromMs != null && timestamp < fromMs) || (toMs != null && timestamp > toMs)) {
        skippedWindow += 1;
        continue;
      }
    }
    selected.push(prepared.event);
    if (limit != null && selected.length >= limit) break;
  }
  return { events: selected, skippedSecret, skippedWindow };
}

export function parseExportDocument(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const trimmed = source.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      if (trimmed.startsWith('[')) {
        throw new Error('The export is not valid JSON. Pass a JSON array, an object with an events array, or JSONL.');
      }
      parsed = null;
    }
    if (parsed) {
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object') {
        if (Array.isArray(parsed.events)) return parsed.events;
        if (Array.isArray(parsed.results)) return parsed.results;
        if (parsed.event || parsed.uuid || parsed.id || parsed.distinct_id) return [parsed];
      }
      throw new Error('The export JSON must be an array of events, or an object with an events array.');
    }
  }
  const events = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new Error(`The export is not valid JSONL. Line ${index + 1} is not a JSON value.`);
    }
  }
  return events;
}

export function chunkIdForEvents(events) {
  const identity = events.map((event) => {
    if (event && typeof event.uuid === 'string' && event.uuid) return event.uuid;
    return JSON.stringify(event);
  }).join('\n');
  return `page-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

export function chunkSizeFromJob(job) {
  const value = Number(job?.limits?.chunk_events);
  if (!Number.isInteger(value) || value < 1) return CHUNK_EVENTS;
  return Math.min(CHUNK_EVENTS, value);
}

function hogqlDate(ms) {
  const formatted = new Date(ms).toISOString().slice(0, 23).replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(formatted)) {
    throw new Error('Invalid timestamp bound.');
  }
  return `toDateTime64('${formatted}', 3, 'UTC')`;
}

function hogqlUuid(value) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('PostHog page cursor was not a uuid, so paging stopped.');
  }
  return `'${value}'`;
}

export function buildPosthogQuery({ fromMs = null, toMs = null, cursor = null, limit = CHUNK_EVENTS } = {}) {
  const size = Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > CHUNK_EVENTS) {
    throw new Error('PostHog page size is invalid.');
  }
  const where = [];
  if (fromMs != null) where.push(`timestamp >= ${hogqlDate(fromMs)}`);
  if (toMs != null) where.push(`timestamp <= ${hogqlDate(toMs)}`);
  if (cursor) {
    const timestamp = hogqlDate(cursor.timestampMs);
    const uuid = hogqlUuid(cursor.uuid);
    where.push(`(timestamp > ${timestamp} OR (timestamp = ${timestamp} AND toString(uuid) > ${uuid}))`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return [
    'SELECT toString(uuid) AS uuid, event, distinct_id, toString(timestamp) AS timestamp, properties',
    'FROM events',
    whereSql,
    'ORDER BY timestamp ASC, uuid ASC',
    `LIMIT ${size}`,
  ].filter(Boolean).join('\n');
}

function rowToEvent(row, columns) {
  if (row && typeof row === 'object' && !Array.isArray(row)) return row;
  if (!Array.isArray(row) || !Array.isArray(columns)) {
    throw new Error('PostHog returned a row that is not an event.');
  }
  const obj = {};
  columns.forEach((column, index) => {
    obj[column] = row[index];
  });
  if (typeof obj.properties === 'string') {
    try {
      const parsed = JSON.parse(obj.properties);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj.properties = parsed;
    } catch {
      // Leave the string. The server skips an event it cannot map.
    }
  }
  if (obj.timestamp != null) obj.timestamp = normalizePosthogTimestamp(obj.timestamp);
  return obj;
}

function pageEvents(data) {
  if (Array.isArray(data?.results)) {
    return data.results.map((row) => rowToEvent(row, data.columns));
  }
  if (Array.isArray(data?.events)) return data.events;
  if (data?.query_status && data.results == null) {
    const error = new Error('PostHog query is still running.');
    error.status = 503;
    throw error;
  }
  throw new Error('PostHog returned a page without a results array.');
}

export function retryDelayMs(err, attempt) {
  const raw = err?.retryAfter;
  if (raw != null && String(raw).trim() !== '') {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.min(60_000, Math.max(0, seconds * 1000));
    const when = Date.parse(String(raw));
    if (Number.isFinite(when)) return Math.min(60_000, Math.max(0, when - Date.now()));
  }
  return Math.min(30_000, 250 * 2 ** attempt);
}

async function withBackoff(fn, { sleep, attempts = MAX_ATTEMPTS, retry }) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt === attempts - 1 || !retry(err)) throw err;
      await sleep(retryDelayMs(err, attempt));
    }
  }
  throw last;
}

function statusOf(err) {
  return err?.status ?? err?.statusCode ?? null;
}

function retryIdempotent(err) {
  if (err?.retryable === false) return false;
  const status = statusOf(err);
  return status === 429 || status == null || status >= 500;
}

function retryCreate(err) {
  return statusOf(err) === 429;
}

export function explainImportError(err, { project, jobId, write = false } = {}) {
  const code = err?.code || err?.body?.error || err?.body?.code || null;
  const lines = [];
  if (code === 'FORBIDDEN_SCOPE') {
    lines.push('Import needs manage or admin (scope imports:write).');
    lines.push('A read session gets 403 FORBIDDEN_SCOPE. Account API keys (aak_) and dashboard cookies cannot import.');
    lines.push('Run: npx @agent-analytics/cli login --level manage');
  } else if (code === 'PROJECT_NOT_FOUND') {
    lines.push(`Project "${project || ''}" was not found, or this session is not granted that project.`);
    lines.push('Run whoami to see the granted project.');
  } else if (code === 'NOT_FOUND') {
    lines.push(jobId
      ? `Import ${jobId} was not found. A project-limited session also returns 404 when the job belongs to another project.`
      : 'That import was not found. A project-limited session returns 404 when the job belongs to another project.');
  } else if (code === 'IMPORT_LIMIT') {
    lines.push('Import limit reached. An account can have 5 open import jobs, and each job accepts at most 1,000,000 received events.');
    lines.push('Finish an open job, or continue one with --resume <job_id>.');
  } else if (code === 'DEMO_READ_ONLY') {
    lines.push('The demo project is read-only. PostHog history cannot be imported into agentanalytics-demo.');
  } else if (code === 'IMPORT_CLOSED') {
    lines.push('This import job is already completed or aborted. Start a new import to send a new page. A chunk id that was already accepted still returns its receipt.');
  } else if (code === 'AUTH_REQUIRED') {
    lines.push('The agent session is missing or expired. Run: npx @agent-analytics/cli login --level manage');
  } else if (statusOf(err) === 413) {
    lines.push('Agent Analytics rejected a chunk larger than 512 KiB.');
  }
  if (jobId && !['NOT_FOUND', 'PROJECT_NOT_FOUND', 'IMPORT_CLOSED', 'FORBIDDEN_SCOPE', 'DEMO_READ_ONLY', 'AUTH_REQUIRED'].includes(code)) {
    lines.push(`The job was left open. Resume with --resume ${jobId}${write ? ' --yes' : ''} and the same source, dates, and limit.`);
  }
  return lines.join('\n');
}

function failure(err, context, secret) {
  const hint = explainImportError(err, context);
  const server = redactSecrets(err?.message || '', secret);
  let message = server || 'Import failed.';
  if (hint && server && !hint.includes(server)) message = `${hint}\n${server}`;
  else if (hint) message = hint;
  const wrapped = new Error(redactSecrets(message, secret));
  wrapped.code = err?.code || err?.body?.error || null;
  wrapped.status = statusOf(err);
  wrapped.jobId = context.jobId || null;
  return wrapped;
}

function outsideRetentionNote(job) {
  const cutoff = job?.limits?.retention_cutoff;
  const window = cutoff ? ` (cutoff ${cutoff})` : '';
  return `outside_retention: events older than the plan retention window${window} were not written, because the nightly retention delete would remove them.`;
}

function emptyCounts() {
  return {
    received: 0,
    accepted: 0,
    inserted: 0,
    duplicate: 0,
    skipped: 0,
    outside_retention: 0,
    erased: 0,
    page_views: 0,
    identifies: 0,
    aliases: 0,
    chunks: 0,
    skipped_reasons: {},
  };
}

async function posthogQuery(posthog, sql, { sleep, attempts }) {
  const url = new URL(`/api/projects/${encodeURIComponent(posthog.projectId)}/query/`, posthog.origin);
  const body = {
    query: { kind: 'HogQLQuery', query: sql },
    name: QUERY_NAME,
    refresh: 'force_blocking',
  };
  const payload = JSON.stringify(body);
  if (posthog.apiKey && payload.includes(posthog.apiKey)) {
    throw new Error('Refusing to build a PostHog query that contains the API key.');
  }
  return withBackoff(async () => {
    let response;
    try {
      response = await posthog.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${posthog.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: payload,
      });
    } catch {
      const error = new Error('PostHog request failed before a response.');
      error.status = null;
      throw error;
    }
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }
    if (!response.ok) {
      if (response.status === 401) {
        const error = new Error('PostHog rejected the personal API key.');
        error.status = 401;
        error.code = 'POSTHOG_HTTP';
        throw error;
      }
      if (response.status === 403) {
        const error = new Error('PostHog denied access to that project. The key needs query:read on this project.');
        error.status = 403;
        error.code = 'POSTHOG_HTTP';
        throw error;
      }
      const detail = typeof data.detail === 'string'
        ? data.detail
        : (typeof data.message === 'string' ? data.message : `PostHog HTTP ${response.status}`);
      const error = new Error(redactSecrets(detail, posthog.apiKey).slice(0, 300));
      error.status = response.status;
      error.code = 'POSTHOG_HTTP';
      error.retryAfter = response.headers?.get?.('retry-after') ?? null;
      throw error;
    }
    return data;
  }, { sleep, attempts, retry: retryIdempotent });
}

async function* iteratePosthogEvents(posthog, { fromMs, toMs, limit, sleep, attempts, secret }) {
  let cursor = null;
  let sent = 0;
  const seenCursors = new Set();
  while (limit == null || sent < limit) {
    const pageSize = Math.min(CHUNK_EVENTS, limit == null ? CHUNK_EVENTS : limit - sent);
    const sql = buildPosthogQuery({ fromMs, toMs, cursor, limit: pageSize });
    const data = await posthogQuery(posthog, sql, { sleep, attempts });
    const rows = pageEvents(data);
    if (rows.length === 0) return;
    const last = rows[rows.length - 1];
    const timestampMs = parseTimestampMs(normalizePosthogTimestamp(last?.timestamp));
    const uuid = stringOrNull(last?.uuid) || stringOrNull(last?.id);
    if (timestampMs == null || !uuid) {
      throw new Error('PostHog page is missing a timestamp or uuid, so it cannot be paged safely.');
    }
    const cursorKey = `${timestampMs}:${uuid}`;
    if (seenCursors.has(cursorKey)) {
      throw new Error('PostHog pagination did not advance. Stopped to avoid repeating a page.');
    }
    seenCursors.add(cursorKey);
    for (const raw of rows) {
      const prepared = prepareImportEvent(raw, secret);
      if (prepared.skipSecret) {
        yield { skipSecret: true };
        continue;
      }
      const timestamp = parseTimestampMs(prepared.event.timestamp);
      if ((fromMs != null || toMs != null) && (
        timestamp == null
        || (fromMs != null && timestamp < fromMs)
        || (toMs != null && timestamp > toMs)
      )) {
        yield { skipWindow: true };
        continue;
      }
      yield { event: prepared.event };
      sent += 1;
      if (limit != null && sent >= limit) return;
    }
    cursor = { timestampMs, uuid };
    if (data.hasMore === false) return;
    if (rows.length < pageSize && data.hasMore !== true) return;
  }
}

function takeSample(sample, receipt) {
  if (!Array.isArray(receipt?.sample)) return sample;
  const next = sample.slice();
  for (const row of receipt.sample) {
    if (next.length >= 5) break;
    next.push(row);
  }
  return next;
}

function chunkByteLength(events) {
  return Buffer.byteLength(JSON.stringify({ chunk_id: 'page-00000000000000000000000000000000', events }));
}

async function sendEvents(api, job, events, { dryRun, sleep, attempts, onChunk, secret, project }) {
  async function send(slice) {
    if (slice.length === 0) return;
    if (slice.length > 1 && chunkByteLength(slice) > BODY_MAX_BYTES) {
      const mid = Math.ceil(slice.length / 2);
      await send(slice.slice(0, mid));
      await send(slice.slice(mid));
      return;
    }
    if (chunkByteLength(slice) > BODY_MAX_BYTES) {
      throw new Error('One event is larger than the 512 KiB import body limit and was not sent.');
    }
    const chunkId = chunkIdForEvents(slice);
    const body = { chunk_id: chunkId, events: slice };
    if (dryRun) body.dry_run = true;
    if (secret && JSON.stringify(body).includes(secret)) {
      const error = new Error('Refusing to send a chunk that contains the PostHog key.');
      error.retryable = false;
      throw error;
    }
    let receipt;
    try {
      receipt = await withBackoff(
        () => api.postPosthogImportChunk(job.id, body),
        { sleep, attempts, retry: retryIdempotent },
      );
    } catch (err) {
      if (statusOf(err) === 400 && /too many identity aliases/i.test(String(err.message || '')) && slice.length > 1) {
        const mid = Math.ceil(slice.length / 2);
        await send(slice.slice(0, mid));
        await send(slice.slice(mid));
        return;
      }
      throw failure(err, { project, jobId: job.id, write: !dryRun }, secret);
    }
    onChunk({ receipt, chunkId, request: body });
  }

  const size = chunkSizeFromJob(job);
  for (let index = 0; index < events.length; index += size) {
    await send(events.slice(index, index + size));
  }
}

async function finishJob(api, job, { sleep, attempts, secret, project, write }) {
  try {
    await withBackoff(() => api.getPosthogImport(job.id), { sleep, attempts, retry: retryIdempotent });
    return await withBackoff(
      () => api.completePosthogImport(job.id),
      { sleep, attempts, retry: retryIdempotent },
    );
  } catch (err) {
    if ((err.code || err.body?.error) === 'IMPORT_CLOSED') {
      try {
        return await api.getPosthogImport(job.id);
      } catch (getErr) {
        throw failure(getErr, { project, jobId: job.id, write }, secret);
      }
    }
    throw failure(err, { project, jobId: job.id, write }, secret);
  }
}

function closedResult(job, { project, source, dryRun }) {
  return {
    job,
    project,
    source,
    dryRun: job?.dry_run === true,
    sample: [],
    localSkippedSecret: 0,
    localSkippedWindow: 0,
    chunksPosted: 0,
    chunksReplayed: 0,
    empty: false,
    alreadyClosed: true,
    note: outsideRetentionNote(job),
    requestedDryRun: dryRun,
  };
}

export function importResultView(result) {
  const job = result.job || {};
  const counts = job.counts || emptyCounts();
  return {
    id: job.id || null,
    project: job.project || result.project || null,
    project_id: job.project_id || null,
    status: job.status || null,
    dry_run: job.dry_run === true,
    source: job.source || result.source || null,
    counts,
    sample: result.dryRun ? (result.sample || []) : [],
    limits: job.limits ? {
      chunk_events: job.limits.chunk_events,
      retention_days: job.limits.retention_days,
      retention_cutoff: job.limits.retention_cutoff,
    } : null,
    usage: job.usage || { counts_toward_monthly_limit: false, metered: false },
    local_skipped_secret: result.localSkippedSecret || 0,
    local_skipped_window: result.localSkippedWindow || 0,
    chunks_posted: result.chunksPosted || 0,
    chunks_replayed: result.chunksReplayed || 0,
    empty: Boolean(result.empty),
    already_closed: Boolean(result.alreadyClosed),
    outside_retention_note: result.note || outsideRetentionNote(job),
  };
}

function redactSample(sample, secret) {
  return (sample || []).slice(0, 5).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = {};
    for (const [key, value] of Object.entries(row)) {
      if (SECRET_FIELD.test(key)) continue;
      if (typeof value === 'string') copy[key] = redactSecrets(value, secret);
      else if (value && typeof value === 'object') {
        try {
          copy[key] = JSON.parse(redactSecrets(JSON.stringify(stripSecretFields(value)), secret));
        } catch {
          copy[key] = null;
        }
      } else copy[key] = value;
    }
    return copy;
  });
}

export async function runPosthogImport({
  api,
  project,
  source,
  dryRun,
  resumeJobId = null,
  from = null,
  to = null,
  limit = null,
  events = null,
  posthog = null,
  secret = null,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress = () => {},
  maxAttempts = MAX_ATTEMPTS,
} = {}) {
  const fromMs = parseBound('--from', from, { end: false });
  const toMs = parseBound('--to', to, { end: true });
  const eventLimit = parseLimit(limit);
  if (fromMs != null && toMs != null && fromMs > toMs) {
    throw new Error('--from is after --to.');
  }
  if (source !== 'export' && source !== 'api') {
    throw new Error('Import source must be an export file or the PostHog API.');
  }
  if (!project || !String(project).trim()) {
    throw new Error('--project is required.');
  }
  if (source === 'api') {
    if (!posthog?.origin || !posthog?.projectId || !posthog?.apiKey || typeof posthog?.fetch !== 'function') {
      throw new Error('PostHog API paging needs a host, project id, and personal API key.');
    }
  }

  const contextBase = { project, write: !dryRun };
  let job = null;
  if (resumeJobId) {
    try {
      job = await withBackoff(
        () => api.getPosthogImport(resumeJobId),
        { sleep, attempts: maxAttempts, retry: retryIdempotent },
      );
    } catch (err) {
      throw failure(err, { ...contextBase, jobId: resumeJobId }, secret);
    }
    const sameProject = String(job.project || '').toLowerCase() === String(project).trim().toLowerCase()
      || job.project_id === project;
    if (!sameProject) {
      throw new Error(`Job ${job.id} belongs to project "${job.project}", not "${project}".`);
    }
    if (job.status === 'completed' || job.status === 'aborted') {
      return closedResult(job, { project, source, dryRun });
    }
    if (job.status !== 'open') {
      throw new Error(`Job ${job.id} has status "${job.status}" and cannot accept chunks.`);
    }
    if (job.dry_run && !dryRun) {
      throw new Error(`Job ${job.id} is a dry run and cannot be turned into writes. Run the import again with --yes to open a new job.`);
    }
    if (!job.dry_run && dryRun) {
      const error = new Error(`Job ${job.id} is a live import. Re-run with --yes --resume ${job.id} to continue writes. Current ${formatCounts(job.counts)}.`);
      error.code = 'IMPORT_NEEDS_YES';
      throw error;
    }
  }

  let skippedSecret = 0;
  let skippedWindow = 0;
  const buffered = [];

  if (source === 'export') {
    const selected = selectEvents(events || [], { fromMs, toMs, limit: eventLimit, secret });
    skippedSecret = selected.skippedSecret;
    skippedWindow = selected.skippedWindow;
    buffered.push(...selected.events);
    if (buffered.length === 0 && !job) {
      return {
        job: null,
        project,
        source,
        dryRun,
        sample: [],
        localSkippedSecret: skippedSecret,
        localSkippedWindow: skippedWindow,
        chunksPosted: 0,
        chunksReplayed: 0,
        empty: true,
        note: outsideRetentionNote(null),
      };
    }
  }

  if (!job) {
    try {
      job = await withBackoff(
        () => api.createPosthogImport({ project, source, dry_run: dryRun }),
        { sleep, attempts: maxAttempts, retry: retryCreate },
      );
    } catch (err) {
      throw failure(err, contextBase, secret);
    }
  }

  const effectiveDryRun = job.dry_run === true || dryRun;
  let sample = [];
  let chunksPosted = 0;
  let chunksReplayed = 0;
  let chunkIndex = 0;

  const onChunk = ({ receipt, chunkId }) => {
    chunkIndex += 1;
    chunksPosted += 1;
    if (receipt?.replayed) chunksReplayed += 1;
    if (effectiveDryRun) sample = takeSample(sample, receipt);
    const committed = receipt?.replayed ? '  already committed' : '';
    onProgress(`chunk ${chunkIndex}  ${chunkId}  ${formatCounts(receipt?.counts)}${committed}`);
  };

  try {
    if (source === 'export') {
      await sendEvents(api, job, buffered, {
        dryRun: effectiveDryRun,
        sleep,
        attempts: maxAttempts,
        onChunk,
        secret,
        project,
      });
    } else {
      const pending = [];
      const size = chunkSizeFromJob(job);
      for await (const item of iteratePosthogEvents(posthog, {
        fromMs,
        toMs,
        limit: eventLimit,
        sleep,
        attempts: maxAttempts,
        secret,
      })) {
        if (item.skipSecret) {
          skippedSecret += 1;
          continue;
        }
        if (item.skipWindow) {
          skippedWindow += 1;
          continue;
        }
        pending.push(item.event);
        if (pending.length >= size) {
          await sendEvents(api, job, pending.splice(0, pending.length), {
            dryRun: effectiveDryRun,
            sleep,
            attempts: maxAttempts,
            onChunk,
            secret,
            project,
          });
        }
      }
      if (pending.length > 0) {
        await sendEvents(api, job, pending, {
          dryRun: effectiveDryRun,
          sleep,
          attempts: maxAttempts,
          onChunk,
          secret,
          project,
        });
      }
    }
  } catch (err) {
    if (err?.jobId) throw err;
    throw failure(err, { ...contextBase, jobId: job.id }, secret);
  }

  if (chunksPosted === 0) {
    if (resumeJobId) {
      return {
        job,
        project,
        source,
        dryRun: effectiveDryRun,
        sample: [],
        localSkippedSecret: skippedSecret,
        localSkippedWindow: skippedWindow,
        chunksPosted: 0,
        chunksReplayed: 0,
        empty: true,
        leftOpen: true,
        note: outsideRetentionNote(job),
      };
    }
    const completed = await finishJob(api, job, {
      sleep,
      attempts: maxAttempts,
      secret,
      project,
      write: !effectiveDryRun,
    });
    return {
      job: completed,
      project,
      source,
      dryRun: effectiveDryRun,
      sample: [],
      localSkippedSecret: skippedSecret,
      localSkippedWindow: skippedWindow,
      chunksPosted: 0,
      chunksReplayed: 0,
      empty: true,
      note: outsideRetentionNote(completed),
    };
  }

  const completed = await finishJob(api, job, {
    sleep,
    attempts: maxAttempts,
    secret,
    project,
    write: !effectiveDryRun,
  });
  return {
    job: completed,
    project,
    source,
    dryRun: effectiveDryRun,
    sample: redactSample(sample, secret),
    localSkippedSecret: skippedSecret,
    localSkippedWindow: skippedWindow,
    chunksPosted,
    chunksReplayed,
    empty: false,
    note: outsideRetentionNote(completed),
  };
}

export function formatCounts(counts = {}) {
  return `inserted ${counts?.inserted ?? 0}  duplicate ${counts?.duplicate ?? 0}  skipped ${counts?.skipped ?? 0}  outside_retention ${counts?.outside_retention ?? 0}`;
}
