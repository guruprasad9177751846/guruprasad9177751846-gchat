// Main App Logic: Polling, UI, Notifications
let messages = [];
let lastMessageTime = null;
let pollingInterval;
let userId = localStorage.getItem('userId') || prompt('Your User ID (e.g., user1):') || 'Anonymous';
localStorage.setItem('userId', userId);

let config = JSON.parse(localStorage.getItem('gchatConfig') || '{}');
const configPanel = document.getElementById('config-panel');
if (!config.repo) {
  configPanel.style.display = 'flex';
} else {
  configPanel.style.display = 'none';
}

async function saveConfig() {
  const repo = document.getElementById('repo-input').value;
  const token = document.getElementById('token-input').value;
  
  if (!repo || !token) return alert('Enter repo and token!');
  
  config = { repo, token };
  localStorage.setItem('gchatConfig', JSON.stringify(config));
  document.getElementById('config-panel').style.display = 'none';
  
  await initApp();
}

async function initApp() {
  gchatAPI = new GitHubAPI(config.repo, config.token);
  document.getElementById('status').textContent = 'Connected';
  startPolling();
  requestNotificationPermission();
}

function startPolling() {
  pollingInterval = setInterval(async () => {
    const newMessages = await gchatAPI.fetchNewMessages(lastMessageTime);
    if (newMessages.length > 0) {
      messages = [...messages, ...newMessages.filter(m => !messages.some(existing => existing.id === m.id))];
      renderMessages();
      lastMessageTime = messages[messages.length - 1]?.timestamp;
      newMessages.forEach(msg => {
        if (msg.sender !== userId) showNotification(msg);
      });
    }
  }, 2000); // 2s poll
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
  if (Notification.permission === 'granted') {
    new Notification('New Message', {
      body: `${msg.sender}: ${msg.content.substring(0, 50)}...`,
      icon: 'data:image/png;base64,iVBORw0KG...'
    });
  }
}

async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') console.log('Notifications enabled');
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

