/**
 * Agent Analytics API client.
 * Zero dependencies — uses native fetch.
 */

const BASE_URL = 'https://api.agentanalytics.sh';

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
      ...result.agent_session,
    };
    this.onAuthUpdate?.(this.auth);
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

  // Website analysis
  async createWebsiteScan(url, { full = false, project } = {}) {
    const body = { url };
    if (full) body.mode = 'full';
    if (project != null) body.project = project;
    return this.request('POST', '/website-scans', body);
  }

  async getWebsiteScan(id, { resumeToken } = {}) {
    const query = resumeToken ? `?${this._qs({ resume_token: resumeToken })}` : '';
    return this.request('GET', `/website-scans/${id}${query}`, undefined, { retryOnRefresh: false });
  }

  async upgradeWebsiteScan(id, { resumeToken, project } = {}) {
    const body = {};
    if (resumeToken != null) body.resume_token = resumeToken;
    if (project != null) body.project = project;
    return this.request('POST', `/website-scans/${id}/upgrade`, body);
  }

  // Stats
  async getStats(project, days = 7, { returnHeaders = false } = {}) {
    const since = `${days}d`;
    return this.request('GET', `/stats?${this._qs({ project, since })}`, undefined, { returnHeaders });
  }

  async getEvents(project, { event, days = 7, limit = 100 } = {}) {
    const since = `${days}d`;
    return this.request('GET', `/events?${this._qs({ project, since, limit, event })}`);
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

  async query(project, { metrics, group_by, filters, date_from, date_to, order_by, order, limit, count_mode } = {}) {
    return this.request('POST', '/query', { project, metrics, group_by, filters, date_from, date_to, order_by, order, limit, count_mode });
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
  async getFunnel(project, { steps, conversion_window_hours, since, count_by, breakdown, breakdown_limit } = {}) {
    return this.request('POST', '/funnel', { project, steps, conversion_window_hours, since, count_by, breakdown, breakdown_limit });
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
}
