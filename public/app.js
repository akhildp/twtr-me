// RSS Feed Reader App with Dashboard Layout

let FEED_CATEGORIES = {};

class FeedReader {
    constructor() {
        this.feeds = [];
        this.articles = []; // Loaded from API now

        this.settings = {
            refreshInterval: 10,
            enabledCategories: [] // Empty means all
        };

        // Dashboard Columns State
        // Fixed Layout: Col 1 = All (Mix), Col 2 = Tweets, Col 3 = Dynamic
        this.columns = [
            { id: 1, type: 'fixed', title: 'All Feeds', icon: '🌐', endpoint: '/api/mix' },
            { id: 2, type: 'fixed', title: 'Tweets', icon: '🐦', endpoint: '/api/tweets' },
            { id: 3, type: 'dynamic', title: 'News', icon: '📑', endpoint: '/api/rss' }
        ];

        this.refreshTimer = null;
        this.loadedCategories = new Set();
        this.configColumnId = null;
        this.mobileActiveColumn = 2; // Default to Tweets (Column 2) on mobile
        this.theme = localStorage.getItem('theme') || 'dark';

        // Cache settings
        this.CACHE_VERSION = 'v1';
        this.CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds
        this.CACHE_MAX_AGE_DAYS = 7; // Keep articles from last 7 days

        // Feed diversity tracking
        this.feedHistory = JSON.parse(localStorage.getItem('feed_history') || '{}');

        // Infinite Scroll State
        this.columnOffsets = { 1: 0, 2: 0, 3: 0 };
        this.isLoadingMore = { 1: false, 2: false, 3: false };
        this.PAGE_SIZE = 50;
        this.hasMore = { 1: true, 2: true, 3: true };

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

            // Initialize mobile view after a short delay
            setTimeout(() => this.updateMobileView(), 100);
        }
    }

    // --- Loading Columns ---

    async loadAllColumns(isBackground = false) {
        this.loadColumn(1, false, isBackground);
        setTimeout(() => this.loadColumn(2, false, isBackground), 500);
        setTimeout(() => this.loadColumn(3, false, isBackground), 1000);
    }

    // --- Feed Diversity Algorithm --- (Preserved but mostly unused now)

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

    weightedShuffle(articles, colId = null) {
        if (!articles || articles.length === 0) return [];

        const now = Date.now();
        const perSourceCounter = {};

        // 1. First Pass: Prepare basic data
        const preScored = articles.map(art => {
            const pubDate = new Date(art.published_at || art.publishedAt).getTime();
            const ageHours = (now - pubDate) / (1000 * 60 * 60);
            const feedUrl = art.feed_url || art.feedUrl;
            const historicalWeight = this.calculateFeedWeight(feedUrl);

            return { ...art, _feedUrl: feedUrl, _ageHours: ageHours, _historicalWeight: historicalWeight };
        });

        // Sort by age initially to process in chronological order
        preScored.sort((a, b) => a._ageHours - b._ageHours);

        // 2. Second Pass: Apply dynamic Clustering Penalty and Diversity Boost
        const finalScored = preScored.map(art => {
            const source = art._feedUrl;
            perSourceCounter[source] = (perSourceCounter[source] || 0) + 1;

            // CLUSTERING PENALTY: 
            // Every repeated occurrence of the same source adds a heavy penalty (3 hours of phantom age)
            const clusterPenalty = Math.max(0, perSourceCounter[source] - 1) * 3;

            // DIVERSITY BOOST: Significant intensity for true 'Hyper-Mixed' look
            const diversityBoost = art._historicalWeight * 2.5;

            // RANDOMIZED JITTER: ±1.5 hours to break strict chronological blocks
            const jitter = (Math.random() * 3) - 1.5;

            // RSS PRIORITY BOOST: For Column 1 (Mix), prioritize RSS items significantly
            const isTwitter = art.source_table === 'tweets' || art.feed_url?.includes('x.com') || art.feed_url?.includes('twitter');
            const rssBoost = (colId === 1 && !isTwitter) ? 12 : 0; // 12 hours of "freshness" boost for RSS in Mix

            return {
                ...art,
                _finalScore: art._ageHours + clusterPenalty - diversityBoost + jitter - rssBoost
            };
        });

        // 3. Final Sort by the diversity score
        finalScored.sort((a, b) => a._finalScore - b._finalScore);

        // 4. Update history for the top 12 items shown
        finalScored.slice(0, 12).forEach(art => this.updateFeedHistory(art._feedUrl));

        return finalScored;
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

    async loadColumn(colId, append = false, isBackground = false) {
        const col = this.columns.find(c => c.id === colId);
        if (!col) return;

        if (!append) {
            this.columnOffsets[colId] = 0;
            this.hasMore[colId] = true;
        }

        if (this.isLoadingMore[colId]) return;
        this.isLoadingMore[colId] = true;

        const container = document.getElementById(`col-${colId}-content`);
        const headerTitle = document.querySelector(`#col-${colId} .column-title`);

        if (!append && headerTitle) {
            headerTitle.innerHTML = `<span class="column-icon">${col.icon}</span> ${col.title}`;
        }

        // Only show full loading spinner if NOT a background refresh and NOT appending
        if (!append && !isBackground && container) {
            container.innerHTML = `
                <div class="feed-loading">
                    <div class="spinner"></div>
                    <p>Loading...</p>
                </div>`;
        } else if (append && container) {
            this.showLoadingMore(colId);
        }

        const apiUrl = CONFIG.apiUrl;
        const offset = this.columnOffsets[colId];
        console.log(`[Col ${colId}] Fetching page ${offset / this.PAGE_SIZE} from ${col.endpoint}...`);

        try {
            let url = col.endpoint;
            if (url.startsWith('/api')) {
                url = url.replace('/api', apiUrl);
            }

            // Add pagination params
            const sep = url.includes('?') ? '&' : '?';
            const fetchUrl = `${url}${sep}limit=${this.PAGE_SIZE}&offset=${offset}`;

            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} URL: ${fetchUrl}`);

            const data = await response.json();
            const articles = data.items || data;
            const refreshing = data.refreshing || false;

            this.hideLoadingMore(colId);

            if (!articles || articles.length === 0) {
                this.hasMore[colId] = false;
                if (!append && container) container.innerHTML = `<div class="feed-empty"><p>No articles found.</p></div>`;
                this.isLoadingMore[colId] = false;
                return;
            }

            // Apply weighted shuffling for col 1 (Mix) and col 2 (Tweets)
            let processedArticles = articles;
            if (colId === 1 || colId === 2 || col.shuffle) {
                processedArticles = this.weightedShuffle(articles, colId);
            }

            // Render articles
            if (append) {
                this.appendArticles(colId, processedArticles);
            } else {
                // If background refresh and user is scrolled down, DON'T replace content
                // check scrollTop of reference (container usually doesn't scroll, parent does)
                const scrollParent = container.parentElement;
                // .column-content is usually the scrollable area in dashboard layout?
                // Actually container IS the content div. Check styles.css? 
                // Usually it's #col-X-content or the .column body. The ID is on the specific div.
                // Assuming container parent is the scrollable .column-body

                const currentScroll = scrollParent ? scrollParent.scrollTop : 0;

                if (isBackground && currentScroll > 100) {
                    console.log(`[Col ${colId}] Scrolled down (${currentScroll}px), skipping auto-refresh render.`);
                    // TODO: Show "New Posts" indicator in header
                    this.showNewContentIndicator(colId);
                } else {
                    this.renderArticles(colId, processedArticles);
                    this.setupScrollObserver(colId);
                    if (isBackground) {
                        console.log(`[Col ${colId}] Auto-refreshed (at top).`);
                    }
                }
            }

            this.columnOffsets[colId] += articles.length;
            this.isLoadingMore[colId] = false;

            // Show subtle refresh indicator if backend is still fetching (only on initial load)
            if (!append && refreshing) {
                this.showRefreshIndicator(colId);
                // Exponential backoff or just longer interval + limit retries
                // Store retry count on the instance or closure? 
                // Let's use a simpler approach: 15s interval, max 5 retries
                if (!this.refreshRetries) this.refreshRetries = {};
                this.refreshRetries[colId] = (this.refreshRetries[colId] || 0) + 1;

                if (this.refreshRetries[colId] <= 5) {
                    console.log(`[Col ${colId}] Backend refreshing... checking again in 15s (Attempt ${this.refreshRetries[colId]}/5)`);
                    setTimeout(() => this.loadColumn(colId), 15000);
                } else {
                    console.log(`[Col ${colId}] Refresh took too long, stopping poll.`);
                    this.hideRefreshIndicator(colId);
                    this.refreshRetries[colId] = 0; // Reset for next manual refresh
                }
            } else {
                this.hideRefreshIndicator(colId);
                if (this.refreshRetries) this.refreshRetries[colId] = 0;
            }

        } catch (e) {
            console.error(`Error loading column ${colId}:`, e);
            this.isLoadingMore[colId] = false;
            this.hideLoadingMore(colId);
            if (!append && container) container.innerHTML = `<div class="feed-error"><p>Error loading feed.</p></div>`;
        }
    }

    async loadMore(colId) {
        if (this.hasMore[colId] && !this.isLoadingMore[colId]) {
            console.log(`[Col ${colId}] Loading more content...`);
            await this.loadColumn(colId, true);
        }
    }

    setupScrollObserver(colId) {
        const container = document.getElementById(`col-${colId}-content`);
        if (!container) return;

        // Cleanup old observer if exists
        if (container._observer) container._observer.disconnect();

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                this.loadMore(colId);
            }
        }, { root: container.parentElement, threshold: 0.1, rootMargin: '400px' });

        // Add a sentinel element at the bottom
        let sentinel = container.querySelector('.scroll-sentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.className = 'scroll-sentinel';
            sentinel.style.height = '1px';
            container.appendChild(sentinel);
        }
        observer.observe(sentinel);
        container._observer = observer;
    }

    showLoadingMore(colId) {
        const container = document.getElementById(`col-${colId}-content`);
        if (!container) return;
        let loader = container.querySelector('.loading-more');
        if (!loader) {
            loader = document.createElement('div');
            loader.className = 'loading-more';
            loader.innerHTML = `<div class="spinner-small"></div> Loading more articles...`;
            container.appendChild(loader);
        }
    }

    hideLoadingMore(colId) {
        const container = document.getElementById(`col-${colId}-content`);
        if (!container) return;
        const loader = container.querySelector('.loading-more');
        if (loader) loader.remove();

        // Re-append sentinel to be at the very bottom
        const sentinel = container.querySelector('.scroll-sentinel');
        if (sentinel) container.appendChild(sentinel);
    }

    showRefreshIndicator(colId) {
        const header = document.querySelector(`#col-${colId} .column-header`);
        if (!header) return;

        let indicator = header.querySelector('.refresh-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'refresh-indicator';
            indicator.innerHTML = `<div class="spinner-small"></div> Checking for new posts...`;
            header.after(indicator);
        }
    }

    hideRefreshIndicator(colId) {
        const header = document.querySelector(`#col-${colId} .column-header`);
        if (!header) return;
        const indicator = header.parentElement.querySelector('.refresh-indicator');
        if (indicator) indicator.remove();
    }

    showNewContentIndicator(colId) {
        const header = document.querySelector(`#col-${colId} .column-header`);
        if (!header) return;

        // Remove existing if any
        let existing = header.parentElement.querySelector('.new-content-indicator');
        if (existing) return;

        const indicator = document.createElement('div');
        indicator.className = 'new-content-indicator';
        indicator.innerHTML = `✨ New posts available - Click to refresh`;
        indicator.style.cssText = 'background:var(--accent); color:white; padding:8px; text-align:center; cursor:pointer; font-size:13px; font-weight:bold;';
        indicator.onclick = () => {
            this.loadColumn(colId); // Manual refresh (wipes content, reset scroll)
            indicator.remove();
        };
        header.after(indicator);
    }

    // --- Sidebar Interaction ---

    // Update Dynamic Column (3)
    updateColumn3(title, endpoint) {
        const colIndex = 2; // Index 2 is Column 3 (0-based in array)
        if (colIndex !== -1) {
            this.columns[colIndex].title = title;
            this.columns[colIndex].endpoint = endpoint;
            this.loadColumn(3);

            // On mobile, switch to view this column
            if (this.isMobile()) {
                this.mobileActiveColumn = 3;
                this.updateMobileView();
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.remove('open');
            }
        }
    }

    // --- Rendering ---

    renderArticles(colId, colArticles) {
        const container = document.getElementById(`col-${colId}-content`);
        if (!container) return;

        if (colArticles.length === 0) {
            container.innerHTML = `
                <div class="feed-empty">
                    <div class="empty-icon">📭</div>
                    <h3>No articles</h3>
                    <p>Try refreshing or checking settings.</p>
                </div>`;
            return;
        }

        container.innerHTML = this.generateArticlesHtml(colId, colArticles);
    }

    appendArticles(colId, colArticles) {
        const container = document.getElementById(`col-${colId}-content`);
        if (!container) return;

        const html = this.generateArticlesHtml(colId, colArticles, container.querySelectorAll('.article-card').length);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        while (tempDiv.firstChild) {
            container.insertBefore(tempDiv.firstChild, container.querySelector('.loading-more') || container.querySelector('.scroll-sentinel'));
        }
    }

    generateArticlesHtml(colId, colArticles, startIndex = 0) {
        return colArticles.map((article, index) => {
            const contentId = `col-${colId}-article-${startIndex + index}`;

            // Create temp div to get text-only length (exclude HTML tags)
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = article.content || ''; // Handle null content
            const textContent = tempDiv.textContent || tempDiv.innerText || '';
            // Check length OR if it has many line breaks (which take up vertical space)
            const lineBreaks = (article.content || '').split('<br>').length + (article.content || '').split('\n').length;
            const isLong = textContent.length > 180 || lineBreaks > 4;

            // API returns snake_case keys: feed_url, image_url, published_at
            // Handle both snake_case (API) and camelCase (Legacy/Client-side) just in case
            const feedUrl = article.feed_url || article.feedUrl || '';
            const imageUrl = article.image_url || article.imageUrl;
            const publishedAt = article.published_at || article.time;
            const feedName = article.feed_name || article.feedName || 'Unknown Feed';
            const title = article.title || '';
            const link = article.link || '#';
            const author = article.author || '';
            const authorAvatar = article.author_avatar || article.authorAvatar;

            const isTwitter = (article.category === 'Twitter Lists') ||
                (feedUrl && (feedUrl.includes('twitter.com') || feedUrl.includes('x.com') || feedUrl.includes('nitter')));

            // Display Logic
            // Source (Top): Display Name (Yann LeCun) for Twitter, Feed Name for others
            const displaySource = isTwitter ? (author || title) : feedName;

            // Avatar: Real Avatar for Twitter, Letter for others
            const avatarHtml = (isTwitter && authorAvatar)
                ? `<img src="${authorAvatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`
                : (displaySource ? displaySource[0].toUpperCase() : '?');

            // Meta (Bottom): @handle · List Name · Time
            let displayMeta = '';
            let isRT = false;
            if (isTwitter) {
                // Check if content has RT indicators
                isRT = (article.content || '').includes('class="rt-header"') || (article.content || '').match(/^RT\s+@\w+:/i);
                displayMeta = `${title} · ${feedName}`;
            } else {
                displayMeta = article.subcategory ? `${article.category} · ${article.subcategory}` : (article.category || feedName);
            }

            const rtBadgeHtml = isRT ? `<span class="rt-status" style="color: var(--text-muted); font-size: 13px; font-weight: normal; margin-left: 8px; display: inline-flex; align-items: center; gap: 4px; vertical-align: middle;">🔁 Retweeted</span>` : '';

            return `
            <article class="article-card" onclick="window.open('${link}', '_blank')">
                <div class="article-header">
                    <div class="article-avatar" style="${isTwitter && authorAvatar ? 'background:none;' : ''}">${avatarHtml}</div>
                    <div class="article-meta">
                        <div class="article-source">${displaySource}${rtBadgeHtml}</div>
                        <div class="article-time" title="${new Date(publishedAt).toLocaleString()}">${displayMeta} · ${this.formatTime(publishedAt)}</div>
                    </div>
                </div>
                
                ${!isTwitter && title ? `<div class="article-title">${title}</div>` : ''}
                
                ${imageUrl ? `
                    <div class="article-media">
                        <img src="${imageUrl}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
                    </div>
                ` : ''}


                <div id="${contentId}" class="article-content ${isLong ? 'truncated' : ''}">${this.parseTwitterContent(article.content, imageUrl)}</div>
                
                <div class="article-actions">
                    <div class="article-stats">
                        ${isTwitter && article.favorite_count ? `<span class="stat-item" title="Likes">❤️ ${article.favorite_count}</span>` : ''}
                        ${isTwitter && article.retweet_count ? `<span class="stat-item" title="Retweets">🔁 ${article.retweet_count}</span>` : ''}
                    </div>
                    ${isLong ? `<button class="show-more-btn" onclick="event.stopPropagation(); app.toggleArticle('${contentId}', this)">Show more</button>` : '<div></div>'}
                    <button class="article-link" onclick="event.stopPropagation(); app.copyLink('${link}')" title="Copy link">🔗</button>
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

        Object.keys(FEED_CATEGORIES).filter(cat => !cat.startsWith('_')).forEach(cat => {
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
                this.columns[colIndex].endpoint = (val === 'Twitter' || val === 'Twitter Lists') ? `${CONFIG.apiUrl}/tweets` : `${CONFIG.apiUrl}/rss`;
            } else if (type === 'category') {
                this.columns[colIndex].title = val;
                this.columns[colIndex].icon = (val === 'Twitter Lists' || val === 'Twitter') ? '🐦' : '📂';
                this.columns[colIndex].endpoint = (val === 'Twitter' || val === 'Twitter Lists') ? `${CONFIG.apiUrl}/tweets` : `${CONFIG.apiUrl}/rss`;
            } else if (type === 'feed') {
                const feed = this.feeds.find(f => f.url === val);
                this.columns[colIndex].title = feed ? feed.name : 'Feed';
                this.columns[colIndex].icon = '🔗';
                this.columns[colIndex].endpoint = `${CONFIG.apiUrl}/content?feed_url=${encodeURIComponent(val)}`;
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
            this.columns[1] = {
                id: 2, type: 'category', value: 'Twitter', title: 'Twitter Feed', icon: '🐦',
                endpoint: `${CONFIG.apiUrl}/tweets`
            };
            this.saveColumnConfigLink();
        }

        // Migration 2: Column 2 default to Twitter List
        if (this.columns[1] && (this.columns[1].value === 'Twitter' || this.columns[1].value === 'News' || !this.columns[1].endpoint)) {
            this.columns[1] = {
                id: 2,
                type: 'category',
                value: 'Twitter Lists',
                title: 'Twitter Mix',
                icon: '🐦',
                shuffle: true,
                endpoint: `${CONFIG.apiUrl}/tweets`
            };
            this.saveColumnConfigLink();
        }

        // Migration 4: Ensure Column 3 defaults to News and has endpoint
        if (this.columns[2] && (!this.columns[2].endpoint || (this.columns[2].value !== 'News' && !localStorage.getItem('col3_fixed')))) {
            this.columns[2] = {
                id: 3, type: 'category', value: 'News', title: 'News', icon: '📑',
                endpoint: `${CONFIG.apiUrl}/rss`
            };
            this.saveColumnConfigLink();
            localStorage.setItem('col3_fixed', 'true');
        }

        // Migration 5: Ensure Col 1 has endpoint
        if (this.columns[0] && !this.columns[0].endpoint) {
            this.columns[0].endpoint = `${CONFIG.apiUrl}/mix`;
            this.saveColumnConfigLink();
        }
    }

    // --- Core Methods ---

    // --- Cache Management ---

    async fetchFeed(feed) {
        const apiUrl = CONFIG.apiUrl;
        const url = `${apiUrl}/tweets?feed_url=${encodeURIComponent(feed.url)}&limit=50`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`✗ ${feed.name}: API Error ${response.status}`);
                return false;
            }

            const tweets = await response.json();

            if (tweets.length === 0) return false;

            tweets.forEach(t => {
                // Map API response to internal article format
                const article = {
                    id: t.id,
                    title: t.title || 'Untitled',
                    content: t.content || '',
                    link: t.link,
                    time: new Date(t.published_at), // Convert string to Date
                    authorName: t.author,
                    feedName: t.feed_name || feed.name,
                    feedUrl: t.feed_url || feed.url,
                    imageUrl: t.image_url,
                    category: feed.category,
                    subcategory: feed.subcategory,
                    authorAvatar: t.author_avatar // Map from DB/API
                };

                // Deduplicate
                if (!this.articles.find(a => a.id === article.id)) {
                    this.articles.push(article);
                }
            });

            return true;
        } catch (error) {
            console.warn(`Error fetching ${feed.name}:`, error);
            return false;
        }
    }

    // --- Sidebar Interaction ---

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

        // Safely remove legacy "RT @username:" prefix without destroying HTML
        const treeWalker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
        let node;
        while (node = treeWalker.nextNode()) {
            if (node.nodeValue && node.nodeValue.trim().match(/^RT\s+@\w+:\s*/i)) {
                node.nodeValue = node.nodeValue.replace(/^RT\s+@\w+:\s*/i, '');
                break; // Only match the first one
            }
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

        // Remove duplicate images (already shown in article-media)
        if (mainImageUrl) {
            const allContentImages = Array.from(div.querySelectorAll('img'));
            allContentImages.forEach(img => {
                // Check if this image matches the main one (handling relative/absolute mismatches)
                const currentImgSrc = img.src || img.getAttribute('src');
                if (!currentImgSrc) return;

                // Compare filenames or paths if full URL match fails
                const isMatch = currentImgSrc === mainImageUrl ||
                    currentImgSrc.includes(mainImageUrl) ||
                    mainImageUrl.includes(currentImgSrc) ||
                    (currentImgSrc.split('/').pop() === mainImageUrl.split('/').pop() && mainImageUrl.split('/').pop().length > 5);

                if (isMatch) {
                    img.remove();
                }
            });
        }

        // Style all remaining images
        // Exclude images that are part of the RT header or Quoted Tweet structure
        // This handles both new tweets (with classes) and old tweets (without classes but inside structure)
        const allImages = div.querySelectorAll('img:not(.quoted-image):not(.rt-avatar):not(.qt-avatar)');
        allImages.forEach(img => {
            // explicit check for parent containers to be safe (selector :not has limits with ancestors)
            if (img.closest('.rt-header') || img.closest('.quoted-tweet')) {
                return;
            }

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
        if (!date) return '';

        let d;
        if (date instanceof Date) {
            d = date;
        } else {
            let dateStr = String(date);
            // Handle SQLite format "2026-02-08 21:47:38" -> force UTC
            if (dateStr.length === 19 && dateStr.includes(' ') && !dateStr.includes('T')) {
                dateStr = dateStr.replace(' ', 'T') + 'Z';
            }
            d = new Date(dateStr);
        }
        if (isNaN(d)) return '';

        const now = new Date();
        const diff = now - d;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;

        // Return short date for older items
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    loadSettings() {
        const saved = localStorage.getItem('rss_settings');
        if (saved) {
            this.settings = { ...this.settings, ...JSON.parse(saved) };
        }
    }

    async triggerManualRefresh() {
        this.showToast('Refreshing all feeds in background...', 'info');

        try {
            // Trigger background refresh on server
            fetch(`${CONFIG.apiUrl}/refresh/all`, { method: 'POST' })
                .catch(err => console.error('Refresh trigger failed:', err));

            // Reload columns to show loading state and poll for new data
            this.loadAllColumns();
        } catch (e) {
            console.error('Manual refresh error:', e);
        }
    }

    saveSettings() {
        localStorage.setItem('rss_settings', JSON.stringify(this.settings));
    }

    loadFeeds() {
        this.feeds = [];
        const availableCategories = Object.keys(FEED_CATEGORIES).filter(cat => !cat.startsWith('_'));
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

        document.getElementById('refreshBtn').addEventListener('click', () => this.triggerManualRefresh());
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
            this.refreshTimer = setInterval(() => this.loadAllColumns(true), minutes * 60000);
        }
    }

    performSearch() {
        const query = document.getElementById('searchInput').value.trim();
        if (query) window.open(`https://xcancel.com/search?f=tweets&q=${encodeURIComponent(query)}`, '_blank');
    }

    renderSidebar() {
        const sidebar = document.getElementById('accountsList');
        if (!sidebar) {
            console.error('Sidebar element #accountsList not found!');
            return;
        }
        console.log('Rendering sidebar with categories:', Object.keys(FEED_CATEGORIES));

        let html = '';

        Object.keys(FEED_CATEGORIES).filter(cat => !cat.startsWith('_')).forEach(category => {
            const feeds = FEED_CATEGORIES[category];
            const subcategories = [...new Set(feeds.map(f => f.subcategory).filter(Boolean))];

            html += `
                <div class="sidebar-section">
                    <div class="category-header collapsed" onclick="app.toggleCategory(this)">
                        <div class="category-name">
                            <span class="category-icon">📁</span>
                            ${category}
                        </div>
                        <span class="category-chevron">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </span>
                    </div>
                    <div class="sidebar-links">
            `;

            if (subcategories.length > 0) {
                subcategories.forEach(sub => {
                    const subFeeds = feeds.filter(f => f.subcategory === sub);

                    html += `<div class="sidebar-subheader">${sub}</div>`;

                    subFeeds.forEach(feed => {
                        html += `
                            <a href="#" class="sidebar-link" onclick="event.preventDefault(); app.updateColumn3('${feed.name}', '/api/content?feed_url=${encodeURIComponent(feed.url)}')">
                                ${feed.name}
                            </a>
                        `;
                    });
                });
            } else {
                feeds.forEach(feed => {
                    html += `
                        <a href="#" class="sidebar-link" onclick="event.preventDefault(); app.updateColumn3('${feed.name}', '/api/content?feed_url=${encodeURIComponent(feed.url)}')">
                            ${feed.name}
                        </a>
                    `;
                });
            }

            html += `
                    </div>
                </div>
            `;
        });

        sidebar.innerHTML = html;
    }

    toggleCategory(element) {
        element.classList.toggle('collapsed');
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
        const btn = document.getElementById('themeToggleBtn');
        if (btn) btn.textContent = icon;
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
    .then(r => {
        if (!r.ok) throw new Error(`Failed to load feeds.json: ${r.status} ${r.statusText}`);
        return r.json();
    })
    .then(data => {
        FEED_CATEGORIES = data;
        window.app = new FeedReader();
    })
    .catch(e => {
        console.error('Error initializing app:', e);
        document.body.innerHTML = `<div style="color:red; padding:20px;">Error loading configuration: ${e.message}</div>`;
    });
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
