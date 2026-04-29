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

  async fetchNewMessages(since = null) {
    try {
      let url = this.baseURL + '?sort=created&direction=asc&state=open&per_page=20';
      if (since) url += `&since=${since}`;

      const response = await fetch(url, { headers: this.headers });
      if (!response.ok) {
        const msg = await readApiError(response);
        console.warn('Issues API:', msg);
        return [];
      }

      const issues = await response.json();
      return issues.map(issue => {
        let body = {};
        try {
          body = JSON.parse(issue.body || '{}');
        } catch {
          body = {};
        }
        const content = body.content ?? issue.body;
        return {
          id: issue.number,
          sender: body.sender_id || 'Unknown',
          timestamp: issue.created_at,
          content,
          type: body.type || 'text'
        };
      }).filter(msg => msg.content);
    } catch (error) {
      console.error('Fetch error:', error);
      return [];
    }
  }

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
