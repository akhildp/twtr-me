const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'tweets.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE);

db.serialize(() => {
    db.all("SELECT COUNT(*) as count FROM rss WHERE feed_url LIKE '%twitter%' OR feed_url LIKE '%x.com%' OR feed_url LIKE '%nitter%'", (err, rows) => {
        if (err) {
            console.error('Error:', err);
        } else {
            console.log('Twitter items in RSS table:', rows[0].count);
        }
    });

    // Also check if we have any items at all
    db.all("SELECT COUNT(*) as count FROM rss", (err, rows) => {
        if (err) console.error(err);
        else console.log('Total items in RSS table:', rows[0].count);
    });
});

db.close();
