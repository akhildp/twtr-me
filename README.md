# Twitter RSS Reader

A beautiful, privacy-focused Twitter feed reader using a local proxy and Twikit.

## Features
- 🐦 Read Twitter lists and User timelines
- 💾 SQLite/Postgres storage
- 🎨 Modern Dark/Light themes
- 📊 Engagement metrics (likes/retweets)
- 🔄 Auto-refresh via background cron
- 📱 Mobile responsive

## Tech Stack
- **Frontend:** HTML, CSS, Vanilla JS
- **Backend:** Node.js (Express) + SQLite/Postgres
- **Fetcher:** Python (Twikit)

## Prerequisites
- Node.js (v14+)
- Python 3.8+
- Twitter Account (for cookies)

## Setup

1. **Clone repo:**
   ```bash
   git clone https://github.com/yourusername/tweets.git
   cd tweets
   ```

2. **Install dependencies:**
   ```bash
   # Backend
   npm install

   # Python Fetcher
   pip install twikit
   ```

3. **Authentication:**
   You need a `cookies.json` file from a logged-in Twitter session to fetch tweets.
   - Login to X.com
   - Export cookies to `cookies.json` using a browser extension
   - Place `cookies.json` in the root directory
   - **Note:** `cookies.json` is git-ignored for security.

   **Production/Cloud:**
   Set the `COOKIES_JSON` environment variable with the content of `cookies.json`.

4. **Start Server:**
   ```bash
   node api-server.js
   ```
   The app will run at `http://localhost:3000`.

## Configuration

- Edit `feeds.json` to configure your Twitter lists and RSS feeds.
- The app uses `tweets.db` (SQLite) by default.

## License

MIT
