// Main App Logic: Polling, UI, Notifications

/** GitHub username from hostname: USER.github.io → USER */
function inferGithubPagesOwner() {
  try {
    const gh = /^([^.]+)\.github\.io$/i.exec(window.location.hostname);
    return gh ? gh[1] : '';
  } catch {
    return '';
  }
}

/** GitHub Pages project sites: https://OWNER.github.io/REPO/ → OWNER/REPO */
function inferGithubRepoFromPagesUrl() {
  try {
    const { hostname, pathname } = window.location;
    const gh = /^([^.]+)\.github\.io$/i.exec(hostname);
    if (!gh) return '';
    const owner = gh[1];
    const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (segments.length >= 1) {
      const repo = segments[0];
      if (/^[a-zA-Z0-9_.-]+$/.test(repo)) return `${owner}/${repo}`;
    }
    return `${owner}/${owner}.github.io`;
  } catch {
    return '';
  }
}

function repoHintFromMetaOrPages() {
  const meta = document.querySelector('meta[name="gchat-repo"]')?.getAttribute('content')?.trim();
  if (meta) return meta;
  return inferGithubRepoFromPagesUrl();
}

function sanitizeDataImageSrc(url) {
  if (!url || typeof url !== 'string') return '';
  if (/^data:image\/(jpeg|jpg|png|gif|webp);base64,/.test(url)) return url;
  return '';
}

/** Compress image file to JPEG data URL */
function compressImageFile(file, maxW = 880, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      let { width, height } = img;
      if (width > maxW) {
        height = Math.round((height * maxW) / width);
        width = maxW;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Could not read image'));
    };
    img.src = blobUrl;
  });
}

const COMMON_EMOJIS = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😅',
  '😂',
  '🤣',
  '😊',
  '😍',
  '🥰',
  '😘',
  '😜',
  '🤔',
  '😎',
  '😢',
  '😭',
  '😤',
  '🙏',
  '👍',
  '👎',
  '👏',
  '🙌',
  '🔥',
  '✨',
  '❤️',
  '💯',
  '🎉',
  '✅',
  '❌',
  '⚠️',
  '📷',
  '📞',
  '📹',
  '💬'
];

(function bindHtmlHandlersToWindow() {
  window.saveConfig = saveConfig;
  window.openSettings = openSettings;
  window.sendMessage = sendMessage;
  window.requestNotificationPermission = requestNotificationPermission;
  window.openClassicPatPage = openClassicPatPage;
  window.openFineGrainedPatPage = openFineGrainedPatPage;
})();

let messages = [];
let lastMessageTime = null;
let pollingInterval;
const renderedIds = new Set();

let userId = localStorage.getItem('userId');
if (!userId) {
  userId = 'guest-' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem('userId', userId);
}

let config = JSON.parse(localStorage.getItem('gchatConfig') || '{}');
const configPanel = document.getElementById('config-panel');
const repoInputEl = document.getElementById('repo-input');
if (repoInputEl && !config.repo) {
  const guessed = repoHintFromMetaOrPages();
  if (guessed) repoInputEl.value = guessed;
}

if (configPanel) {
  try {
    if (!config.repo) {
      showConfigModal();
    } else {
      hideConfigModal();
    }
  } catch (e) {
    console.error('GChat modal init:', e);
  }
}

function resetChatUiState() {
  messages = [];
  lastMessageTime = null;
  renderedIds.clear();
  const container = document.getElementById('messages');
  if (container) container.innerHTML = '';
}

async function verifyGithubRepo(repo, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GChat-PWA'
  };
  const t = String(token || '').trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  return res.status;
}

function hideConfigModal() {
  if (!configPanel) return;
  configPanel.classList.add('modal-dismissed');
  configPanel.style.display = 'none';
  configPanel.setAttribute('aria-hidden', 'true');
}

function showConfigModal() {
  if (!configPanel) return;
  configPanel.classList.remove('modal-dismissed');
  configPanel.style.display = 'flex';
  configPanel.setAttribute('aria-hidden', 'false');
}

