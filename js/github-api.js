// GitHub REST API Client for Issues (chat backend)
class GitHubAPI {
  constructor(repo, token) {
    this.baseURL = `https://api.github.com/repos/${repo}/issues`;
    this.headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'GChat-PWA'
    };
  }

  async fetchNewMessages(since = null) {
    try {
      let url = this.baseURL + '?sort=created&direction=asc&state=open&per_page=20';
      if (since) url += `&since=${since}`;
      
      const response = await fetch(url, { headers: this.headers });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      
      const issues = await response.json();
      return issues.map(issue => ({
        id: issue.number,
        sender: issue.title.split(':')[1]?.trim() || 'Unknown',
        timestamp: issue.created_at,
        content: JSON.parse(issue.body || '{}').content || issue.body,
        type: JSON.parse(issue.body || '{}').type || 'text'
      })).filter(msg => msg.content);
    } catch (error) {
      console.error('Fetch error:', error);
      return [];
    }
  }

  async sendMessage(sender, content, type = 'text', previousId = null) {
    try {
      const msgObj = { sender_id: sender, timestamp: new Date().toISOString(), content, type, previous_msg_id: previousId };
      const title = `Chat: ${sender}-${Date.now()}`;
      
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ title, body: JSON.stringify(msgObj) })
      });
      
      if (!response.ok) throw new Error(`Send failed: ${response.status}`);
      
      return await response.json();
    } catch (error) {
      console.error('Send error:', error);
      throw error;
    }
  }
}

// Global instance
let gchatAPI = null;

