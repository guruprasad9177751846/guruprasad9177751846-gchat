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

function encodeRepoContentPath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

function readBlobAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = fr.result;
      if (typeof s !== 'string') {
        reject(new Error('Could not read file'));
        return;
      }
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(fr.error || new Error('Could not read file'));
    fr.readAsDataURL(blob);
  });
}

class GitHubAPI {
  constructor(repo, token) {
    this.repo = normalizeGithubRepo(repo);
    this.token = String(token || '').trim();
    this.canPost = !!this.token;
    this.baseURL = `https://api.github.com/repos/${this.repo}/issues`;
    this.headers = githubRestHeaders(this.token);
    const seg = this.repo.split('/');
    this.repoOwner = seg[0] || '';
    this.repoName = seg[1] || '';
    /** @type {string|null} */
    this.defaultBranch = null;
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

  async ensureDefaultBranch() {
    if (this.defaultBranch) return this.defaultBranch;
    const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}`;
    const response = await fetch(url, { headers: this.headers, cache: 'no-store' });
    if (!response.ok) {
      const msg = await readApiError(response);
      throw new Error(msg || 'Could not read repository.');
    }
    const data = await response.json();
    this.defaultBranch = data.default_branch || 'main';
    return this.defaultBranch;
  }

  rawGithubusercontentUrl(repoRelativePath, branch) {
    const b = branch || this.defaultBranch || 'main';
    const encoded = encodeRepoContentPath(repoRelativePath);
    return `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/${b}/${encoded}`;
  }

  async putRepositoryFile(repoRelativePath, base64Content, commitMessage) {
    await this.ensureDefaultBranch();
    const encodedPath = encodeRepoContentPath(repoRelativePath);
    const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${encodedPath}`;
    const body = {
      message: commitMessage || `GChat: ${repoRelativePath}`,
      content: base64Content,
      branch: this.defaultBranch
    };
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const msg = await readApiError(response);
      let hint = '';
      if (response.status === 403 || response.status === 404) {
        hint =
          '\n\nUploading media requires a token with Contents read/write permission on this repository (fine‑grained PAT).';
      }
      throw new Error(msg + hint);
    }
    return response.json();
  }

  async sendVideo(sender, caption, file, previousId = null) {
    if (!this.canPost) {
      throw new Error('Add a GitHub token to upload video.');
    }
    const VIDEO_MAX = 50 * 1024 * 1024;
    if (!file || file.size > VIDEO_MAX) {
      throw new Error('Video must be at most 50 MB.');
    }
    await this.ensureDefaultBranch();
    const extGuess =
      (file.name && /\.([a-zA-Z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase()) ||
      (file.type.includes('webm') ? 'webm' : file.type.includes('quicktime') ? 'mov' : 'mp4');
    const path = `gchat-media/video-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extGuess}`;
    const b64 = await readBlobAsBase64(file);
    await this.putRepositoryFile(path, b64, `GChat video (${sender})`);
    const msgObj = {
      sender_id: sender,
      timestamp: new Date().toISOString(),
      type: 'video',
      content: typeof caption === 'string' ? caption : '',
      videoPath: path,
      videoMime: file.type || `video/${extGuess}`,
      videoBranch: this.defaultBranch,
      previous_msg_id: previousId
    };
    return this._postIssue(sender, msgObj);
  }

  async sendVoiceNote(sender, blob, mimeHint, previousId = null) {
    if (!this.canPost) {
      throw new Error('Add a GitHub token to send voice notes.');
    }
    const VOICE_MAX = 15 * 1024 * 1024;
    if (!blob || blob.size > VOICE_MAX) {
      throw new Error('Voice note must be at most 15 MB.');
    }
    await this.ensureDefaultBranch();
    const ext = mimeHint.includes('mp4') ? 'm4a' : mimeHint.includes('ogg') ? 'ogg' : 'webm';
    const path = `gchat-media/voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const b64 = await readBlobAsBase64(blob);
    await this.putRepositoryFile(path, b64, `GChat voice (${sender})`);
    const msgObj = {
      sender_id: sender,
      timestamp: new Date().toISOString(),
      type: 'audio',
      content: '',
      audioPath: path,
      audioMime: mimeHint || blob.type || 'audio/webm',
      audioBranch: this.defaultBranch,
      previous_msg_id: previousId
    };
    return this._postIssue(sender, msgObj);
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

    if (type === 'video' && body.videoPath) {
      const branch = body.videoBranch || this.defaultBranch || 'main';
      const videoUrl = this.rawGithubusercontentUrl(body.videoPath, branch);
      return {
        id,
        sender,
        timestamp,
        type: 'video',
        content: typeof body.content === 'string' ? body.content : '',
        videoUrl,
        videoMime: body.videoMime || 'video/mp4'
      };
    }

    if (type === 'audio' && body.audioPath) {
      const branch = body.audioBranch || this.defaultBranch || 'main';
      const audioUrl = this.rawGithubusercontentUrl(body.audioPath, branch);
      return {
        id,
        sender,
        timestamp,
        type: 'audio',
        content: typeof body.content === 'string' ? body.content : '',
        audioUrl,
        audioMime: body.audioMime || 'audio/webm'
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
    if (msg.type === 'video') return !!msg.videoUrl;
    if (msg.type === 'audio') return !!msg.audioUrl;
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