async function saveConfig() {
  const repoRaw = document.getElementById('repo-input').value.trim();
  const token = document.getElementById('token-input').value.trim();
  let repo = typeof normalizeGithubRepo === 'function' ? normalizeGithubRepo(repoRaw) : repoRaw;

  if (!repo) return alert('Enter the repository (OWNER/repo).');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return alert('Repository must look like OWNER/repo (or paste a full github.com/… URL).');
  }

  const seg = repo.split('/');
  if (seg.length === 2 && seg[0] === seg[1]) {
    alert(
      'Invalid repository:\nOWNER and repo name cannot be the same string.\n\nExample:\n' +
        (repoHintFromMetaOrPages() || 'yourname/your-repo-name')
    );
    return;
  }

  const pagesOwner = inferGithubPagesOwner();
  if (pagesOwner) {
    const [repoOwner, repoName] = repo.split('/');
    if (repoOwner.toLowerCase() !== pagesOwner.toLowerCase()) {
      const suggested = `${pagesOwner}/${repoName}`;
      const fix = confirm(
        `This site is "${pagesOwner}.github.io" but the repository owner is "${repoOwner}".\n\n` +
          `Wrong owner names cause "Not Found" (404).\n\n` +
          `Use "${suggested}" instead?`
      );
      if (fix) {
        repo = suggested;
        document.getElementById('repo-input').value = repo;
      }
    }
  }

  document.getElementById('repo-input').value = repo;

  requestNotificationPermissionFromGesture();

  config = { repo, token };
  localStorage.setItem('gchatConfig', JSON.stringify(config));

  hideConfigModal();
  resetChatUiState();

  try {
    await initApp();
  } catch (err) {
    console.error(err);
    showConfigModal();
    alert('Could not start chat: ' + (err && err.message ? err.message : String(err)));
    return;
  }

  verifyGithubRepo(repo, token).then(status => {
    if (status !== 200) {
      console.warn('[GChat] Repo GET returned HTTP', status, '(messages may still load)');
    }
  }).catch(err => console.warn('[GChat] Repo check skipped:', err));
}

function hasAuthToken() {
  return !!(config.token && String(config.token).trim());
}

function applyUiMode() {
  const authed = hasAuthToken();
  const sendBtn = document.getElementById('send-btn');
  const msgInput = document.getElementById('message-input');
  const attachBtns = document.querySelectorAll('[data-requires-token="true"]');

  sendBtn.disabled = !authed;
  msgInput.disabled = !authed;
  attachBtns.forEach(el => {
    el.disabled = !authed;
    el.style.opacity = authed ? '' : '0.45';
  });

  msgInput.placeholder = authed
    ? 'Type a message…'
    : 'Sending needs a token — GitHub requires login to create Issues';
}

function requestNotificationPermissionFromGesture() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  Notification.requestPermission();
}

function openSettings() {
  document.getElementById('repo-input').value = config.repo || repoHintFromMetaOrPages() || '';
  document.getElementById('token-input').value = config.token ? config.token : '';
  showConfigModal();
}

function openClassicPatPage() {
  window.open('https://github.com/settings/tokens/new', '_blank', 'noopener,noreferrer');
}

function openFineGrainedPatPage() {
  window.open('https://github.com/settings/personal-access-tokens/new', '_blank', 'noopener,noreferrer');
}

function jitsiRoomName() {
  const raw = config.repo || 'gchat-room';
  return 'gchat-' + raw.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 72);
}

/** Voice / video via Jitsi Meet — works without our backend (same room name for your repo). */
function openVoiceCall() {
  const room = jitsiRoomName();
  window.open(`https://meet.jit.si/${encodeURIComponent(room)}#config.prejoinPageEnabled=false&config.startWithVideoMuted=true`, '_blank', 'noopener,noreferrer');
}

function openVideoCall() {
  const room = jitsiRoomName();
  window.open(`https://meet.jit.si/${encodeURIComponent(room)}#config.prejoinPageEnabled=false`, '_blank', 'noopener,noreferrer');
}

async function initApp() {
  gchatAPI = new GitHubAPI(config.repo, config.token);
  document.getElementById('status').textContent = hasAuthToken()
    ? 'Connected'
    : 'Read-only · no token (~60 API calls/hour)';
  applyUiMode();
  startPolling();
}

function startPolling() {
  clearInterval(pollingInterval);
  const pollMs = hasAuthToken() ? 2000 : 65000;

  const tick = async () => {
    const fetched = await gchatAPI.fetchNewMessages(lastMessageTime);
    const incoming = [];
    for (const m of fetched) {
      if (!messages.some(x => x.id === m.id)) {
        messages.push(m);
        incoming.push(m);
      }
    }
    messages.sort((a, b) => a.id - b.id);
    if (incoming.length === 0) return;

    appendNewMessagesOnly(incoming);
    lastMessageTime = messages[messages.length - 1].timestamp;
    incoming.forEach(msg => {
      if (msg.sender !== userId) showNotification(msg);
    });
  };

  tick();
  pollingInterval = setInterval(tick, pollMs);
}

function appendNewMessagesOnly(toAppend) {
  const container = document.getElementById('messages');
  for (const msg of toAppend) {
    if (renderedIds.has(msg.id)) continue;
    renderedIds.add(msg.id);
    container.appendChild(createMessageEl(msg));
  }
  scrollMessagesToBottom();
}

