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

/** Only https raw.githubusercontent.com — embedded media URLs in bubbles */
function sanitizeGithubRawMediaUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'raw.githubusercontent.com') return '';
    return url;
  } catch {
    return '';
  }
}

const IMAGE_INPUT_MAX_BYTES = 5 * 1024 * 1024;

/** Compress image file to JPEG data URL */
function compressImageFile(file, maxW = 880, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (file.size > IMAGE_INPUT_MAX_BYTES) {
      reject(new Error('Image must be at most 5 MB.'));
      return;
    }
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
  window.loadOlderMessages = loadOlderMessages;
  window.requestNotificationPermission = requestNotificationPermission;
  window.openClassicPatPage = openClassicPatPage;
  window.openFineGrainedPatPage = openFineGrainedPatPage;
})();

let messages = [];
let lastMessageTime = null;
let pollingInterval;
const renderedIds = new Set();

/** Older-than-window chat rows already fetched but not shown yet (sorted ascending by issue #). */
let olderBacklog = [];
/** Next GitHub Issues API page to fetch for history older than the current oldest visible issue. */
let nextOlderGithubPage = null;
let loadingOlder = false;
const CHUNK_OLDER = 40;

/** Authenticated ~3.6k req/h — under GitHub REST 5k/h. Anon ~60 req/h IP limit → ~65s spacing. */
const POLL_MS_AUTH = 1000;
const POLL_MS_ANON = 65000;

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
  olderBacklog = [];
  nextOlderGithubPage = null;
  renderedIds.clear();
  const container = document.getElementById('messages');
  if (!container) return;
  container.querySelectorAll('.message').forEach(n => n.remove());
  const row = document.getElementById('load-older-row');
  if (row) row.hidden = true;
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
    ? 'Message'
    : 'Open Settings (⋯) to add a token and send';
}

function requestNotificationPermissionFromGesture() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  Notification.requestPermission();
}

function openSettings() {
  document.getElementById('repo-input').value = config.repo || repoHintFromMetaOrPages() || '';
  document.getElementById('token-input').value = config.token ? config.token : '';
  syncNotificationSettingsUi();
  showConfigModal();
}

function openClassicPatPage() {
  window.open('https://github.com/settings/tokens/new', '_blank', 'noopener,noreferrer');
}

function openFineGrainedPatPage() {
  window.open('https://github.com/settings/personal-access-tokens/new', '_blank', 'noopener,noreferrer');
}

