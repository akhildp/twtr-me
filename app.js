// RSS Feed Reader App with Dashboard Layout

let FEED_CATEGORIES = {};

class FeedReader {
    constructor() {
        this.feeds = [];

        // Load global article cache from localStorage (accumulates over 7 days)
        const cachedArticles = localStorage.getItem('global_article_cache');
        this.articles = cachedArticles ? JSON.parse(cachedArticles).map(a => ({
            ...a,
            time: new Date(a.time) // Restore Date objects
        })) : [];

        this.settings = {
            refreshInterval: 10,
            enabledCategories: [] // Empty means all
        };

        // Dashboard Columns State
        // Default: Col 1 = Home, Col 2 = Twitter News, Col 3 = News
        this.columns = [
            { id: 1, type: 'mix', title: 'Home', icon: '🏠' },
            { id: 2, type: 'category', value: 'Twitter Lists', title: 'Twitter Mix', icon: '🐦', shuffle: true },
            { id: 3, type: 'category', value: 'News', title: 'News', icon: '📑' }
        ];

        this.refreshTimer = null;
        this.loadedCategories = new Set();
        this.refreshTimer = null;
        this.loadedCategories = new Set();
        this.configColumnId = null;
        this.mobileActiveColumn = 2; // Default to Twitter Lists (Column 2) on mobile
        this.theme = localStorage.getItem('theme') || 'dark';

        // Cache settings
        this.CACHE_VERSION = 'v1';
        this.CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds
        this.CACHE_MAX_AGE_DAYS = 7; // Keep articles from last 7 days

        // Feed diversity tracking
        this.feedHistory = JSON.parse(localStorage.getItem('feed_history') || '{}');

        this.init();
    }

    init() {
        this.loadSettings();
        this.applyTheme();
        this.loadColumnConfig();
        if (Object.keys(FEED_CATEGORIES).length > 0) {
            this.loadFeeds();
            this.bindEvents();
            this.renderSidebar();
            this.startAutoRefresh();
            this.loadAllColumns();

            // Initialize mobile view after a short delay to ensure DOM is ready
            setTimeout(() => this.updateMobileView(), 100);
        }
    }

    // --- Loading Columns ---

    async loadAllColumns() {
        this.loadColumn(1);
        setTimeout(() => this.loadColumn(2), 500);
        setTimeout(() => this.loadColumn(3), 1000);
    }

    // --- Feed Diversity Algorithm ---

    calculateFeedWeight(feedUrl) {
        const history = this.feedHistory[feedUrl];

        // Never shown before = highest priority
        if (!history) return 10;

        const now = Date.now();
        const hoursSinceShown = (now - history.lastShown) / (1000 * 60 * 60);

        // Recency weight: increases with time (0-5 over 5 days)
        const recencyWeight = Math.min(hoursSinceShown / 24, 5);

        // Frequency penalty: more shown = lower weight
        const frequencyPenalty = (history.showCount || 0) / 10;

        // Final weight: at least 1, maximum benefit for old/rare feeds
        return Math.max(1, recencyWeight - frequencyPenalty);
    }

    weightedShuffle(feeds) {
        if (!feeds || feeds.length === 0) return [];

        // Calculate weights for each feed
        const feedsWithWeights = feeds.map(feed => ({
            feed,
            weight: this.calculateFeedWeight(feed.url)
        }));

        // Total weight for probability calculation
        const totalWeight = feedsWithWeights.reduce((sum, item) => sum + item.weight, 0);

        // Weighted random selection without replacement
        const selected = [];
        const remaining = [...feedsWithWeights];

        while (remaining.length > 0 && selected.length < feeds.length) {
            const currentTotal = remaining.reduce((sum, item) => sum + item.weight, 0);
            let random = Math.random() * currentTotal;

            for (let i = 0; i < remaining.length; i++) {
                random -= remaining[i].weight;
                if (random <= 0) {
                    selected.push(remaining[i].feed);
                    remaining.splice(i, 1);
                    break;
                }
            }
        }

        return selected;
    }

    updateFeedHistory(feedUrl) {
        if (!this.feedHistory[feedUrl]) {
            this.feedHistory[feedUrl] = { lastShown: Date.now(), showCount: 1 };
        } else {
            this.feedHistory[feedUrl].lastShown = Date.now();
            this.feedHistory[feedUrl].showCount++;
        }
        localStorage.setItem('feed_history', JSON.stringify(this.feedHistory));
    }

