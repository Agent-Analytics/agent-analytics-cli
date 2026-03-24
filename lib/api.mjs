/**
 * Agent Analytics API client.
 * Zero dependencies — uses native fetch.
 */

const BASE_URL = 'https://api.agentanalytics.sh';

export class AgentAnalyticsAPI {
  constructor(apiKey, baseUrl = BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  _qs(params) {
    return Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
  }

  async request(method, path, body, { returnHeaders = false } = {}) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (this.apiKey) {
      opts.headers['X-API-Key'] = this.apiKey;
    }

    if (body) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, opts);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
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
  async createProject(name, allowedOrigins = '*') {
    return this.request('POST', '/projects', {
      name,
      allowed_origins: allowedOrigins,
    });
  }

  async listProjects() {
    return this.request('GET', '/projects');
  }

  async getProject(id) {
    return this.request('GET', `/projects/${id}`);
  }

  async updateProject(id, { name, allowed_origins } = {}) {
    return this.request('PATCH', `/projects/${id}`, { name, allowed_origins });
  }

  async deleteProject(id) {
    return this.request('DELETE', `/projects/${id}`);
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

  async query(project, { metrics, group_by, filters, date_from, date_to, order_by, order, limit } = {}) {
    return this.request('POST', '/query', { project, metrics, group_by, filters, date_from, date_to, order_by, order, limit });
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
