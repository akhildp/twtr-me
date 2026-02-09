const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Parser = require('rss-parser');

const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    },
    customFields: {
        item: ['author_name', 'author_avatar', 'favorite_count', 'retweet_count', 'guid']
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));

// Explicitly serve feeds.json from data directory
app.get('/feeds.json', (req, res) => {
    res.sendFile(path.join(__dirname, '../data/feeds.json'));
});

// Database Connection
let db;
const isPostgres = !!process.env.DATABASE_URL;

if (isPostgres) {
    console.log('Connecting to PostgreSQL database...');
    db = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    console.log('Connecting to SQLite database...');
    const dbPath = path.resolve(__dirname, 'tweets.db');
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) console.error('Error opening SQLite DB:', err.message);
        else console.log('Connected to SQLite database.');
    });
}

// Helper query function
const query = async (sql, params = []) => {
    if (isPostgres) {
        const result = await db.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params); // PG uses $1, $2
        return result.rows;
    } else {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};



// Helper to check if a feed or table is stale
const isStale = async (table, feedUrl = null) => {
    try {
        let sql = `SELECT MAX(published_at) as last_fetch FROM ${table}`;
        let params = [];
        if (feedUrl) {
            sql += ` WHERE feed_url = ?`;
            params = [feedUrl];
            if (isPostgres) sql = sql.replace('?', '$1');
        }
        const result = await query(sql, params);
        if (!result[0] || !result[0].last_fetch) return true;

        const lastFetch = new Date(result[0].last_fetch);
        const now = new Date();
        const diffMins = (now - lastFetch) / (1000 * 60);
        return diffMins > 10; // 10 minute threshold
    } catch (e) {
        console.error(`Error checking staleness: ${e.message}`);
        return true;
    }
};

// Global flags to prevent multiple simultaneous refreshes
const activeRefreshes = new Set();

const triggerRefresh = async (type, feedUrl = null) => {
    const key = feedUrl || type;
    if (activeRefreshes.has(key)) return;
    activeRefreshes.add(key);

    console.log(`[Refresh] Triggering background refresh for: ${key}`);

    try {
        if (feedUrl) {
            await fetchAndCacheFeed(feedUrl);
        } else {
            // Global refresh (e.g. for /api/tweets or /api/mix)
            const feedsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/feeds.json'), 'utf8'));
            for (const category in feedsData) {
                for (const feed of feedsData[category]) {
                    const isTwitter = feed.url.includes('twitter.com') || feed.url.includes('x.com') || feed.url.includes('nitter');
                    if (type === 'mix' || (type === 'tweets' && isTwitter) || (type === 'rss' && !isTwitter)) {
                        await fetchAndCacheFeed(feed.url, feed.name);
                    }
                }
            }
        }
    } catch (e) {
        console.error(`[Refresh] Global refresh failed: ${e.message}`);
    } finally {
        activeRefreshes.delete(key);
        console.log(`[Refresh] Background refresh complete for: ${key}`);
    }
};

