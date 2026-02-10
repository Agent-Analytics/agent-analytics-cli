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

  async request(method, path, body) {
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
  async getStats(project, days = 7) {
    return this.request('GET', `/stats?project=${encodeURIComponent(project)}&days=${days}`);
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

  // Track (uses project token, not API key)
  static async track(projectToken, event, properties = {}, { project, userId, baseUrl = BASE_URL } = {}) {
    const res = await fetch(`${baseUrl}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: project || 'default',
        token: projectToken,
        event,
        properties,
        user_id: userId,
        timestamp: Date.now(),
      }),
    });
    return res.json();
  }
}
