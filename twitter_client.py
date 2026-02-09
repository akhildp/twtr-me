import asyncio
import sys
import json
import os
from twikit import Client
from datetime import datetime

# Initialize Client
client = Client('en-US')

def convert_to_rss(tweets, title, link, description):
    rss = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
    <title>{title}</title>
    <link>{link}</link>
    <description>{description}</description>
    <atom:link href="{link}" rel="self" type="application/rss+xml" />
"""
    sys.stderr.write(f"Processing {len(tweets)} tweets...\n")
    success_count = 0
    for idx, tweet in enumerate(tweets):
        try:
            # Twikit tweet object structure handling
            tw_id = tweet.id
            text = tweet.text
            created_at = tweet.created_at
            
            # Retweet handling (to prevent cropping)
            is_retweet = hasattr(tweet, 'retweeted_tweet') and tweet.retweeted_tweet
            rt_header_html = ""
            if is_retweet:
                rt = tweet.retweeted_tweet
                rt_name = rt.user.name.replace('&', '&amp;')
                rt_screen = rt.user.screen_name
                rt_avatar = rt.user.profile_image_url.replace('_normal', '_400x400')
                
                rt_header_html = f"""
                <div class="rt-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                    <img src="{rt_avatar}" class="rt-avatar" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;" />
                    <div style="font-size: 1em; line-height: 1.2;"><strong>{rt_name}</strong> <span style="color: #888;">@{rt_screen}</span></div>
                </div>
                """
                text = rt.text
                tweet_for_media = rt
            else:
                tweet_for_media = tweet

        # User Info (Safe Extraction)
            if tweet.user:
                display_name = tweet.user.name.replace('&', '&amp;')
                screen_name = tweet.user.screen_name
                avatar_url = tweet.user.profile_image_url.replace('_normal', '_400x400')
            else:
                display_name = "Unknown"
                screen_name = "unknown"
                avatar_url = ""
    
            # Media handling
            media_html = ""
            current_tweet_media = tweet_for_media.media if hasattr(tweet_for_media, 'media') else []
            if current_tweet_media:
                for m in current_tweet_media:
                    try:
                        if m.type == 'photo':
                            media_html += f'<br><img src="{m.media_url}" style="max-width: 100%; border-radius: 8px; margin-top: 5px;" />'
                        elif m.type == 'video':
                            media_html += f'<br>[Video: {m.media_url}]'
                    except Exception as e:
                        sys.stderr.write(f"Error processing media: {e}\n")
    
            # Quote Tweet handling
            quote_html = ""
            # Quote tweets can be on the original tweet or the RT
            quote_source = tweet_for_media
            if hasattr(quote_source, 'quote') and quote_source.quote:
                try:
                    q = quote_source.quote
                    q_text = q.text
                    
                    # Safe quote user extraction
                    if q.user:
                        q_name = q.user.name.replace('&', '&amp;')
                        q_screen = q.user.screen_name
                        q_avatar = q.user.profile_image_url.replace('_normal', '_400x400')
                    else:
                        q_name = "Unknown"
                        q_screen = "unknown"
                        q_avatar = ""
                    
                    # Quote Media
                    q_media_html = ""
                    if q.media:
                        for m in q.media:
                            if m.type == 'photo':
                                q_media_html += f'<br><img src="{m.media_url}" style="max-width: 100%; border-radius: 8px; margin-top: 5px;" />'
    
                    quote_html = f"""
                    <div class="quoted-tweet" style="border: none; border-radius: 0; padding: 0 0 0 12px; margin-top: 12px; background: none; border-left: 2px solid #333;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                            <img src="{q_avatar}" class="qt-avatar" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;" />
                            <div style="font-size: 0.95em; line-height: 1.2;"><strong>{q_name}</strong> <span style="color: #888;">@{q_screen}</span></div>
                        </div>
                        <div style="font-size: 0.95em;">{q_text}</div>
                        {q_media_html}
                    </div>
                    """
                except Exception as e:
                    sys.stderr.write(f"Error parsing quote: {e}\n")
    
            favorite_count = getattr(tweet, 'favorite_count', 0)
            retweet_count = getattr(tweet, 'retweet_count', 0)

            full_desc = f"{rt_header_html}{text}{media_html}{quote_html}"
            
            rss += f"""    <item>
        <title>@{screen_name}</title>
        <author_name>{display_name}</author_name>
        <author_avatar>{avatar_url}</author_avatar>
        <link>https://xcancel.com/{screen_name}/status/{tw_id}</link>
        <favorite_count>{favorite_count}</favorite_count>
        <retweet_count>{retweet_count}</retweet_count>
        <description><![CDATA[{full_desc.replace('\n', '<br>')}]]></description>
        <guid>https://xcancel.com/{screen_name}/status/{tw_id}</guid>
        <pubDate>{created_at}</pubDate>
    </item>