// POST /api/refresh/all (Force refresh all feeds)
app.post('/api/refresh/all', async (req, res) => {
    try {
        console.log(`[Refresh] Manual global refresh requested`);
        // Trigger background refresh for all categories
        triggerRefresh('mix'); // This covers the whole feeds.json
        res.json({ status: 'Refresh started in background' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Refresh failed' });
    }
});

// GET /api/tweets


const fetchAndCacheFeed = async (feedUrl, feedName = '') => {
    console.log(`[RealTime] Fetching fresh data for ${feedUrl}...`);

    const isTwitter = feedUrl.includes('twitter.com') || feedUrl.includes('x.com') || feedUrl.includes('nitter');
    let feedData = null;
    let newCount = 0;

    // Determine target table
    const table = isTwitter ? 'tweets' : 'rss';

    if (isTwitter) {
        console.log(`  Routing to Python (Twikit): ${feedUrl}`);

        try {
            const venvPath = path.join(__dirname, '../.venv', 'bin', 'python');
            const pythonProcess = spawn(venvPath, ['twitter_client.py', feedUrl], { cwd: __dirname });

            let data = '';
            let errorData = '';

            await new Promise((resolve, reject) => {
                pythonProcess.stdout.on('data', (chunk) => { data += chunk; });
                pythonProcess.stderr.on('data', (chunk) => { errorData += chunk; });

                pythonProcess.on('close', (code) => {
                    if (code === 0 && data.trim()) {
                        resolve();
                    } else {
                        reject(new Error(`Python exited with code ${code}: ${errorData}`));
                    }
                });

                // Safety timeout
                setTimeout(() => {
                    pythonProcess.kill();
                    reject(new Error('Python execution timed out'));
                }, 30000);
            });

            if (data.includes('<rss') || data.includes('<feed')) {
                feedData = await parser.parseString(data);
                console.log(`  ✓ Success via twitter_client.py`);
            }
        } catch (e) {
            console.warn(`  ✗ Failed via twitter_client.py: ${e.message}`);
        }
    } else {
        // Normal RSS feed
        try {
            feedData = await parser.parseURL(feedUrl);
        } catch (e) {
            console.warn(`  ✗ Failed fetching ${feedUrl}: ${e.message}`);
        }
    }

    // Fallback: If feedName was not provided (ad-hoc refresh), try to get it from the parser result
    if (!feedName && feedData && feedData.title) {
        feedName = feedData.title;
    }

    // Final sanity check for feedName
    if (!feedName) feedName = 'Unknown Feed';

    if (!feedData || !feedData.items) {
        console.warn(`[RealTime] No items found or feed fetch failed for ${feedUrl}`);
        return 0;
    }

    for (const item of feedData.items) {
        // Log first item to debug structure
        if (newCount === 0) console.log('[Debug] First Item:', JSON.stringify(item).substring(0, 200) + '...');

        const id = item.guid || item.link || item.id;
        const title = item.title || 'Untitled';
        const content = item.content || item.summary || item.description || '';

        // Prioritize custom tags, then creator/author, then fallback to our discovered feedName
        const author = item.author_name || item.creator || item.author || feedName;
        const authorAvatar = item.author_avatar || null;

        const link = item.link;
        const pubDate = item.isoDate ? new Date(item.isoDate) : new Date();
        // Extract image URL, but avoid RT/QT avatars which are now at the top of content
        // We look for img tags that DO NOT have class="rt-avatar" or class="qt-avatar"
        // Since regex lookaheads for attributes are messy, let's try a slightly more robust regex 
        // that skips the specific avatar classes if possible, or just parse differently.
        // Given we don't have a DOM parser here easily (JSDOM is heavy), let's use a regex that finds the first img 
        // but we'll loop through matches if there are multiple.

        const imgMatches = [...content.matchAll(/<img[^>]+src="([^">]+)"[^>]*>/g)];
        let imageUrl = item.enclosure?.url;

        if (!imageUrl && imgMatches.length > 0) {
            for (const match of imgMatches) {
                // Check if the full tag contains the avatar class
                if (!match[0].includes('class="rt-avatar"') && !match[0].includes('class="qt-avatar"')) {
                    imageUrl = match[1];
                    break;
                }
            }
        }

        // Popularity metrics (specifically for tweets)
        const favoriteCount = parseInt(item.favorite_count || 0);
        const retweetCount = parseInt(item.retweet_count || 0);

        try {
            let sql = '';
            const params = [String(id), feedUrl, feedName, title, content, author, link, imageUrl, pubDate.toISOString(), authorAvatar, favoriteCount, retweetCount];

            if (isPostgres) {
                sql = `INSERT INTO ${table} (id, feed_url, feed_name, title, content, author, link, image_url, published_at, author_avatar, favorite_count, retweet_count)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                       ON CONFLICT (id) DO NOTHING`;
            } else {
                sql = `INSERT OR IGNORE INTO ${table} (id, feed_url, feed_name, title, content, author, link, image_url, published_at, author_avatar, favorite_count, retweet_count)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            }

            if (isPostgres) {
                await db.query(sql, params);
                newCount++; // PG doesn't return row count easily for ON CONFLICT DO NOTHING without RETURNING
            } else {
                await new Promise((resolve) => {
                    db.run(sql, params, function (err) {
                        if (!err && this.changes > 0) newCount++;
                        resolve();
                    });
                });
            }
        } catch (e) {
            console.error(`Error saving tweet: ${e.message}`);
        }
    }

    console.log(`[RealTime] Saved ${newCount} new tweets.`);
    return newCount;
};


// GET /api/tweets (Twitter only)
app.get('/api/tweets', async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    try {
        const refreshing = await isStale('tweets');
        if (refreshing) triggerRefresh('tweets');

        let sql = 'SELECT * FROM tweets ORDER BY published_at DESC LIMIT ? OFFSET ?';
        const params = [parseInt(limit), parseInt(offset)];

        if (isPostgres) {
            sql = 'SELECT * FROM tweets ORDER BY published_at DESC LIMIT $1 OFFSET $2';
        }

        const items = await query(sql, params);
        res.json({ items, refreshing });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/rss (News/Other only)
app.get('/api/rss', async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    try {
        const refreshing = await isStale('rss');
        if (refreshing) triggerRefresh('rss');

        let sql = 'SELECT * FROM rss ORDER BY published_at DESC LIMIT ? OFFSET ?';
        const params = [parseInt(limit), parseInt(offset)];

        if (isPostgres) {
            sql = 'SELECT * FROM rss ORDER BY published_at DESC LIMIT $1 OFFSET $2';
        }

        const items = await query(sql, params);
        res.json({ items, refreshing });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/mix (Union of Tweets and RSS)
app.get('/api/mix', async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    try {
        const refreshing = (await isStale('rss')) || (await isStale('tweets'));
        if (refreshing) triggerRefresh('mix');

        // For /api/mix, we want a balanced union. 
        // We'll fetch 25 of each and interleave them if the user wants true "union all" look,
        // but typically a simple UNION ALL is fine. 
        // However, if one table is much newer, it spans the whole limit.
        // Let's do a more complex query to ensure some of each OR just trust the UNION ALL 
        // but fix the RSS fetching so it actually HAS data.

        let sql = `
            SELECT id, feed_url, feed_name, title, content, author, link, image_url, published_at, author_avatar, 'rss' as source_table 
            FROM rss
            ORDER BY published_at DESC
            LIMIT ? OFFSET ?
        `;
        const params = [parseInt(limit), parseInt(offset)];

        if (isPostgres) {
            sql = `
                SELECT id, feed_url, feed_name, title, content, author, link, image_url, published_at, author_avatar, 'rss' as source_table 
                FROM rss
                ORDER BY published_at DESC
                LIMIT $1 OFFSET $2
            `;
        }

        const items = await query(sql, params);
        res.json({ items, refreshing });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/content (Generic filtered by feed_url)
app.get('/api/content', async (req, res) => {
    const { feed_url, limit = 50, offset = 0 } = req.query;

    if (!feed_url) {
        return res.status(400).json({ error: 'feed_url is required' });
    }

    try {
        let table = 'rss';
        if (feed_url.includes('twitter') || feed_url.includes('nitter') || feed_url.includes('x.com')) {
            table = 'tweets';
        }

        const refreshing = await isStale(table, feed_url);
        if (refreshing) triggerRefresh(null, feed_url);

        let sql = `SELECT * FROM ${table} WHERE feed_url = ? ORDER BY published_at DESC LIMIT ? OFFSET ?`;
        const params = [feed_url, parseInt(limit), parseInt(offset)];

        if (isPostgres) {
            sql = `SELECT * FROM ${table} WHERE feed_url = $1 ORDER BY published_at DESC LIMIT $2 OFFSET $3`;
        }

        const items = await query(sql, params);
        res.json({ items, refreshing });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await query(`
            SELECT 
                COUNT(*) as totalTweets,
                COUNT(DISTINCT feed_url) as feedCount,
                MIN(published_at) as oldestDate,
                MAX(published_at) as newestDate
            FROM tweets
        `);

        // SQLite returns date strings, Postgres returns Date objects
        // We ensure consistency here if needed, but JSON serialization handles it mostly
        res.json(stats[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', database: isPostgres ? 'postgresql' : 'sqlite' });
});

// Start server
app.listen(PORT, () => {
    console.log(`API Server running on port ${PORT}`);
});
