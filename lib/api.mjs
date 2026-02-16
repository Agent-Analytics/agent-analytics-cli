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
      throw new Error(data.error || `HTTP ${res.status}`);
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

  async deleteProject(id) {
    return this.request('DELETE', `/projects/${id}`);
  }

  // Stats
  async getStats(project, days = 7, { returnHeaders = false } = {}) {
    return this.request('GET', `/stats?project=${encodeURIComponent(project)}&days=${days}`, undefined, { returnHeaders });
  }

  async getEvents(project, { event, days = 7, limit = 100 } = {}) {
    let qs = `project=${encodeURIComponent(project)}&days=${days}&limit=${limit}`;
    if (event) qs += `&event=${encodeURIComponent(event)}`;
    return this.request('GET', `/events?${qs}`);
  }

  async getProperties(project, days = 30) {
    return this.request('GET', `/properties?project=${encodeURIComponent(project)}&days=${days}`);
  }

  async getPropertiesReceived(project, { since, sample } = {}) {
    let qs = `project=${encodeURIComponent(project)}`;
    if (since) qs += `&since=${encodeURIComponent(since)}`;
    if (sample) qs += `&sample=${sample}`;
    return this.request('GET', `/properties/received?${qs}`);
  }

  // Analytics
  async getBreakdown(project, { property, event, since, limit = 20 } = {}) {
    let qs = `project=${encodeURIComponent(project)}&property=${encodeURIComponent(property)}`;
    if (event) qs += `&event=${encodeURIComponent(event)}`;
    if (since) qs += `&since=${encodeURIComponent(since)}`;
    if (limit) qs += `&limit=${limit}`;
    return this.request('GET', `/breakdown?${qs}`);
  }

  async getInsights(project, { period = '7d' } = {}) {
    return this.request('GET', `/insights?project=${encodeURIComponent(project)}&period=${period}`);
  }

  async getPages(project, { type = 'entry', since, limit = 20 } = {}) {
    let qs = `project=${encodeURIComponent(project)}&type=${type}`;
    if (since) qs += `&since=${encodeURIComponent(since)}`;
    if (limit) qs += `&limit=${limit}`;
    return this.request('GET', `/pages?${qs}`);
  }

  async getSessionDistribution(project, { since } = {}) {
    let qs = `project=${encodeURIComponent(project)}`;
    if (since) qs += `&since=${encodeURIComponent(since)}`;
    return this.request('GET', `/sessions/distribution?${qs}`);
  }

  async getHeatmap(project, { since } = {}) {
    let qs = `project=${encodeURIComponent(project)}`;
    if (since) qs += `&since=${encodeURIComponent(since)}`;
    return this.request('GET', `/heatmap?${qs}`);
  }
}
