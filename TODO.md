# GChat PWA - Serverless GitHub Chat Tracker

## Current Status: Initial Structure Created

### Phase 0: Project Setup [✅ DONE]
- 📁 Created directory structure (css/, js/, icons/)
- 📄 Created TODO.md
- 📄 Created index.html (main UI)
- 📄 Created manifest.json (PWA)
- 📄 Created sw.js (Service Worker)
- 📄 Created css/style.css (WhatsApp-style)
- 📄 Created js/app.js (core logic)
- 📄 Created js/github-api.js (GitHub API)
- 📄 Created README.md (instructions)

### Phase 1: GitHub Backend Config [⏳ PENDING - User Action]
- Use **this** repo (`guruprasad9177751846/guruprasad9177751846-gchat`) for Issues — no separate backend repo
- Generate PAT: https://github.com/settings/tokens (scopes: repo or fine-grained Issues on `guruprasad9177751846-gchat`)
- Config: Open app, enter `OWNER/REPO` and TOKEN in modal / localStorage

### Phase 2: Test Backend [⏳ PENDING]
- Send test message via UI
- Verify GitHub Issues created

### Phase 3: Real-time & UI Polish [⏳ PENDING]
- Verify 2s polling
- Add timestamps/bubbles

### Phase 4: Notifications & PWA [⏳ PENDING]
- Test browser notifs
- Install PWA
- Test background sync

### Phase 5: Optimizations [⏳ PENDING]
- IndexedDB cache
- Adaptive polling
- AES encryption

### Phase 6: Deploy [⏳ PENDING]
- git init, push to GitHub Pages

**Commands to run now:**
\`\`\`bash
npx http-server . -p 8080 -o
\`\`\`
or open index.html manually.