function syncNotificationSettingsUi() {
  const el = document.getElementById('notification-settings-status');
  if (!el) return;
  if (!('Notification' in window)) {
    el.textContent = 'Not supported in this browser.';
    return;
  }
  if (Notification.permission === 'granted') {
    el.textContent = 'Enabled — alerts will appear for new messages when this tab is in the background.';
  } else if (Notification.permission === 'denied') {
    el.textContent = 'Blocked — change Notifications for this site in the browser lock/site icon menu.';
  } else {
    el.textContent = 'Off — tap Enable notifications below after saving your repo/token.';
  }
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

let wakePollingBound = false;

/** Poll right away when tab wakes — timers are throttled in background tabs / battery saver. */
function bindWakePollingOnce() {
  if (wakePollingBound) return;
  wakePollingBound = true;
  const burst = () => {
    if (document.visibilityState === 'visible') void pollMessagesOnce();
  };
  document.addEventListener('visibilitychange', burst);
  window.addEventListener('focus', burst);
  window.addEventListener('online', burst);
  document.addEventListener('pageshow', e => {
    if (e.persisted) burst();
  });
}

async function initApp() {
  gchatAPI = new GitHubAPI(config.repo, config.token);
  try {
    await gchatAPI.ensureDefaultBranch();
  } catch (e) {
    console.warn('[GChat] Repo branch:', e);
  }
  document.getElementById('status').textContent = hasAuthToken()
    ? `Connected · refresh ~${POLL_MS_AUTH / 1000}s`
    : `Read-only · ~${Math.round(POLL_MS_ANON / 1000)}s between polls — save token (⚙️) for ~1s`;
  applyUiMode();
  await bootstrapInitialMessages();
  startPolling();
  bindWakePollingOnce();
}

async function bootstrapInitialMessages() {
  try {
    const res = await gchatAPI.fetchInitialWindow(100);
    messages = res.visibleMessages;
    olderBacklog = res.backlog;
    nextOlderGithubPage = res.nextOlderPage;
    renderedIds.clear();
    document.querySelectorAll('#messages .message').forEach(n => n.remove());
    appendNewMessagesOnly(messages.slice());
    lastMessageTime = messages.length ? messages[messages.length - 1].timestamp : null;
    updateLoadOlderUi();
  } catch (e) {
    console.error('[GChat] bootstrap:', e);
  }
}

function updateLoadOlderUi() {
  const row = document.getElementById('load-older-row');
  if (!row) return;
  row.hidden = !(olderBacklog.length > 0 || nextOlderGithubPage != null);
}

function prependOlderMessagesDom(batchAsc) {
  if (!batchAsc.length) return;
  const container = document.getElementById('messages');
  const sentinel = document.getElementById('chat-empty-hint');
  const prev = container.scrollHeight;
  const insertBefore =
    sentinel && sentinel.parentNode === container ? sentinel : container.firstChild;

  for (let i = batchAsc.length - 1; i >= 0; i--) {
    const msg = batchAsc[i];
    if (renderedIds.has(msg.id)) continue;
    renderedIds.add(msg.id);
    container.insertBefore(createMessageEl(msg), insertBefore);
  }

  for (const msg of batchAsc) {
    if (!messages.some(x => x.id === msg.id)) messages.push(msg);
  }
  messages.sort((a, b) => a.id - b.id);

  container.scrollTop += container.scrollHeight - prev;
}

async function loadOlderMessages() {
  if (loadingOlder) return;
  loadingOlder = true;
  const btn = document.getElementById('btn-load-older');
  if (btn) btn.disabled = true;
  try {
    if (olderBacklog.length > 0) {
      const take = Math.min(CHUNK_OLDER, olderBacklog.length);
      const chunk = olderBacklog.splice(olderBacklog.length - take, take);
      prependOlderMessagesDom(chunk);
      updateLoadOlderUi();
      return;
    }

    if (nextOlderGithubPage == null) {
      updateLoadOlderUi();
      return;
    }

    const oldestVis = messages.length ? messages[0].id : Infinity;

    let p = nextOlderGithubPage;
    for (let guard = 0; p != null && guard < 25; guard++) {
      const { messages: batch, hasMorePages } = await gchatAPI.fetchOlderIssuesPage(p);
      const older = batch.filter(m => m.id < oldestVis).sort((a, b) => a.id - b.id);

      if (older.length > 0) {
        let chunk;
        if (older.length > CHUNK_OLDER) {
          olderBacklog = older.slice(0, older.length - CHUNK_OLDER).concat(olderBacklog);
          chunk = older.slice(-CHUNK_OLDER);
        } else {
          chunk = older;
        }

        prependOlderMessagesDom(chunk);
        nextOlderGithubPage = hasMorePages ? p + 1 : null;
        updateLoadOlderUi();
        return;
      }

      if (!hasMorePages) {
        nextOlderGithubPage = null;
        updateLoadOlderUi();
        return;
      }

      p++;
    }

    nextOlderGithubPage = null;
    updateLoadOlderUi();
  } finally {
    loadingOlder = false;
    if (btn) btn.disabled = false;
  }
}

async function pollMessagesOnce() {
  const fetched = await gchatAPI.fetchNewMessages();
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
}

/** Issue list can lag briefly after POST; burst helps your message and others’ show up sooner. */
function scheduleQuickPollAfterSend() {
  void pollMessagesOnce();
  setTimeout(() => void pollMessagesOnce(), 350);
  setTimeout(() => void pollMessagesOnce(), 900);
}

function startPolling() {
  clearInterval(pollingInterval);
  const pollMs = hasAuthToken() ? POLL_MS_AUTH : POLL_MS_ANON;

  void pollMessagesOnce();
  pollingInterval = setInterval(() => void pollMessagesOnce(), pollMs);
}

function appendNewMessagesOnly(toAppend) {
  const container = document.getElementById('messages');
  const sentinel = document.getElementById('chat-empty-hint');
  for (const msg of toAppend) {
    if (renderedIds.has(msg.id)) continue;
    renderedIds.add(msg.id);
    const el = createMessageEl(msg);
    if (sentinel && sentinel.parentNode === container) {
      container.insertBefore(el, sentinel);
    } else {
      container.appendChild(el);
    }
  }
  scrollMessagesToBottom();
}

function scrollMessagesToBottom() {
  const container = document.getElementById('messages');
  container.scrollTop = container.scrollHeight;
}

function formatBubbleTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function createMessageEl(msg) {
  const isSent = msg.sender === userId;
  const wrap = document.createElement('div');
  wrap.className = `message ${isSent ? 'sent' : 'received'}`;
  wrap.dataset.msgId = String(msg.id);

  if (!isSent) {
    const senderEl = document.createElement('div');
    senderEl.className = 'msg-sender';
    senderEl.textContent = msg.sender;
    wrap.appendChild(senderEl);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

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
  } else if (msg.type === 'video' && msg.videoUrl) {
    const safe = sanitizeGithubRawMediaUrl(msg.videoUrl);
    if (safe) {
      const video = document.createElement('video');
      video.className = 'bubble-video';
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = safe;
      bubble.appendChild(video);
    }
    const cap = msg.content ? String(msg.content).trim() : '';
    if (cap) {
      const capEl = document.createElement('div');
      capEl.className = 'bubble-caption';
      capEl.textContent = cap;
      bubble.appendChild(capEl);
    }
  } else if (msg.type === 'audio' && msg.audioUrl) {
    const safe = sanitizeGithubRawMediaUrl(msg.audioUrl);
    if (safe) {
      const audio = document.createElement('audio');
      audio.className = 'bubble-audio';
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = safe;
      bubble.appendChild(audio);
    }
  } else {
    const body = document.createElement('div');
    body.className = 'bubble-text';
    body.textContent = msg.content || '';
    bubble.appendChild(body);
  }

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';
  const timeSpan = document.createElement('span');
  timeSpan.className = 'bubble-time';
  timeSpan.textContent = formatBubbleTime(msg.timestamp);
  meta.appendChild(timeSpan);
  bubble.appendChild(meta);

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
    input.dispatchEvent(new Event('input'));
    scheduleQuickPollAfterSend();
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
  if (file.size > IMAGE_INPUT_MAX_BYTES) {
    alert('Image must be at most 5 MB.');
    return;
  }
  try {
    const jpeg = await compressImageFile(file);
    await gchatAPI.sendImage(userId, '', jpeg, lastMessageTime);
    scheduleQuickPollAfterSend();
  } catch (e) {
    alert(e.message || String(e));
  }
}

const VIDEO_INPUT_MAX_BYTES = 50 * 1024 * 1024;

let voiceMediaRecorder = null;
let voiceMediaStream = null;

function setVoiceRecordingUi(active) {
  const btn = document.getElementById('btn-voice-note');
  if (!btn) return;
  btn.classList.toggle('wa-recording', active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

async function toggleVoiceNoteRecording() {
  if (!hasAuthToken()) {
    alert('Voice messages require a GitHub token with Contents write access.');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Microphone access is not available in this browser.');
    return;
  }
  if (voiceMediaRecorder && voiceMediaRecorder.state === 'recording') {
    voiceMediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceMediaStream = stream;
    let mime = '';
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
      else if (MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4';
    }
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks = [];
    mr.ondataavailable = e => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      voiceMediaStream = null;
      voiceMediaRecorder = null;
      setVoiceRecordingUi(false);
      const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
      if (blob.size < 200) return;
      try {
        await gchatAPI.sendVoiceNote(userId, blob, blob.type || 'audio/webm', lastMessageTime);
        scheduleQuickPollAfterSend();
      } catch (e) {
        alert(e.message || String(e));
      }
    };
    voiceMediaRecorder = mr;
    mr.start();
    setVoiceRecordingUi(true);
  } catch (e) {
    alert(e.message || 'Allow microphone access to send a voice message.');
  }
}

async function handleVideoSelected(file) {
  if (!file || !file.type.startsWith('video/')) return;
  if (!hasAuthToken()) {
    alert('Video upload requires a GitHub token with Contents write access.');
    return;
  }
  if (file.size > VIDEO_INPUT_MAX_BYTES) {
    alert('Video must be at most 50 MB.');
    return;
  }
  const caption = document.getElementById('message-input').value.trim();
  try {
    await gchatAPI.sendVideo(userId, caption, file, lastMessageTime);
    document.getElementById('message-input').value = '';
    document.getElementById('message-input').dispatchEvent(new Event('input'));
    scheduleQuickPollAfterSend();
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
  input.dispatchEvent(new Event('input'));
}

function showNotification(msg) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  let preview = '';
  if (msg.type === 'image') preview = '📷 Photo';
  else if (msg.type === 'video') preview = '🎬 Video';
  else if (msg.type === 'audio') preview = '🎤 Voice message';
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
  syncNotificationSettingsUi();
}

document.addEventListener('DOMContentLoaded', () => {
  const msgInput = document.getElementById('message-input');

  function resizeComposerTextarea() {
    msgInput.style.height = 'auto';
    const maxPx = Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize || '16') * 7.5);
    msgInput.style.height = Math.min(msgInput.scrollHeight, maxPx) + 'px';
  }

  msgInput.addEventListener('input', resizeComposerTextarea);

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

  document.getElementById('btn-video').addEventListener('click', () => {
    document.getElementById('video-file-input').click();
  });

  document.getElementById('video-file-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) void handleVideoSelected(f);
  });

  document.getElementById('btn-voice-note').addEventListener('click', () => {
    void toggleVoiceNoteRecording();
  });

  resizeComposerTextarea();

  if (config.repo) initApp();
});

window.addEventListener('beforeunload', () => {
  clearInterval(pollingInterval);
});