"""
            success_count += 1
        except Exception as e:
            import traceback
            sys.stderr.write(f"Error processing tweet #{idx}: {e}\n")
            traceback.print_exc(file=sys.stderr)
    
    sys.stderr.write(f"Successfully processed {success_count}/{len(tweets)} tweets\n")
    rss += "</channel>\n</rss>"
    return rss

async def main():
    if len(sys.argv) < 2:
        print("Usage: python twitter_client.py <url>")
        return

    target_url = sys.argv[1]
    
    # Load Cookies
    # Load Cookies
    cookies = None
    if os.path.exists('cookies.json'):
        try:
            client.load_cookies('cookies.json')
            # print("Loaded cookies from file")
        except Exception as e:
            print(f"Error loading cookies from file: {e}")
            sys.exit(1)
    elif os.environ.get('COOKIES_JSON'):
        try:
            import json
            cookies_json = os.environ.get('COOKIES_JSON')
            # Determine if it's a file path or partial JSON content
            # If it starts with [, it's likely the JSON string itself
            # But client.load_cookies expects a file path.
            # We might need to write it to a temp file or see if twikit supports direct dict loading.
            # Looking at twikit source/docs (hypothetically), client.set_cookies(cookies_dict) might exist?
            # Or client.load_cookies() only takes a path.
            # If load_cookies only takes path, we'll write to a temp file.
            
            # Let's assume for now we write to a temp file to be safe and compatible with load_cookies
            import tempfile
            with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as tmp:
                tmp.write(cookies_json)
                tmp_path = tmp.name
            
            client.load_cookies(tmp_path)
            os.unlink(tmp_path) # Clean up
            # print("Loaded cookies from environment variable")
        except Exception as e:
            print(f"Error loading cookies from env: {e}")
            sys.exit(1)
    else:
        print("Error: cookies.json not found and COOKIES_JSON env var not set")
        sys.exit(1)

    import random
    import time
    
    # Add jitter to avoid hammering the API
    time.sleep(random.uniform(0.5, 2.0))

    try:
        # Determine mode (User Timeline vs Search)
        # URL examples: 
        # https://xcancel.com/username/rss
        # https://twitter.com/username
        # https://xcancel.com/search?q=...
        
        url_lower = target_url.lower()
        if 'search' in url_lower and ('q=' in url_lower or 'query=' in url_lower):
            # Query Search
            # Extract query
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(target_url)
            qs = parse_qs(parsed.query)
            query = qs.get('q', [None])[0]
            if not query:
                query = qs.get('f', [None])[0] # xcancel might use f=tweets&q=...
            
            if not query:
                # If path is /search/something
                parts = parsed.path.split('/')
                if len(parts) > 2 and parts[1] == 'search':
                   query = parts[2]

            tweets = await client.search_tweet(query, product='Top')
            print(convert_to_rss(tweets, f"Search: {query}", target_url, f"Twitter Search for {query}"))

        else:
            # Check for List URL
            # https://xcancel.com/i/lists/123456789
            # https://twitter.com/i/lists/123456789
            if '/lists/' in target_url:
                try:
                    # Extract List ID
                    # .../lists/12345...
                    list_id = target_url.split('/lists/')[1].split('/')[0].split('?')[0]
                    
                    list_obj = await client.get_list(list_id)
                    tweets = await client.get_list_tweets(list_id, count=50)
                    print(convert_to_rss(tweets, f"List: {list_obj.name}", target_url, f"Twitter List: {list_obj.name}"))
                except Exception as e:
                     sys.stderr.write(f"Error fetching list {target_url}: {e}\n")
                     sys.exit(1)

            else:
                # User Timeline
                # Extract username
                # https://xcancel.com/username -> username
                # https://xcancel.com/username/rss -> username
                
                path_parts = target_url.replace('https://', '').replace('http://', '').split('/')
                # path_parts[0] is domain
                
                # Handle potential trailing slashes or query params
                username_part = path_parts[1]
                if '?' in username_part:
                    username_part = username_part.split('?')[0]
                
                username = username_part
                if username == 'rss': # unlikely but check
                     pass
                
                user = await client.get_user_by_screen_name(username)
                tweets = await user.get_tweets('Tweets', count=20)
                print(convert_to_rss(tweets, f"{user.name} (@{user.screen_name})", target_url, user.description))

    except Exception as e:
        if '429' in str(e) or 'TooManyRequests' in str(e):
             sys.stderr.write(f"Rate Limit Exceeded for {target_url}\n")
        else:
             sys.stderr.write(f"Error fetching tweets for {target_url}: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.set_event_loop_policy(asyncio.DefaultEventLoopPolicy())
    asyncio.run(main())
