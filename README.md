# Twitter RSS Reader

A beautiful, privacy-focused Twitter feed reader using RSS feeds via Nitter.

## Features
- 🐦 Read Twitter lists without an account
- 💾 Smart caching (7-day rolling cache)
- 🎨 Dark/Light themes
- 📊 Cache statistics
- 🔄 Auto-refresh
- 📱 Mobile responsive

## Tech Stack
- Frontend: HTML, CSS, Vanilla JS
- Backend: Node.js proxy server
- RSS: Nitter instances

## Local Development

1. **Clone repo:**
   ```bash
   git clone https://github.com/yourusername/twtr-me.git
   cd twtr-me
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start proxy:**
   ```bash
   node proxy.js
   ```

4. **Start app:**
   ```bash
   python3 -m http.server 8080
   ```

5. **Visit:** `http://localhost:8080`

## Deployment

See [deployment_guide.md](deployment_guide.md) for VPS setup.

## Configuration

- Edit `feeds.json` to add/remove Twitter lists
- Edit `config.js` for environment settings

## No Credentials Needed!

This project uses public Nitter RSS feeds - no Twitter API keys required.

## License

MIT
