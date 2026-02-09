const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'server/tweets.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE); // Read/Write
const FEEDS_FILE = path.resolve(__dirname, 'data/feeds.json');

const feedsData = JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf8'));
const urlToName = {};

// Build map of URL -> Name
for (const category in feedsData) {
    for (const feed of feedsData[category]) {
        urlToName[feed.url] = feed.name;
    }
}

db.serialize(() => {
    console.log('Fixing missing feed names...');
    db.run("BEGIN TRANSACTION");

    let updates = 0;
    const stmt = db.prepare("UPDATE rss SET feed_name = ? WHERE feed_url = ? AND (feed_name IS NULL OR feed_name = '' OR feed_name = 'Unknown Feed')");

    for (const [url, name] of Object.entries(urlToName)) {
        stmt.run(name, url, function (err) {
            if (err) console.error(err);
            else if (this.changes > 0) {
                console.log(`Updated ${this.changes} rows for ${name}`);
                updates += this.changes;
            }
        });
    }

    stmt.finalize(() => {
        db.run("COMMIT", () => {
            console.log('Fix complete.');
            db.close();
        });
    });
});
