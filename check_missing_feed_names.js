const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'server/tweets.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

db.serialize(() => {
    db.all("SELECT id, feed_name, feed_url, title FROM rss WHERE feed_name IS NULL OR feed_name = '' LIMIT 20", (err, rows) => {
        if (err) console.error(err);
        else {
            console.log(`Found ${rows.length} items with missing feed_name:`);
            console.log(JSON.stringify(rows, null, 2));
        }
    });
});

db.close();
