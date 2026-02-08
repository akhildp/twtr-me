// Environment Configuration
const CONFIG = {
    // Development settings (local)
    development: {
        proxyHost: '192.168.1.226',
        proxyPort: 3000,
        appPort: 8080,
        mode: 'development'
    },

    // Production settings (VPS)
    production: {
        proxyHost: window.location.hostname, // Use current domain
        proxyPort: 3000,
        appPort: 80, // or 443 for HTTPS
        mode: 'production'
    },

    // Cache settings
    cache: {
        version: 'v1',
        ttl: 10 * 60 * 1000, // 10 minutes
        maxAgeDays: 7
    },

    // Auto-detect environment
    get current() {
        const hostname = window.location.hostname;
        const isDev = hostname === 'localhost' || hostname.startsWith('192.168') || hostname === '127.0.0.1';
        return isDev ? this.development : this.production;
    },

    // Get proxy URL
    get proxyUrl() {
        const { proxyHost, proxyPort } = this.current;
        return `http://${proxyHost}:${proxyPort}/proxy`;
    }
};

// Export for use in app.js
window.CONFIG = CONFIG;
