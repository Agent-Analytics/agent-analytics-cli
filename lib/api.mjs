/**
 * Agent Analytics API client.
 * Zero dependencies — uses native fetch.
 */

import { mergeSessionGrant } from './scopes.mjs';

const BASE_URL = 'https://api.agentanalytics.sh';

function responseHeader(headers, name) {
  if (!headers || typeof headers.get !== 'function') return null;
  const value = headers.get(name);
  if (value == null || value === '') return null;
  return value;
}

export class AgentAnalyticsAPI {
  constructor(auth, baseUrl = BASE_URL, { onAuthUpdate } = {}) {
    this.auth = typeof auth === 'string' || auth == null
      ? { api_key: auth || null }
      : { ...auth };
    this.baseUrl = baseUrl;
    this.onAuthUpdate = onAuthUpdate;
  }

  _qs(params) {
    return Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
  }

  async request(method, path, body, { returnHeaders = false, retryOnRefresh = true } = {}) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (this.auth?.access_token) {
      opts.headers.Authorization = `Bearer ${this.auth.access_token}`;
    } else if (this.auth?.api_key) {
      opts.headers['X-API-Key'] = this.auth.api_key;
    }

    if (body) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, opts);
    const data = await res.json().catch(() => ({}));

    if (res.status === 401 && retryOnRefresh && this.auth?.refresh_token) {
      const refreshed = await this.refreshAgentSession().catch(() => null);
      if (refreshed?.access_token) {
        return this.request(method, path, body, { returnHeaders, retryOnRefresh: false });
      }
    }

    if (!res.ok) {
      const error = new Error(data.message || data.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.code = data.code || data.error;
      error.body = data;
      const retryAfter = responseHeader(res.headers, 'retry-after');
      if (retryAfter != null) error.retryAfter = retryAfter;
      throw error;
    }

    if (returnHeaders) {
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return { data, headers };
    }

    return data;
  }

  // Account
  async getAccount() {
    return this.request('GET', '/account');
  }

  async getAccountUsage() {
    return this.request('GET', '/account/usage');
  }

  async startAgentSession(payload) {
    return this.request('POST', '/agent-sessions/start', payload, { retryOnRefresh: false });
  }

  async pollAgentSession(authRequestId, pollToken) {
    return this.request('POST', '/agent-sessions/poll', {
      auth_request_id: authRequestId,
      poll_token: pollToken,
    }, { retryOnRefresh: false });
  }

  async exchangeAgentSession(authRequestId, exchangeCode, codeVerifier) {
    return this.request('POST', '/agent-sessions/exchange', {
      auth_request_id: authRequestId,
      exchange_code: exchangeCode,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }, { retryOnRefresh: false });
  }

  async refreshAgentSession() {
    if (!this.auth?.refresh_token) {
      throw new Error('No refresh token available');
    }
    const result = await this.request('POST', '/agent-sessions/refresh', {
      refresh_token: this.auth.refresh_token,
    }, { retryOnRefresh: false });
    this.auth = {
      ...this.auth,
      ...mergeSessionGrant(result.agent_session || {}, result || {}),
    };
    await this.onAuthUpdate?.(this.auth);
    return this.auth;
  }

  async startDemoSession() {
    return this.request('POST', '/demo/session', undefined, { retryOnRefresh: false });
  }

  async listAgentSessions() {
    return this.request('GET', '/account/agent-sessions');
  }

  async revokeAgentSession(sessionId) {
    return this.request('POST', '/agent-sessions/revoke', { session_id: sessionId });
  }

  async revokeKey() {
    return this.request('POST', '/account/revoke-key');
  }

  async sendFeedback({ message, project, command, context }) {
    const body = { message };
    if (project != null) body.project = project;
    if (command != null) body.command = command;
    if (context != null) body.context = context;
    return this.request('POST', '/account/feedback', body);
  }

  async getAllSitesOverview({ period = '7d', limit = 10 } = {}) {
    return this.request('GET', `/account/all-sites?${this._qs({ period, limit })}`);
  }

  async getBotTraffic(project, { period = '7d', limit = 10 } = {}) {
    return this.request('GET', `/bot-traffic?${this._qs({ project, period, limit })}`);
  }

  async getAllSitesBotTraffic({ period = '7d', limit = 10 } = {}) {
    return this.request('GET', `/account/bot-traffic?${this._qs({ period, limit })}`);
  }

  // Projects
  async createProject(name, allowedOrigins = '*', { sourceScanId } = {}) {
    const body = {
      name,
      allowed_origins: allowedOrigins,
    };
    if (sourceScanId != null) body.source_scan_id = sourceScanId;
    return this.request('POST', '/projects', body);
  }

  async listProjects() {
    return this.request('GET', '/projects');
  }

  async getProject(id) {
    return this.request('GET', `/projects/${id}`);
  }

  async updateProject(id, { name, allowed_origins } = {}) {
    const body = {};
    if (name != null) body.name = name;
    if (allowed_origins != null) body.allowed_origins = allowed_origins;
    return this.request('PATCH', `/projects/${id}`, body);
  }

  async deleteProject(id) {
    return this.request('DELETE', `/projects/${id}`);
  }

  async getProjectContext(project) {
    return this.request('GET', `/project-context?${this._qs({ project })}`);
  }

  async setProjectContext(project, context) {
    return this.request('PUT', '/project-context', { project, ...context });
  }

  async appendProjectAnnotation(project, { occurred_at, title, note } = {}) {
    const body = { project, occurred_at, title };
    if (note != null && note !== '') body.note = note;
    return this.request('POST', '/project-context/annotations', body);
  }

  async getPortfolioContext() {
    return this.request('GET', '/portfolio-context');
  }

  async setPortfolioContext(context) {
    return this.request('PUT', '/portfolio-context', context);
  }

  async listPortfolios() {
    return this.request('GET', '/portfolios');
  }

  async createPortfolio({ slug, name, projects, allow_move } = {}) {
    const body = { slug, name, projects };
    if (allow_move != null) body.allow_move = allow_move;
    return this.request('POST', '/portfolios', body);
  }

  async getPortfolio(idOrSlug) {
    return this.request('GET', `/portfolios/${encodeURIComponent(idOrSlug)}`);
  }

  async updatePortfolio(idOrSlug, { name, projects, allow_move } = {}) {
    const body = {};
    if (name != null) body.name = name;
    if (projects != null) body.projects = projects;
    if (allow_move != null) body.allow_move = allow_move;
    return this.request('PATCH', `/portfolios/${encodeURIComponent(idOrSlug)}`, body);
  }

  async deletePortfolio(idOrSlug) {
    return this.request('DELETE', `/portfolios/${encodeURIComponent(idOrSlug)}`);
  }

  // Website analysis
  async createWebsiteScan(url, { full = false, project } = {}) {
    const body = { url };
    if (full) body.mode = 'full';
    if (project != null) body.project = project;
    return this.request('POST', '/cli/website-scans', body);
  }

  async getWebsiteScan(id, { resumeToken } = {}) {
    const query = resumeToken ? `?${this._qs({ resume_token: resumeToken })}` : '';
    return this.request('GET', `/website-scans/${id}${query}`, undefined, { retryOnRefresh: false });
  }

  // Stats
  async getStats(project, days = 7, { returnHeaders = false } = {}) {
    const since = `${days}d`;
    return this.request('GET', `/stats?${this._qs({ project, since })}`, undefined, { returnHeaders });
  }

  async getEvents(project, { event, days = 7, since, limit = 100, user_id, email } = {}) {
    const resolvedSince = since || `${days}d`;
    if (email != null) {
      return this.request('POST', '/events', { project, since: resolvedSince, limit, event, user_id, email });
    }
    return this.request('GET', `/events?${this._qs({ project, since: resolvedSince, limit, event, user_id })}`);
  }

  async getJourney(project, { days = 30, since, limit = 100, user_id, email } = {}) {
    const resolvedSince = since || `${days}d`;
    if (email != null) {
      return this.request('POST', '/journey', { project, since: resolvedSince, limit, user_id, email });
    }
    return this.request('GET', `/journey?${this._qs({ project, since: resolvedSince, limit, user_id })}`);
  }

  async getProperties(project, days = 30) {
    const since = `${days}d`;
    return this.request('GET', `/properties?${this._qs({ project, since })}`);
  }

  async getPropertiesReceived(project, { since, sample } = {}) {
    return this.request('GET', `/properties/received?${this._qs({ project, since, sample })}`);
  }

  async getSessions(project, { since, limit = 100, user_id, is_bounce } = {}) {
    return this.request('GET', `/sessions?${this._qs({ project, since, limit, user_id, is_bounce })}`);
  }

  async query(project, { metrics, group_by, filters, date_from, date_to, order_by, order, limit, count_mode, email, property } = {}) {
    return this.request('POST', '/query', { project, metrics, group_by, filters, date_from, date_to, order_by, order, limit, count_mode, email, property });
  }

  async sql(project, sql, { days, date_from, date_to } = {}) {
    const body = { project, sql };
    if (days != null) body.days = days;
    if (date_from != null) body.date_from = date_from;
    if (date_to != null) body.date_to = date_to;
    return this.request('POST', '/sql', body);
  }

  async compare(project, {
    goal_event,
    denominator_event,
    filters,
    denominator_filters,
    ship_date,
    window_days,
    baseline,
    compare,
    rule,
    metric,
    metric_event,
    better,
  } = {}) {
    const body = { project, goal_event };
    if (denominator_event != null) body.denominator_event = denominator_event;
    if (filters != null) body.filters = filters;
    if (denominator_filters != null) body.denominator_filters = denominator_filters;
    if (ship_date != null) body.ship_date = ship_date;
    if (window_days != null) body.window_days = window_days;
    if (baseline != null) body.baseline = baseline;
    if (compare != null) body.compare = compare;
    if (rule != null) body.rule = rule;
    if (metric != null) body.metric = metric;
    if (metric_event != null) body.metric_event = metric_event;
    if (better != null) body.better = better;
    return this.request('POST', '/compare', body);
  }

  async getErrors(project, { since, until, new_since, limit } = {}) {
    return this.request('GET', `/errors?${this._qs({ project, since, until, new_since, limit })}`);
  }

  async getVitals(project, { days, date_from, date_to, group_by, limit } = {}) {
    const body = { project };
    if (days != null) body.days = days;
    if (date_from != null) body.date_from = date_from;
    if (date_to != null) body.date_to = date_to;
    if (group_by != null) body.group_by = group_by;
    if (limit != null) body.limit = limit;
    return this.request('POST', '/vitals', body);
  }

  // Analytics
  async getBreakdown(project, { property, event, since, limit = 20 } = {}) {
    return this.request('GET', `/breakdown?${this._qs({ project, property, event, since, limit })}`);
  }

  async getInsights(project, { period = '7d' } = {}) {
    return this.request('GET', `/insights?${this._qs({ project, period })}`);
  }

  async getPages(project, { type = 'entry', since, limit = 20 } = {}) {
    return this.request('GET', `/pages?${this._qs({ project, type, since, limit })}`);
  }

  async getPaths(project, { goal_event, since, max_steps, entry_limit, path_limit, candidate_session_cap } = {}) {
    return this.request('POST', '/paths', {
      project,
      goal_event,
      since,
      max_steps,
      entry_limit,
      path_limit,
      candidate_session_cap,
    });
  }

  async getSessionDistribution(project, { since } = {}) {
    return this.request('GET', `/sessions/distribution?${this._qs({ project, since })}`);
  }

  async getHeatmap(project, { since } = {}) {
    return this.request('GET', `/heatmap?${this._qs({ project, since })}`);
  }

  // Live
  async getLive(project, { window = 60 } = {}) {
    return this.request('GET', `/live?${this._qs({ project, window })}`);
  }

  // Funnels
  async getFunnel(project, { steps, from_context, conversion_window_hours, since, count_by, breakdown, breakdown_limit } = {}) {
    return this.request('POST', '/funnel', { project, steps, from_context, conversion_window_hours, since, count_by, breakdown, breakdown_limit });
  }

  // Retention
  async getRetention(project, { period, cohorts, event, returning_event } = {}) {
    return this.request('GET', `/retention?${this._qs({ project, period, cohorts, event, returning_event })}`);
  }

  // Experiments
  async createExperiment(project, { name, variants, goal_event, weights }) {
    return this.request('POST', '/experiments', { project, name, variants, goal_event, weights });
  }

  async listExperiments(project) {
    return this.request('GET', `/experiments?${this._qs({ project })}`);
  }

  async getExperiment(id) {
    return this.request('GET', `/experiments/${id}`);
  }

  async updateExperiment(id, { status, winner }) {
    return this.request('PATCH', `/experiments/${id}`, { status, winner });
  }

  async deleteExperiment(id) {
    return this.request('DELETE', `/experiments/${id}`);
  }

  // Session replay
  async getReplaySettings(project) {
    return this.request('GET', `/replays/settings?${this._qs({ project })}`);
  }

  async updateReplaySettings(project, settings = {}) {
    return this.request('PUT', '/replays/settings', { project, ...settings });
  }

  async listReplays({ project, session_id, limit, before } = {}) {
    return this.request('GET', `/replays?${this._qs({ project, session_id, limit, before })}`);
  }

  async getReplay(id) {
    return this.request('GET', `/replays/${encodeURIComponent(id)}`);
  }

  async openReplay(id) {
    return this.request('POST', `/replays/${encodeURIComponent(id)}/open`, {});
  }

  async deleteReplay(id) {
    return this.request('DELETE', `/replays/${encodeURIComponent(id)}`);
  }

  async deleteReplayData({ project } = {}) {
    return this.request('DELETE', '/replays', { confirm: 'delete_replay_data', project });
  }

  async getReplayUsage() {
    return this.request('GET', '/replays/usage');
  }

  // Erasure. Callers must not log the subject. This method does not print it.
  async createErasure({
    project,
    idempotency_key,
    confirm,
    user_id,
    session_id,
    email,
    include_replays,
    confirm_large,
    portfolio,
  } = {}) {
    const body = { project, idempotency_key, confirm };
    if (user_id != null) body.user_id = user_id;
    if (session_id != null) body.session_id = session_id;
    if (email != null) body.email = email;
    if (include_replays != null) body.include_replays = include_replays;
    if (confirm_large === true) body.confirm_large = true;
    if (portfolio === true) body.portfolio = true;
    return this.request('POST', '/erasures', body);
  }

  async listErasures(project) {
    return this.request('GET', `/erasures?${this._qs({ project })}`);
  }

  async getErasure(id) {
    return this.request('GET', `/erasures/${encodeURIComponent(id)}`);
  }
}
