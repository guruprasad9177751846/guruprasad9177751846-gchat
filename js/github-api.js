// GitHub REST API — Issues used as chat messages.

/** Accepts owner/repo or full https://github.com/owner/repo URLs. */
function normalizeGithubRepo(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (/^github\.com$/i.test(u.hostname)) {
        const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        if (parts.length >= 2) {
          const owner = parts[0];
          const repo = parts[1].replace(/\.git$/i, '');
          return `${owner}/${repo}`;
        }
      }
    } catch {
      return s;
    }
  }
  s = s.replace(/^git@github\.com:/i, '').replace(/\.git$/i, '');
  const seg = s.split('/').filter(Boolean);
  if (seg.length >= 2) return `${seg[0]}/${seg[1]}`;
  return raw.trim();
}

/** Public read-only requests (no Authorization). Subject to strict rate limits (~60 req/hour per IP). */
function githubRestHeaders(token) {
  const base = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GChat-PWA'
  };
  const t = String(token || '').trim();
  if (!t) return base;
  return { ...base, Authorization: `Bearer ${t}` };
}

async function readApiError(response) {
  const text = await response.text();
  let message = text;
  try {
    const j = JSON.parse(text);
    if (j.message) message = j.message;
  } catch {
    /* raw text */
  }
  if (response.status === 404) {
    return `${message} — Repo missing, typo, or private (anonymous users only see public repos).`;
  }
  return message || `${response.status} ${response.statusText}`;
}

class GitHubAPI {
  constructor(repo, token) {
    this.repo = normalizeGithubRepo(repo);
    this.token = String(token || '').trim();
    this.canPost = !!this.token;
    this.baseURL = `https://api.github.com/repos/${this.repo}/issues`;
    this.headers = githubRestHeaders(this.token);
  }

  _issueQueryParams() {
    return '?sort=created&direction=desc&state=all&per_page=100';
  }

  async _fetchIssuesPage(pageNum) {
    const url = `${this.baseURL}${this._issueQueryParams()}&page=${pageNum}`;
    const response = await fetch(url, {
      headers: this.headers,
      cache: 'no-store'
    });
    const link = response.headers.get('Link');
    let issues = [];
    if (response.ok) {
      const data = await response.json();
      issues = Array.isArray(data) ? data : [];
    }
    return { ok: response.ok, issues, link };
  }

  _linkHasNext(linkHeader) {
    return !!(linkHeader && /rel="next"/.test(linkHeader));
  }

  _issuesToMessages(issues) {
    const byNumber = new Map();
    const filtered = Array.isArray(issues) ? issues.filter(issue => !issue.pull_request) : [];
    for (const issue of filtered) {
      const m = this._issueToMessage(issue);
      if (!this._messageVisible(m)) continue;
      byNumber.set(m.id, m);
    }
    return Array.from(byNumber.values()).sort((a, b) => a.id - b.id);
  }

  /** Page 1 only — for polling new messages (newest issue rows). */
  async fetchLatestChatMessagesForPoll() {
    try {
      const { ok, issues, link } = await this._fetchIssuesPage(1);
      if (!ok) {
        if (!issues.length) console.warn('Issues API: poll failed');
        return [];
      }
      return this._issuesToMessages(issues);
    } catch (error) {
      console.error('Fetch error:', error);
      return [];
    }
  }

  /**
   * Walk GitHub pages until we have ≥ maxVisible chat rows or run out of pages.
   * Returns newest `maxVisible` messages, older ones in backlog, and next API page # for older history.
   */
  async fetchInitialWindow(maxVisible = 100) {
    const byId = new Map();
    let page = 1;
    let lastLink = '';
    const MAX_PAGES = 40;

    for (; page <= MAX_PAGES; page++) {
      const { ok, issues, link } = await this._fetchIssuesPage(page);
      lastLink = link || '';
      if (!ok) break;
      if (!issues.length) break;

      for (const m of this._issuesToMessages(issues)) {
        byId.set(m.id, m);
      }

      if (byId.size >= maxVisible || !this._linkHasNext(lastLink)) break;
    }

    const merged = Array.from(byId.values()).sort((a, b) => a.id - b.id);
    let backlog = [];
    let visible = merged;
    if (merged.length > maxVisible) {
      backlog = merged.slice(0, merged.length - maxVisible);
      visible = merged.slice(-maxVisible);
    }

    const nextOlderPage = this._linkHasNext(lastLink) ? page + 1 : null;

    return {
      visibleMessages: visible,
      backlog,
      nextOlderPage
    };
  }

