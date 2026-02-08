const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3000;

function fetchUrl(targetUrl, res, redirects = 0) {
    if (redirects > 5) {
        res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('Too many redirects');
        console.warn(`Too many redirects for ${targetUrl}`);
        return;
    }

    const lib = targetUrl.startsWith('https') ? https : http;
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        },
        timeout: 15000
    };

    const req = lib.get(targetUrl, options, (proxyRes) => {
        // Handle Redirects
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            let newUrl = proxyRes.headers.location;
            if (newUrl.startsWith('/')) {
                const u = new URL(targetUrl);
                newUrl = `${u.protocol}//${u.host}${newUrl}`;
            }
            console.log(`Redirecting to: ${newUrl}`);
            fetchUrl(newUrl, res, redirects + 1);
            return;
        }

        const contentType = proxyRes.headers['content-type'] || 'text/xml';
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Content-Type': contentType
        };

        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res);
    });

    req.on('error', (e) => {
        console.error(`Error fetching ${targetUrl}: ${e.message}`);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end(`Error: ${e.message}`);
        }
    });

    req.on('timeout', () => {
        req.destroy();
        if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('Gateway Timeout');
        }
    });
}

const server = http.createServer((req, res) => {
    // CORS Preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/proxy') {
        const targetUrl = parsedUrl.query.url;
        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing URL');
            return;
        }

        // Check if it's a Twitter/X/Xcancel URL
        const isTwitter = targetUrl.includes('twitter.com') || targetUrl.includes('x.com') || targetUrl.includes('xcancel.com');

        if (isTwitter) {
            console.log(`Routing to Python (Twikit): ${targetUrl}`);
            // Spawn python script
            const { spawn } = require('child_process');
            const pythonProcess = spawn('.venv/bin/python', ['twitter_client.py', targetUrl]);

            let data = '';
            let errorData = '';

            pythonProcess.stdout.on('data', (chunk) => {
                data += chunk;
            });

            pythonProcess.stderr.on('data', (chunk) => {
                errorData += chunk;
                console.error(`Python stderr: ${chunk}`);
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Python exited with code ${code}`);
                    if (!res.headersSent) {
                        // Fallback: If python fails (e.g. no cookies), return 500 but CLIENT will handle it as error
                        res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
                        res.end(`Proxy Error (Exit Code ${code}): ${errorData}`);
                    }
                    return;
                }

                if (!res.headersSent) {
                    res.writeHead(200, {
                        'Content-Type': 'application/xml',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, OPTIONS'
                    });
                    res.end(data);
                }
            });
        } else {
            console.log(`Proxying (Standard): ${targetUrl}`);
            fetchUrl(targetUrl, res);
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`RSS Proxy listening on http://localhost:${PORT}`);
});
