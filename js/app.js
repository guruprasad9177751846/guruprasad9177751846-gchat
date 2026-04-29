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
    // User/org site root → repo is typically OWNER.github.io
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

let messages = [];
let lastMessageTime = null;
let pollingInterval;
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

if (!config.repo) {
  configPanel.style.display = 'flex';
} else {
  configPanel.style.display = 'none';
}

async function saveConfig() {
  const repoRaw = document.getElementById('repo-input').value.trim();
  const token = document.getElementById('token-input').value.trim();
  let repo = typeof normalizeGithubRepo === 'function' ? normalizeGithubRepo(repoRaw) : repoRaw;

  if (!repo) return alert('Enter the repository (OWNER/repo).');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return alert('Repository must look like OWNER/repo (or paste a full github.com/… URL).');
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

  // Must run in the same user gesture as the button click — before any await — or browsers block the prompt.
  requestNotificationPermissionFromGesture();

  config = { repo, token };
  localStorage.setItem('gchatConfig', JSON.stringify(config));
  document.getElementById('config-panel').style.display = 'none';

  await initApp();
}

function hasAuthToken() {
  return !!(config.token && String(config.token).trim());
}

function applyUiMode() {
  const authed = hasAuthToken();
  const sendBtn = document.getElementById('send-btn');
  const msgInput = document.getElementById('message-input');
  sendBtn.disabled = !authed;
  msgInput.disabled = !authed;
  msgInput.placeholder = authed
    ? 'Type a message...'
    : 'Sending needs a token — GitHub requires login to create Issues';
}

/** Call synchronously from Save & Start click only (preserves gesture). */
function requestNotificationPermissionFromGesture() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  Notification.requestPermission();
}

function openSettings() {
  document.getElementById('repo-input').value = config.repo || repoHintFromMetaOrPages() || '';
  document.getElementById('token-input').value = config.token ? config.token : '';
  configPanel.style.display = 'flex';
}

function openClassicPatPage() {
  window.open('https://github.com/settings/tokens/new', '_blank', 'noopener,noreferrer');
}

function openFineGrainedPatPage() {
  window.open('https://github.com/settings/personal-access-tokens/new', '_blank', 'noopener,noreferrer');
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
  /** Anonymous GitHub API is capped ~60 requests/hour per IP — poll slowly without a token. */
  const pollMs = hasAuthToken() ? 2000 : 65000;

  const tick = async () => {
    const newMessages = await gchatAPI.fetchNewMessages(lastMessageTime);
    if (newMessages.length > 0) {
      messages = [...messages, ...newMessages.filter(m => !messages.some(existing => existing.id === m.id))];
      renderMessages();
      lastMessageTime = messages[messages.length - 1]?.timestamp;
      newMessages.forEach(msg => {
        if (msg.sender !== userId) showNotification(msg);
      });
    }
  };

  tick();
  pollingInterval = setInterval(tick, pollMs);
}

function renderMessages() {
  const container = document.getElementById('messages');
  container.innerHTML = messages.map(msg => `
    <div class="message ${msg.sender === userId ? 'sent' : 'received'}">
      <div class="bubble">
        <strong>${msg.sender}:</strong> ${msg.content}
        <div class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
      </div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content) return;
  
  try {
    await gchatAPI.sendMessage(userId, content, 'text', lastMessageTime);
    input.value = '';
    // Optimistic update will come via poll
  } catch (e) {
    alert('Send failed: ' + e.message);
  }
}

function showNotification(msg) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const preview = msg.content.length > 80 ? `${msg.content.slice(0, 80)}…` : msg.content;
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

// Enter to send
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('message-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendMessage();
  });
  
  if (config.repo) initApp();
});

// Graceful stop
window.addEventListener('beforeunload', () => {
  clearInterval(pollingInterval);
});