  /** One GitHub Issues page (older rows); caller passes incremental page number. */
  async fetchOlderIssuesPage(apiPage) {
    try {
      const { ok, issues, link } = await this._fetchIssuesPage(apiPage);
      if (!ok) return { messages: [], hasMorePages: false };
      const messages = this._issuesToMessages(issues);
      return {
        messages,
        hasMorePages: this._linkHasNext(link)
      };
    } catch (error) {
      console.error('Older page fetch:', error);
      return { messages: [], hasMorePages: false };
    }
  }

  /** Back-compat name used by older app versions — delegates to poll helper. */
  async fetchNewMessages() {
    return this.fetchLatestChatMessagesForPoll();
  }

  _issueToMessage(issue) {
    let body = {};
    try {
      body = JSON.parse(issue.body || '{}');
    } catch {
      body = {};
    }
    const type = body.type || 'text';
    const sender = body.sender_id || 'Unknown';
    const timestamp = issue.created_at;
    const id = issue.number;

    if (type === 'image' && body.imageData) {
      const mime = body.imageMime || 'image/jpeg';
      const imageDataUrl = body.imageData.startsWith('data:')
        ? body.imageData
        : `data:${mime};base64,${body.imageData}`;
      return {
        id,
        sender,
        timestamp,
        type: 'image',
        content: typeof body.content === 'string' ? body.content : '',
        imageDataUrl
      };
    }

    const content =
      typeof body.content === 'string' ? body.content : issue.body && !issue.body.startsWith('{') ? issue.body : '';

    return {
      id,
      sender,
      timestamp,
      type: 'text',
      content,
      imageDataUrl: null
    };
  }

  _messageVisible(msg) {
    if (msg.type === 'image') return !!msg.imageDataUrl;
    return msg.content !== undefined && String(msg.content).length > 0;
  }

  /** Send plain text chat message */
  async sendMessage(sender, content, type = 'text', previousId = null) {
    if (!this.canPost) {
      throw new Error(
        'GitHub does not allow creating Issues without authentication. Add an optional token to send messages.'
      );
    }

    const msgObj = {
      sender_id: sender,
      timestamp: new Date().toISOString(),
      content,
      type,
      previous_msg_id: previousId
    };
    return this._postIssue(sender, msgObj);
  }

  /**
   * Send image (compressed JPEG base64 without data: prefix stored in JSON body).
   * GitHub issue body ~65k limit — caller must compress.
   */
  async sendImage(sender, caption, jpegDataUrl, previousId = null) {
    if (!this.canPost) {
      throw new Error(
        'GitHub does not allow creating Issues without authentication. Add an optional token to send messages.'
      );
    }

    const base64 = jpegDataUrl.includes(',') ? jpegDataUrl.split(',')[1] : jpegDataUrl;
    const msgObj = {
      sender_id: sender,
      timestamp: new Date().toISOString(),
      type: 'image',
      content: caption || '',
      imageMime: 'image/jpeg',
      imageData: base64,
      previous_msg_id: previousId
    };

    const bodyStr = JSON.stringify(msgObj);
    if (bodyStr.length > 55000) {
      throw new Error('Image still too large after compression — try a smaller photo.');
    }

    return this._postIssue(sender, msgObj);
  }

  async _postIssue(sender, msgObj) {
    const title = `Chat: ${sender}-${Date.now()}`;

    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, body: JSON.stringify(msgObj) })
    });

    if (!response.ok) {
      const msg = await readApiError(response);
      let hint = '';
      if (response.status === 404) {
        hint =
          `\n\n404 usually means:\n• Repo slug wrong — open github.com/${this.repo} in a browser.\n• Private repo — PAT must belong to a user with access.\n• Fine-grained token — grant Issues read/write on this repo.`;
      } else if (response.status === 403) {
        hint =
          '\n\n403 — Token missing repo/Issues permission, SSO not authorized for org token, or abuse detection.';
      }
      throw new Error(msg + hint);
    }

    return await response.json();
  }
}

let gchatAPI = null;
