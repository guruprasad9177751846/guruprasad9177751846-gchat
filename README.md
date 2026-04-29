# GChat - Serverless GitHub Chat PWA 🚀

## Quick Start

**Automatic on GitHub Pages:** On `https://YOUR_LOGIN.github.io/gchat/` the app fills **`YOUR_LOGIN/gchat`** for you.

1. **GitHub:** Messages are stored as **Issues** on this repo. Create a [**Personal Access Token (PAT)**](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)—a secret password GitHub gives you so programs can call the API **as your account**:
   - **Classic:** [New token](https://github.com/settings/tokens/new) → enable **`repo`** (or at least access to this repo).
   - **Fine‑grained:** [New token](https://github.com/settings/personal-access-tokens/new) → grant **Issues** read/write on **`gchat`**.

   Paste the token once in the setup modal; it’s saved only in **your browser**. The app **cannot** ship with a token pre-filled: anything in public code is visible to everyone.

2. **Local Test:**
   ```bash
   cd c:/gchat
   npx http-server . -p 8080 -o
   ```
   - Repo field auto-filled only when hosted on **`*.github.io/project/`**. Locally (`file://` or `localhost`), enter **`YOUR_LOGIN/gchat`** manually.
   - Chat! Open 2nd tab as user2

3. **Deploy:**
   ```bash
   git init
   git add .
   git commit -m "Initial GChat"
   git remote add origin https://github.com/YOUR_USERNAME/gchat.git
   git push -u origin main   # use master if your default branch is master
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