function scrollMessagesToBottom() {
  const container = document.getElementById('messages');
  container.scrollTop = container.scrollHeight;
}

function createMessageEl(msg) {
  const wrap = document.createElement('div');
  wrap.className = `message ${msg.sender === userId ? 'sent' : 'received'}`;
  wrap.dataset.msgId = String(msg.id);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const header = document.createElement('strong');
  header.textContent = `${msg.sender}:`;

  bubble.appendChild(header);

  if (msg.type === 'image' && msg.imageDataUrl) {
    const safeSrc = sanitizeDataImageSrc(msg.imageDataUrl);
    if (safeSrc) {
      const img = document.createElement('img');
      img.className = 'bubble-img';
      img.alt = '';
      img.loading = 'lazy';
      img.src = safeSrc;
      bubble.appendChild(img);
    }
    const cap = msg.content ? String(msg.content).trim() : '';
    if (cap) {
      const capEl = document.createElement('div');
      capEl.className = 'bubble-caption';
      capEl.textContent = cap;
      bubble.appendChild(capEl);
    }
  } else {
    const body = document.createElement('div');
    body.className = 'bubble-text';
    body.textContent = msg.content || '';
    bubble.appendChild(body);
  }

  const ts = document.createElement('div');
  ts.className = 'timestamp';
  ts.textContent = new Date(msg.timestamp).toLocaleTimeString();

  bubble.appendChild(ts);
  wrap.appendChild(bubble);
  return wrap;
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content) return;

  try {
    await gchatAPI.sendMessage(userId, content, 'text', lastMessageTime);
    input.value = '';
  } catch (e) {
    alert('Send failed: ' + e.message);
  }
}

async function handleImageSelected(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (!hasAuthToken()) {
    alert('Image upload requires a GitHub token.');
    return;
  }
  try {
    const jpeg = await compressImageFile(file);
    await gchatAPI.sendImage(userId, '', jpeg, lastMessageTime);
  } catch (e) {
    alert(e.message || String(e));
  }
}

function toggleEmojiPanel() {
  const panel = document.getElementById('emoji-panel');
  panel.classList.toggle('open');
}

function insertEmoji(ch) {
  const input = document.getElementById('message-input');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const v = input.value;
  input.value = v.slice(0, start) + ch + v.slice(end);
  input.focus();
  input.selectionStart = input.selectionEnd = start + ch.length;
}

function showNotification(msg) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  let preview = '';
  if (msg.type === 'image') preview = '📷 Photo';
  else preview = String(msg.content || '').slice(0, 80);
  if (preview.length > 80) preview += '…';
  try {
    new Notification('GChat', {
      body: `${msg.sender}: ${preview}`,
      tag: `gchat-${msg.id}`
    });
  } catch (e) {
    console.warn('Notification failed:', e);
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.');
    return;
  }
  if (Notification.permission === 'denied') {
    alert('Notifications are blocked for this site. Use the lock icon in the address bar → Site settings → Notifications → Allow.');
    return;
  }
  if (Notification.permission === 'granted') {
    new Notification('GChat', { body: 'Notifications are already enabled.' });
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    new Notification('GChat', { body: 'You will get alerts for new messages.' });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const msgInput = document.getElementById('message-input');

  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.getElementById('btn-emoji').addEventListener('click', e => {
    e.stopPropagation();
    toggleEmojiPanel();
  });

  document.addEventListener('click', () => {
    const panel = document.getElementById('emoji-panel');
    if (panel) panel.classList.remove('open');
  });

  document.getElementById('emoji-panel').addEventListener('click', e => e.stopPropagation());

  const grid = document.getElementById('emoji-grid');
  COMMON_EMOJIS.forEach(ch => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-cell';
    b.textContent = ch;
    b.addEventListener('click', e => {
      e.stopPropagation();
      insertEmoji(ch);
      document.getElementById('emoji-panel').classList.remove('open');
    });
    grid.appendChild(b);
  });

  document.getElementById('image-file-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) handleImageSelected(f);
  });

  document.getElementById('camera-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) handleImageSelected(f);
  });

  document.getElementById('btn-gallery').addEventListener('click', () => {
    document.getElementById('image-file-input').click();
  });

  document.getElementById('btn-camera').addEventListener('click', () => {
    document.getElementById('camera-input').click();
  });

  document.getElementById('btn-call-voice').addEventListener('click', openVoiceCall);
  document.getElementById('btn-call-video').addEventListener('click', openVideoCall);

  if (config.repo) initApp();
});

window.addEventListener('beforeunload', () => {
  clearInterval(pollingInterval);
});
