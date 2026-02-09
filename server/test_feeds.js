const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const { spawn } = require('child_process');

const parser = new Parser();
const FEEDS_FILE = path.join(__dirname, '../data/feeds.json');

async function testFeeds() {
    console.log('🧪 Starting Feed Connectivity Tests...\n');

    if (!fs.existsSync(FEEDS_FILE)) {
        console.error('❌ Error: feeds.json not found!');
        process.exit(1);
    }

    const feedsData = JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf8'));
    const categories = Object.keys(feedsData);
    let totalTests = 0;
    let passedTests = 0;

    const rssPromises = [];
    const twitterFeeds = [];

    // Group feeds
    for (const category of categories) {
        const feeds = feedsData[category];
        if (feeds.length === 0) continue;
        const feed = feeds[0]; // Test first feed only

        if (feed.url.includes('twitter.com') || feed.url.includes('x.com') || feed.url.includes('nitter')) {
            twitterFeeds.push({ category, feed });
        } else {
            rssPromises.push({ category, feed });
        }
    }

    totalTests = rssPromises.length + twitterFeeds.length;
    console.log(`Plan: Testing ${rssPromises.length} RSS feeds and ${twitterFeeds.length} Twitter feeds.\n`);

    // 1. Test RSS Feeds in Parallel
    console.log('--- Testing RSS Feeds (Parallel) ---');
    const rssResults = await Promise.all(rssPromises.map(async ({ category, feed }) => {
        try {
            const feedItem = await parser.parseURL(feed.url);
            if (feedItem && feedItem.items && feedItem.items.length > 0) {
                console.log(`  ✅ [PASS] ${category}: ${feed.name} (${feedItem.items.length} items)`);
                return true;
            } else {
                console.error(`  ❌ [FAIL] ${category}: ${feed.name} (No items)`);
                return false;
            }
        } catch (error) {
            console.error(`  ❌ [FAIL] ${category}: ${feed.name} (${error.message})`);
            return false;
        }
    }));

    passedTests += rssResults.filter(r => r).length;

    // 2. Test Twitter Feeds sequentially (to avoid rate limits)
    if (twitterFeeds.length > 0) {
        console.log('\n--- Testing Twitter Feeds (Sequential) ---');
        for (const { category, feed } of twitterFeeds) {
            console.log(`Testing ${category}: ${feed.name}...`);
            const success = await testTwitterFeed(feed.url);
            if (success) {
                console.log(`  ✅ [PASS] Twitter/Nitter fetch successful`);
                passedTests++;
            } else {
                console.error(`  ❌ [FAIL] Twitter fetch failed`);
            }
        }
    }

    console.log(`\nTest Summary: ${passedTests}/${totalTests} passed.`);
    if (passedTests === totalTests) {
        console.log('🎉 All sample tests passed!');
        process.exit(0);
    } else {
        console.error('⚠️ Some tests failed.');
        process.exit(1); // Fail if any test failed
    }
}

function testTwitterFeed(url) {
    return new Promise((resolve) => {
        const venvPath = path.join(__dirname, '../.venv', 'bin', 'python');
        const pythonProcess = spawn(venvPath, ['twitter_client.py', url], { cwd: __dirname });

        let data = '';
        pythonProcess.stdout.on('data', (chunk) => { data += chunk; });

        pythonProcess.on('close', (code) => {
            if (code === 0 && (data.includes('<rss') || data.includes('<feed'))) {
                resolve(true);
            } else {
                resolve(false);
            }
        });

        // Timeout after 45s
        setTimeout(() => {
            pythonProcess.kill();
            resolve(false);
        }, 45000);
    });
}

testFeeds();