    async loadColumn(colId) {
        const col = this.columns.find(c => c.id === colId);
        if (!col) return;

        const container = document.getElementById(`col-${colId}-content`);
        if (container) {
            container.innerHTML = `
                <div class="feed-loading">
                    <div class="spinner"></div>
                    <p>Loading...</p>
                </div>`;
        }

        // Identify feeds to fetch
        let feedsToFetch = [];

        if (col.type === 'mix') {
            const shuffled = [...this.feeds].sort(() => 0.5 - Math.random());
            feedsToFetch = shuffled.slice(0, 15);
        } else if (col.type === 'category') {
            let categoryFeeds = this.feeds.filter(f => f.category === col.value);

            // Use weighted shuffle if shuffle is enabled
            if (col.shuffle) {
                feedsToFetch = this.weightedShuffle(categoryFeeds);
            } else {
                feedsToFetch = categoryFeeds;
            }

            this.loadedCategories.add(col.value);
        } else if (col.type === 'subcategory') {
            feedsToFetch = this.feeds.filter(f => f.category === col.value && f.subcategory === col.subValue);
            this.loadedCategories.add(col.value + ':' + col.subValue);
        } else if (col.type === 'feed') {
            feedsToFetch = this.feeds.filter(f => f.url === col.value);
        }

        // Update feed history for displayed feeds
        feedsToFetch.forEach(feed => this.updateFeedHistory(feed.url));

        console.log(`[Col ${colId}] Found ${feedsToFetch.length} feeds to fetch.`);

        if (feedsToFetch.length === 0) {
            if (container) container.innerHTML = `<div class="feed-empty"><p>No feeds found for this selection.</p></div>`;
            return;
        }

        // Fetch feeds
        const batchSize = 3;
        let successCount = 0;
        let blockedCount = 0;

        for (let i = 0; i < feedsToFetch.length; i += batchSize) {
            const batch = feedsToFetch.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(feed => this.fetchFeed(feed)));

            results.forEach(res => {
                if (res.status === 'fulfilled') {
                    if (res.value === 'BLOCKED') blockedCount++;
                    else if (res.value === true) successCount++;
                }
            });

            if (i + batchSize < feedsToFetch.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        console.log(`[Col ${colId}] ✓ ${successCount} feeds loaded | ${blockedCount} blocked`);

        // Save accumulated articles to global cache
        this.saveGlobalCache();

        // Render column with all articles
        this.renderColumn(colId);

        if (successCount === 0 && blockedCount > 0) {
            let fallbackUrl = 'https://xcancel.com';
            let btnText = 'Open Xcancel';

            if (col.type === 'feed') {
                // Convert RSS URL to HTML URL if possible
                // e.g. https://xcancel.com/user/rss -> https://xcancel.com/user
                fallbackUrl = col.value.replace('/rss', '');
                btnText = 'Open Feed';
            } else if (col.type === 'subcategory') {
                fallbackUrl = `https://xcancel.com/search?q=${encodeURIComponent(col.subValue)}`;
                btnText = `Search ${col.subValue}`;
            }

            if (container) container.innerHTML = `
               <div class="feed-empty">
                   <div class="empty-icon">🚫</div>
                   <h3>Feeds Blocked</h3>
                   <p>Twitter is blocking our automated requests.</p>
                   <button class="show-more-btn" onclick="window.open('${fallbackUrl}', '_blank')" style="margin-top:10px; background: var(--accent); color: white; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer;">
                       ${btnText} 🔗
                   </button>
               </div>`;
            return;
        }
    }

    // --- Sidebar Interaction ---

    loadColumnForSidebar(type, value, extra) {
        // Always target Column 3 for sidebar clicks
        const colIndex = 2; // Index 2 is Column 3
        const colId = 3;

        this.columns[colIndex].type = type;
        this.columns[colIndex].value = value;

        if (type === 'subcategory') {
            // value = Category (Twitter), extra = Subcategory (AI)
            this.columns[colIndex].subValue = extra;
            this.columns[colIndex].title = `${value} ${extra}`;
            this.columns[colIndex].icon = '🐦';
        } else if (type === 'category') {
            this.columns[colIndex].subValue = null;
            this.columns[colIndex].title = value;
            this.columns[colIndex].icon = '📂';
        } else if (type === 'feed') {
            this.columns[colIndex].subValue = null;
            this.columns[colIndex].title = extra || 'Feed';
            this.columns[colIndex].icon = '🔗';
        }

        this.saveColumnConfigLink();
        this.loadColumn(colId);

        // Mobile: Switch to column 3 and close sidebar
        if (this.isMobile()) {
            this.mobileActiveColumn = colId;
            this.updateMobileView();
            document.getElementById('sidebar').classList.remove('open');
        }
    }

    // --- Rendering ---

    renderColumn(colId) {
        const col = this.columns.find(c => c.id === colId);
        const container = document.getElementById(`col-${colId}-content`);
        const titleEl = document.getElementById(`col-${colId}-title`);
        if (!container) return;

        if (colId !== 1 && titleEl) {
            titleEl.querySelector('h3').textContent = col.title;
            titleEl.querySelector('.column-icon').textContent = col.icon || '📑';
        }

        let colArticles = [...this.articles];

        // 1. Filter based on column type
        if (col.type === 'mix') {
            // Mix: include everything (no filter needed yet)
        } else if (col.type === 'category') {
            colArticles = colArticles.filter(a => a.category === col.value);
        } else if (col.type === 'subcategory') {
            colArticles = colArticles.filter(a => a.category === col.value && a.subcategory === col.subValue);
        } else if (col.type === 'feed') {
            colArticles = colArticles.filter(a => a.feedUrl === col.value);
        }

        // 2. Sort or Shuffle
        if (col.type === 'mix' || col.shuffle) {
            colArticles.sort(() => 0.5 - Math.random());
        } else {
            colArticles.sort((a, b) => b.time - a.time);
        }

        // 3. Limit
        // Show all articles (no limit for accumulative caching)

        if (colArticles.length === 0) {
            container.innerHTML = `
                <div class="feed-empty">
                    <div class="empty-icon">📭</div>
                    <h3>No articles</h3>
                    <p>Try refreshing or checking settings.</p>
                </div>`;
            return;
        }

        container.innerHTML = colArticles.map((article, index) => {
            const contentId = `col-${colId}-article-${index}`;

            // Create temp div to get text-only length (exclude HTML tags)
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = article.content;
            const textContent = tempDiv.textContent || tempDiv.innerText || '';
            const isLong = textContent.length > 280; // Increased threshold, based on text not HTML

            const isTwitter = article.category === 'Twitter Lists' || article.feedUrl.includes('twitter.com') || article.feedUrl.includes('x.com');

            // Display Logic
            // Source (Top): Display Name (Yann LeCun) for Twitter, Feed Name for others
            const displaySource = isTwitter ? (article.authorName || article.title) : article.feedName;

            // Avatar: Real Avatar for Twitter, Letter for others
            const avatarHtml = (isTwitter && article.authorAvatar)
                ? `<img src="${article.authorAvatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`
                : displaySource[0].toUpperCase();

            // Meta (Bottom): @handle · List Name · Time
            let displayMeta = '';
            if (isTwitter) {
                // article.title is @handle from RSS
                displayMeta = `${article.title} · ${article.feedName}`;
            } else {
                displayMeta = article.subcategory ? article.category + ' · ' + article.subcategory : article.category;
            }

            return `
            <article class="article-card" onclick="window.open('${article.link}', '_blank')">
                <div class="article-header">
                    <div class="article-avatar" style="${isTwitter && article.authorAvatar ? 'background:none;' : ''}">${avatarHtml}</div>
                    <div class="article-meta">
                        <div class="article-source">${displaySource}</div>
                        <div class="article-time">${displayMeta} · ${this.formatTime(article.time)}</div>
                    </div>
                </div>
                
                ${!isTwitter ? `<div class="article-title">${article.title}</div>` : ''}
                
                ${article.imageUrl ? `
                    <div class="article-media">
                        <img src="${article.imageUrl}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
                    </div>
                ` : ''}


                <div id="${contentId}" class="article-content ${isLong ? 'truncated' : ''}">${this.parseTwitterContent(article.content, article.imageUrl)}</div>
                
                <div class="article-actions">
                    ${isLong ? `<button class="show-more-btn" onclick="event.stopPropagation(); app.toggleArticle('${contentId}', this)">Show more</button>` : '<div></div>'}
                    <button class="article-link" onclick="event.stopPropagation(); app.copyLink('${article.link}')" title="Copy link">🔗</button>
                </div>
            </article>
            `;
        }).join('');
    }

    // --- Configuration ---

    openColumnConfig(colId) {
        this.configColumnId = colId;
        const modal = document.getElementById('columnConfigModal');
        const title = document.getElementById('configColumnId');
        const select = document.getElementById('columnSourceSelect');

        title.textContent = colId;

        let html = `<option value="">-- Select Source --</option>`;

        Object.keys(FEED_CATEGORIES).forEach(cat => {
            if (cat === 'Twitter') {
                const subcats = [...new Set(FEED_CATEGORIES[cat].map(f => f.subcategory))].sort();
                html += `<optgroup label="Twitter">`;
                subcats.forEach(sub => {
                    html += `<option value="subcategory:Twitter:${sub}">🐦 Twitter: ${sub}</option>`;
                });
                html += `</optgroup>`;
            } else {
                html += `<option value="category:${cat}">📂 ${cat}</option>`;
            }
        });

        html += `<optgroup label="Individual Feeds">`;
        this.feeds.forEach(feed => {
            html += `<option value="feed:${feed.url}">🔗 ${feed.name}</option>`;
        });
        html += `</optgroup>`;

        select.innerHTML = html;
        modal.classList.add('active');
    }

    closeColumnConfig() {
        document.getElementById('columnConfigModal').classList.remove('active');
        this.configColumnId = null;
    }

    saveColumnConfig() {
        const select = document.getElementById('columnSourceSelect');
        const value = select.value;
        if (!value) return;

        let type, val, sub;

        if (value.startsWith('subcategory:')) {
            const parts = value.split(':');
            type = 'subcategory';
            val = parts[1];
            sub = parts[2];
        } else if (value.startsWith('category:')) {
            type = 'category';
            val = value.substring(9);
        } else if (value.startsWith('feed:')) {
            type = 'feed';
            val = value.substring(5);
        }

        const colIndex = this.columns.findIndex(c => c.id === this.configColumnId);

        if (colIndex !== -1) {
            this.columns[colIndex].type = type;
            this.columns[colIndex].value = val;
            this.columns[colIndex].subValue = sub || null;

            if (type === 'subcategory') {
                this.columns[colIndex].title = `${val} ${sub}`;
                this.columns[colIndex].icon = '🐦';
            } else if (type === 'category') {
                this.columns[colIndex].title = val;
                this.columns[colIndex].icon = '📂';
            } else {
                const feed = this.feeds.find(f => f.url === val);
                this.columns[colIndex].title = feed ? feed.name : 'Feed';
                this.columns[colIndex].icon = '🔗';
            }

            this.saveColumnConfigLink();
            this.loadColumn(this.configColumnId);
            this.closeColumnConfig();
        }
    }

    saveColumnConfigLink() {
        localStorage.setItem('rss_columns', JSON.stringify(this.columns));
    }

    loadColumnConfig() {
        const saved = localStorage.getItem('rss_columns');
        if (saved) {
            this.columns = JSON.parse(saved);
        }

        // Migration: Force update Col 2 if it's still "Twitter News"
        if (this.columns[1] && this.columns[1].value === 'Twitter' && this.columns[1].subValue === 'News') {
            this.columns[1] = { id: 2, type: 'category', value: 'Twitter', title: 'Twitter Feed', icon: '🐦' };
            this.saveColumnConfig();
        }

        // Migration 2: Switch "Twitter" or "News" (default) in Col 2 to "Twitter List" feed
        if (this.columns[1]) {
            const isLegacyTwitter = this.columns[1].value === 'Twitter';
            const isLegacyNews = this.columns[1].value === 'News'; // If user reset or never changed default

            if (isLegacyTwitter || isLegacyNews) {
                this.columns[1] = {
                    id: 2,
                    type: 'feed',
                    value: 'https://x.com/i/lists/1614585113991340032',
                    title: 'My Tech Feed',
                    icon: '🐦'
                };
                this.saveColumnConfig();
            }
        }

        // Migration 3: Force update to new 3-column layout
        // Col 2: Twitter List (Shuffled)
        if (this.columns[1]) {
            this.columns[1] = {
                id: 2,
                type: 'category',
                value: 'Twitter Lists',
                title: 'Twitter Mix',
                icon: '🐦',
                shuffle: true
            };
            this.saveColumnConfig();
        }

        // Migration 4: Ensure Column 3 defaults to News (fixing stuck state)
        if (this.columns[2] && this.columns[2].value !== 'News' && !localStorage.getItem('col3_fixed')) {
            this.columns[2] = { id: 3, type: 'category', value: 'News', title: 'News', icon: '📑' };
            this.saveColumnConfig();
            localStorage.setItem('col3_fixed', 'true');
        }
    }

    // --- Core Methods ---

    // --- Cache Management ---

    saveGlobalCache() {
        try {
            // Prune old articles before saving
            this.pruneOldArticles();

            // Save to localStorage
            localStorage.setItem('global_article_cache', JSON.stringify(this.articles));
            console.log(`💾 Saved ${this.articles.length} articles to global cache`);
        } catch (e) {
            console.warn('Failed to save global cache:', e);
        }
    }

    pruneOldArticles() {
        const cutoffDate = new Date(Date.now() - (this.CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000));
        const beforeCount = this.articles.length;

        this.articles = this.articles.filter(article => article.time >= cutoffDate);

        const prunedCount = beforeCount - this.articles.length;
        if (prunedCount > 0) {
            console.log(`🗑️ Pruned ${prunedCount} articles older than ${this.CACHE_MAX_AGE_DAYS} days`);
        }
    }

    getCacheKey(feedUrl) {
        // Simple hash for cache key
        return `rss_cache_${this.CACHE_VERSION}_${btoa(feedUrl).replace(/[^a-zA-Z0-9]/g, '')}`;
    }

    saveToCache(feedUrl, articles) {
        try {
            // Filter articles to only those from the last 7 days
            const cutoffDate = new Date(Date.now() - (this.CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000));
            const recentArticles = articles.filter(article => article.time >= cutoffDate);

            const cacheData = {
                articles: recentArticles,
                timestamp: Date.now(),
                feedUrl: feedUrl
            };
            localStorage.setItem(this.getCacheKey(feedUrl), JSON.stringify(cacheData));
        } catch (e) {
            console.warn('Failed to save cache:', e);
        }
    }

    loadFromCache(feedUrl) {
        try {
            const cacheKey = this.getCacheKey(feedUrl);
            const cached = localStorage.getItem(cacheKey);

            if (!cached) return null;

            const cacheData = JSON.parse(cached);
            const age = Date.now() - cacheData.timestamp;

            // Return cache if within TTL, null if expired
            if (age < this.CACHE_TTL) {
                return cacheData.articles;
            }

            // Cache expired - still return it for stale-while-revalidate
            return cacheData.articles;
        } catch (e) {
            console.warn('Failed to load cache:', e);
            return null;
        }
    }

    isCacheFresh(feedUrl) {
        try {
            const cacheKey = this.getCacheKey(feedUrl);
            const cached = localStorage.getItem(cacheKey);

            if (!cached) return false;

            const cacheData = JSON.parse(cached);
            const age = Date.now() - cacheData.timestamp;

            return age < this.CACHE_TTL;
        } catch (e) {
            return false;
        }
    }

    mergeArticles(cachedArticles, freshArticles) {
        // Create a map of existing articles by ID
        const articleMap = new Map();

        // Add cached articles first
        cachedArticles.forEach(article => {
            articleMap.set(article.id, article);
        });

        // Add/update with fresh articles (newer takes precedence)
        freshArticles.forEach(article => {
            articleMap.set(article.id, article);
        });

        // Filter to only articles from last 7 days
        const cutoffDate = new Date(Date.now() - (this.CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000));

        // Convert back to array, filter by date, and sort by time (newest first)
        return Array.from(articleMap.values())
            .filter(article => article.time >= cutoffDate)
            .sort((a, b) => b.time - a.time);
    }

    async fetchFeed(feed) {
        // Try to load from cache first
        const cachedArticles = this.loadFromCache(feed.url);
        const isFresh = this.isCacheFresh(feed.url);

        // If cache is fresh, use it and skip fetch
        if (isFresh && cachedArticles) {
            cachedArticles.forEach(article => {
                if (!this.articles.find(a => a.id === article.id)) {
                    this.articles.push(article);
                }
            });
            console.log(`✓ ${feed.name} (from cache)`);
            return true;
        }

        // If we have stale cache, add it to articles immediately (for instant display)
        if (cachedArticles && cachedArticles.length > 0) {
            cachedArticles.forEach(article => {
                if (!this.articles.find(a => a.id === article.id)) {
                    this.articles.push(article);
                }
            });
        }

        // Use proxy from config (auto-detects dev/prod environment)
        const proxyUrl = `${CONFIG.proxyUrl}?url=${encodeURIComponent(feed.url)}`;

        try {
            const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) {
                console.warn(`✗ ${feed.name} (${feed.url}): ${response.status}`);
                return cachedArticles ? true : false; // Return success if we have cache
            }

            const text = await response.text();

            // Check for blocking messages
            if (text.includes('whitelist') || text.includes('Cloudflare') || text.includes('Attention Required')) {
                console.warn(`✗ ${feed.name}: BLOCKED via Whitelist/Cloudflare`);
                return 'BLOCKED';
            }

            // Basic validation
            if ((!text.includes('<rss') && !text.includes('<feed') && !text.includes('<rdf')) ||
                (!text.includes('<item') && !text.includes('<entry'))) {
                console.warn(`✗ ${feed.name}: Invalid XML/No items found.`);
                return false;
            }

            const articles = this.parseRSS(text, feed);
            if (articles.length === 0) return false;

            articles.forEach(article => {
                // Add subcategory to article object if present
                article.subcategory = feed.subcategory;

                if (!this.articles.find(a => a.id === article.id)) {
                    this.articles.push(article);
                }
            });

            // Save fresh articles to cache
            this.saveToCache(feed.url, articles);

            return true;
        } catch (error) {
            console.warn(`Error fetching ${feed.name}:`, error);
            return false;
        }
    }

