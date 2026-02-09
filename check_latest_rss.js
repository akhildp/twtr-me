const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'server/tweets.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

db.serialize(() => {
    db.all("SELECT MAX(published_at) as latest FROM rss", (err, rows) => {
        if (err) console.error(err);
        else console.log('Latest RSS item:', rows[0].latest);
    });
});

db.close();
