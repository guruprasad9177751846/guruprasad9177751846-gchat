# GChat - Serverless GitHub Chat PWA 🚀

## Quick Start

1. **Create GitHub Backend:**
   ```
   1. New repo: gchat-messages
   2. Settings > Tokens > Generate new (scopes: repo)
   3. Copy repo name (username/gchat-messages) & token
   ```

2. **Local Test:**
   ```bash
   cd c:/gchat
   npx http-server . -p 8080 -o
   ```
   - Enter repo/token in modal
   - Chat! Open 2nd tab as user2

3. **Deploy:**
   ```bash
   git init
   git add .
   git commit -m "Initial GChat"
   git remote add origin https://github.com/YOUR_USERNAME/gchat-ui.git
   git push -u origin main
   ```
   - Enable GitHub Pages

## Features
- ✅ 2s polling (real-time-ish)
- ✅ WhatsApp UI, mobile PWA
- ✅ Notifications (browser + SW)
- ✅ Offline caching
- 🔄 Optimizations pending

## Usage (2 users)
- Browser 1: user1
- Browser 2: user2
- Messages sync via GitHub Issues!

**Works in restricted networks! No VPN needed.**