    parseRSS(xmlText, feed) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'text/xml');
        let items = doc.querySelectorAll('item');
        if (items.length === 0) items = doc.querySelectorAll('entry');

        return Array.from(items).slice(0, 10).map((item, index) => {
            let title = item.querySelector('title')?.textContent || '';

            // Try to get full HTML content from description/summary/content
            // Some RSS feeds use CDATA for HTML content, others use encoded HTML
            let descriptionNode = item.querySelector('description') || item.querySelector('summary') || item.querySelector('content');
            let description = '';

            if (descriptionNode) {
                // Try innerHTML first (preserves CDATA content), fallback to textContent
                description = descriptionNode.innerHTML || descriptionNode.textContent || '';
                // Remove CDATA wrappers if present
                description = description.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
            }

            let link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href') || '';
            let pubDate = item.querySelector('pubDate')?.textContent || item.querySelector('published')?.textContent || item.querySelector('updated')?.textContent || '';

            // Custom Twitter Tags
            let authorName = item.getElementsByTagName('author_name')[0]?.textContent || '';
            let authorAvatar = item.getElementsByTagName('author_avatar')[0]?.textContent || '';

            let content = description; // Keep HTML for images and quotes

            let imageUrl = null;
            const imgMatch = description.match(/<img[^>]+src="([^"]+)"/);
            if (imgMatch) imageUrl = imgMatch[1];
            const mediaContent = item.querySelector('content[url], thumbnail[url], enclosure[url]');
            if (mediaContent) imageUrl = mediaContent.getAttribute('url');

            return {
                id: `${feed.url}-${index}`,
                feedName: feed.name,
                feedUrl: feed.url,
                category: feed.category,
                subcategory: feed.subcategory,
                title,
                authorName,
                authorAvatar,
                content,
                link,
                time: pubDate ? new Date(pubDate) : new Date(),
                imageUrl
            };
        });
    }

    markAsRead(id) {
        this.readArticles.add(id);
        localStorage.setItem('read_articles', JSON.stringify([...this.readArticles]));
    }

    toggleArticle(contentId, button) {
        const content = document.getElementById(contentId);
        content.classList.toggle('truncated');
        content.classList.toggle('expanded');
        button.textContent = content.classList.contains('truncated') ? 'Show more' : 'Show less';
    }

    copyLink(url) {
        // Try modern clipboard API first (requires HTTPS)
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url).then(() => this.showToast('Copied!', 'success'));
        } else {
            // Fallback for HTTP (mobile)
            const textarea = document.createElement('textarea');
            textarea.value = url;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                this.showToast('Copied!', 'success');
            } catch (err) {
                this.showToast('Copy failed', 'error');
            }
            document.body.removeChild(textarea);
        }
    }

    // Parse Twitter content to properly handle Quote Tweets and Retweets
    parseTwitterContent(content, mainImageUrl) {
        // Create a temporary div to parse HTML
        const div = document.createElement('div');
        div.innerHTML = content;

        // Detect and handle Retweets (RT @username: ...)
        const textContent = div.textContent || div.innerText;
        const rtMatch = textContent.match(/^RT\s+@(\w+):\s*/i);

        if (rtMatch) {
            // It's a Retweet - add visual indicator
            const rtIndicator = document.createElement('div');
            rtIndicator.className = 'rt-indicator';
            rtIndicator.innerHTML = `<span>🔁 Retweeted from @${rtMatch[1]}</span>`;

            // Remove the "RT @username:" prefix from content
            const firstTextNode = div.querySelector('p') || div;
            if (firstTextNode) {
                firstTextNode.textContent = firstTextNode.textContent.replace(/^RT\s+@\w+:\s*/i, '');
            }

            div.insertBefore(rtIndicator, div.firstChild);
        }

        // Find blockquotes (Quote Tweets in Nitter RSS)
        const blockquotes = div.querySelectorAll('blockquote');

        if (blockquotes.length > 0) {
            // Has quoted tweet - wrap in special styling
            blockquotes.forEach(blockquote => {
                blockquote.classList.add('quoted-tweet');

                // Keep images within quoted tweets
                const quotedImages = blockquote.querySelectorAll('img');
                quotedImages.forEach(img => {
                    img.classList.add('quoted-image');
                    img.setAttribute('loading', 'lazy');
                });
            });
        }

        // Remove duplicate top-level images (already shown in article-media)
        if (mainImageUrl) {
            const topLevelImages = Array.from(div.querySelectorAll(':scope > img, :scope > p > img'));
            topLevelImages.forEach(img => {
                // Only remove if it matches the main image
                if (img.src === mainImageUrl || img.src.includes(mainImageUrl)) {
                    img.remove();
                }
            });
        }

        // Style all remaining images
        const allImages = div.querySelectorAll('img:not(.quoted-image)');
        allImages.forEach(img => {
            img.classList.add('content-image');
            img.setAttribute('loading', 'lazy');
            img.setAttribute('onerror', "this.style.display='none'");
        });

        // Clean up links (make them prevent card click)
        const links = div.querySelectorAll('a');
        links.forEach(link => {
            link.setAttribute('onclick', 'event.stopPropagation()');
            link.setAttribute('target', '_blank');
        });

        return div.innerHTML;
    }

    formatTime(date) {
        if (!(date instanceof Date) || isNaN(date)) return '';
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (minutes < 1) return 'now';
        if (minutes < 60) return `${minutes}m`;
        if (hours < 24) return `${hours}h`;
        return `${days}d`;
    }

    loadSettings() {
        const saved = localStorage.getItem('rss_settings');
        if (saved) {
            this.settings = { ...this.settings, ...JSON.parse(saved) };
        }
    }

    saveSettings() {
        localStorage.setItem('rss_settings', JSON.stringify(this.settings));
    }

    loadFeeds() {
        this.feeds = [];
        const availableCategories = Object.keys(FEED_CATEGORIES);
        let cats = this.settings.enabledCategories || [];
        if (cats.length === 0) cats = availableCategories;

        for (const category of availableCategories) {
            if (FEED_CATEGORIES[category]) {
                for (const feed of FEED_CATEGORIES[category]) {
                    this.feeds.push({ ...feed, category });
                }
            }
        }
    }

    bindEvents() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
        }
        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.performSearch());
        }

        document.getElementById('refreshBtn').addEventListener('click', () => this.loadAllColumns());
        document.getElementById('themeToggleBtn').addEventListener('click', () => this.toggleTheme());
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('addAccountBtn').addEventListener('click', () => this.openAddFeed());

        // Home button - switch to Column 1 on mobile
        const homeBtn = document.getElementById('homeBtn');
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                if (this.isMobile()) {
                    this.mobileActiveColumn = 1;
                    this.updateMobileView();
                    document.getElementById('sidebar').classList.remove('open');
                }
            });
        }

        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const sidebar = document.getElementById('sidebar');
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                sidebar.classList.toggle('open');
            });
            document.addEventListener('click', (e) => {
                if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== mobileMenuBtn && !mobileMenuBtn.contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            });
        }

        const mobileSearchBtn = document.getElementById('mobileSearchBtn');
        if (mobileSearchBtn) {
            mobileSearchBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelector('.search-container').classList.toggle('mobile-visible');
            });
        }
    }

    startAutoRefresh() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        const minutes = this.settings.refreshInterval || 10;
        if (minutes > 0) {
            this.refreshTimer = setInterval(() => this.loadAllColumns(), minutes * 60000);
        }
    }

    performSearch() {
        const query = document.getElementById('searchInput').value.trim();
        if (query) window.open(`https://xcancel.com/search?f=tweets&q=${encodeURIComponent(query)}`, '_blank');
    }

    renderSidebar() {
        const container = document.getElementById('accountsList');
        let html = '';

        const categories = Object.keys(FEED_CATEGORIES).sort((a, b) => {
            if (a === 'Twitter') return -1;
            if (b === 'Twitter') return 1;
            return a.localeCompare(b);
        });

        for (const category of categories) {
            const feedsInCategory = FEED_CATEGORIES[category];
            html += `
                <div class="category-group">
                    <div class="category-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'block' ? 'none' : 'block'">
                        <span class="category-name">▶ ${category}</span>
                        <span class="category-count">${feedsInCategory.length}</span>
                    </div>
                    <div class="category-feeds" style="display:none;">
            `;

            if (category === 'Twitter') {
                // Group by subcategory
                const subcats = {};
                feedsInCategory.forEach(f => {
                    const sub = f.subcategory || 'Other';
                    if (!subcats[sub]) subcats[sub] = [];
                    subcats[sub].push(f);
                });

                Object.keys(subcats).sort().forEach(sub => {
                    html += `
                        <div class="feed-item" onclick="app.loadColumnForSidebar('subcategory', 'Twitter', '${sub}')" style="padding-left: 20px; font-weight: bold; color: var(--text-primary);">
                             ${sub}
                        </div>
                        ${subcats[sub].map(feed => `
                            <div class="feed-item" onclick="app.loadColumnForSidebar('feed', '${feed.url}', '${feed.name}')" style="padding-left: 30px;">
                                <span class="feed-name">${feed.name}</span>
                            </div>
                        `).join('')}
                     `;
                });

            } else {
                html += `
                    <div class="feed-item" onclick="app.loadColumnForSidebar('category', '${category}')" style="font-style: italic; color: var(--accent);">
                        View All ${category}
                    </div>
                `;

                html += feedsInCategory.map(feed => `
                    <div class="feed-item" onclick="app.loadColumnForSidebar('feed', '${feed.url}', '${feed.name}')">
                        <span class="feed-name">${feed.name}</span>
                    </div>
                `).join('');
            }

            html += `</div></div>`;
        }
        container.innerHTML = html;
    }

    // Modals
    openAddFeed() { document.getElementById('addAccountModal').classList.add('active'); }
    closeAddFeed() { document.getElementById('addAccountModal').classList.remove('active'); }
    addFeed() { /* Keep existing logic usage */ }

    openSettings() { document.getElementById('settingsModal').classList.add('active'); }
    closeSettings() { document.getElementById('settingsModal').classList.remove('active'); }
    saveSettingsForm() { this.saveSettings(); this.closeSettings(); }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // Mobile helpers
    isMobile() {
        return window.innerWidth <= 768;
    }

    updateMobileView() {
        console.log(`[Mobile] isMobile: ${this.isMobile()}, window width: ${window.innerWidth}`);
        if (!this.isMobile()) return;

        console.log(`[Mobile] Switching to column ${this.mobileActiveColumn}`);

        // Remove mobile-active from all columns
        document.querySelectorAll('.column').forEach(col => {
            col.classList.remove('mobile-active');
        });

        // Add mobile-active to the current column
        const activeCol = document.getElementById(`col-${this.mobileActiveColumn}`);
        if (activeCol) {
            activeCol.classList.add('mobile-active');
            console.log(`[Mobile] Column ${this.mobileActiveColumn} activated, has ${activeCol.querySelectorAll('.article-card').length} articles`);
        } else {
            console.error(`[Mobile] Column ${this.mobileActiveColumn} not found!`);
        }
    }

    // --- Theme Management ---

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        this.updateThemeIcon();
    }

    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
        this.showToast(`${this.theme === 'dark' ? 'Dark' : 'Light'} mode enabled`, 'success');
    }

    updateThemeIcon() {
        const icon = this.theme === 'dark' ? '☀️' : '🌙';
        document.getElementById('themeToggleBtn').textContent = icon;
    }

    // --- Stats Dashboard ---

    getStats() {
        const articles = this.articles;

        if (articles.length === 0) {
            return { totalTweets: 0, oldestDate: null, newestDate: null, feedCount: 0, cacheSize: 0, avgTweetsPerDay: 0 };
        }

        const dates = articles.map(a => a.time.getTime());
        const oldest = new Date(Math.min(...dates));
        const newest = new Date(Math.max(...dates));
        const uniqueFeeds = new Set(articles.map(a => a.feedUrl)).size;
        const cacheSize = (JSON.stringify(articles).length / 1024).toFixed(2);
        const daySpan = Math.max(1, (newest - oldest) / (1000 * 60 * 60 * 24));
        const avgPerDay = (articles.length / daySpan).toFixed(1);

        return { totalTweets: articles.length, oldestDate: oldest, newestDate: newest, feedCount: uniqueFeeds, cacheSize, avgTweetsPerDay: avgPerDay };
    }

    showStats() {
        const stats = this.getStats();
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';
        modal.innerHTML = `<div style="background:var(--bg-card);border-radius:12px;padding:24px;max-width:500px;width:90%;"><h2 style="margin:0 0 20px;color:var(--text-primary);">📊 Cache Statistics</h2><div style="display:grid;gap:16px;"><div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg-element);border-radius:8px;"><span style="color:var(--text-secondary);">Total Tweets</span><strong style="color:var(--accent);">${stats.totalTweets}</strong></div><div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg-element);border-radius:8px;"><span style="color:var(--text-secondary);">Active Feeds</span><strong style="color:var(--accent);">${stats.feedCount}</strong></div><div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg-element);border-radius:8px;"><span style="color:var(--text-secondary);">Cache Size</span><strong style="color:var(--accent);">${stats.cacheSize} KB</strong></div><div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg-element);border-radius:8px;"><span style="color:var(--text-secondary);">Avg/Day</span><strong style="color:var(--accent);">${stats.avgTweetsPerDay} tweets</strong></div>${stats.oldestDate ? `<div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg-element);border-radius:8px;"><span style="color:var(--text-secondary);">Oldest</span><strong style="color:var(--text-primary);">${stats.oldestDate.toLocaleDateString()}</strong></div><div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg-element);border-radius:8px;"><span style="color:var(--text-secondary);">Newest</span><strong style="color:var(--text-primary);">${stats.newestDate.toLocaleDateString()}</strong></div>` : ''}</div><div style="display:flex;gap:12px;margin-top:24px;"><button onclick="app.clearCache()" style="flex:1;padding:12px;background:#e74c3c;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Clear Cache</button><button onclick="this.closest('div[style*=fixed]').remove()" style="flex:1;padding:12px;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Close</button></div></div>`;
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
    }

    clearCache() {
        if (!confirm('Clear all cached tweets? This cannot be undone.')) return;
        localStorage.removeItem('global_article_cache');
        localStorage.removeItem('feed_history');
        this.articles = [];
        this.feedHistory = {};
        alert('Cache cleared! Refreshing...');
        window.location.reload();
    }
}

fetch('feeds.json')
    .then(r => r.json())
    .then(data => {
        FEED_CATEGORIES = data;
        window.app = new FeedReader();
    })
    .catch(e => console.error(e));
// Add styles for quote tweets
const style = document.createElement('style');
style.textContent = `
    .article-content img {
        max-width: 100%;
        border-radius: 8px;
        margin-top: 5px;
    }
    .article-content div[style*="border"] {
        border: 1px solid var(--border) !important;
        background: var(--bg-secondary) !important;
    }
`;
document.head.appendChild(style);
