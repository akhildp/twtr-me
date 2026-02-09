import os
import sys
import json
import time
import datetime
import sqlite3
try:
    import psycopg2
except ImportError:
    psycopg2 = None
from urllib.parse import urlparse
import feedparser
import requests

# Configuration
DB_URL = os.environ.get('DATABASE_URL')
FEEDS_FILE = '../data/feeds.json'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
TIMEOUT = 15

# Determine DB type
IS_POSTGRES = bool(DB_URL)

def get_db_connection():
    if IS_POSTGRES:
        conn = psycopg2.connect(DB_URL)
    else:
        conn = sqlite3.connect('../data/tweets.db')
        conn.row_factory = sqlite3.Row
    return conn

def load_feeds():
    try:
        with open(FEEDS_FILE, 'r') as f:
            data = json.load(f)
            feeds = []
            for category, feed_list in data.items():
                for feed in feed_list:
                    feeds.append(feed)
            return feeds
    except Exception as e:
        print(f"Error loading feeds: {e}")
        return []

# Nitter instances to rotate through
NITTER_INSTANCES = [
    'https://nitter.poast.org',
    'https://nitter.privacy.com.de',
    'https://nitter.perennialte.ch',
    'https://nitter.rawbit.ninja',
    'https://nitter.soopy.moe',
    'https://nitter.dafrary.ch',
    'https://nitter.tinfoil-hat.net'
]

import subprocess

def is_twitter_url(url):
    url_lower = url.lower()
    return any(domain in url_lower for domain in ['twitter.com', 'x.com', 'nitter'])

def fetch_feed(feed_url):
    print(f"Processing {feed_url}...")
    
    # Check if it's a Twitter URL or a standard RSS feed
    if not is_twitter_url(feed_url):
        print(f"  Direct fetching RSS feed...")
        try:
            response = requests.get(feed_url, headers={'User-Agent': USER_AGENT}, timeout=TIMEOUT)
            if response.status_code == 200:
                return feedparser.parse(response.content)
            else:
                print(f"    Failed: {response.status_code}")
                return None
        except Exception as e:
            print(f"    Error: {str(e)}")
            return None

    # For Twitter URLs, use twitter_client.py (Twikit authenticated session)
    print(f"  Fetching using authenticated twitter_client.py...")
    try:
        # Get the absolute path to the virtualenv python
        venv_python = os.path.join(os.path.dirname(os.getcwd()), '.venv', 'bin', 'python')
        if not os.path.exists(venv_python):
            venv_python = 'python3' # Fallback
            
        process = subprocess.Popen(
            [venv_python, 'twitter_client.py', feed_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = process.communicate(timeout=60)
        
        if process.returncode == 0:
            if stdout.strip():
                return feedparser.parse(stdout)
            else:
                print(f"    Success code but empty output from twitter_client.py")
        else:
            print(f"    twitter_client.py failed (code {process.returncode}): {stderr[:200]}...")
            
    except subprocess.TimeoutExpired:
        print(f"    twitter_client.py timed out")
        process.kill()
    except Exception as e:
        print(f"    Error running twitter_client.py: {str(e)}")
            
    return None

def save_tweet(conn, feed, entry):
    cursor = conn.cursor()
    
    # Extract data
    tweet_id = entry.id if 'id' in entry else entry.link
    title = entry.title
    content = entry.description
    
    # Handle custom tags from twitter_client.py
    # Fallback to feed name if author_name is missing
    author = entry.get('author_name', entry.get('author', feed['name']))
    author_avatar = entry.get('author_avatar', None)
    
    link = entry.link
    published = datetime.datetime(*entry.published_parsed[:6]) if 'published_parsed' in entry else datetime.datetime.now()
    
    # Image extraction (basic)
    image_url = None
    if 'media_content' in entry:
        image_url = entry.media_content[0]['url']
        
    # Determine table
    feed_url = feed['url'].lower()
    table = 'tweets' if ('nitter' in feed_url or 'twitter.com' in feed_url or 'x.com' in feed_url) else 'rss'

    try:
        if IS_POSTGRES:
            sql = f"""
                INSERT INTO {table} (id, feed_url, feed_name, title, content, author, link, image_url, published_at, author_avatar)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """
            cursor.execute(sql, (tweet_id, feed['url'], feed['name'], title, content, author, link, image_url, published, author_avatar))
        else:
            sql = f"""
                INSERT OR IGNORE INTO {table} (id, feed_url, feed_name, title, content, author, link, image_url, published_at, author_avatar)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            cursor.execute(sql, (tweet_id, feed['url'], feed['name'], title, content, author, link, image_url, published, author_avatar))
            
        conn.commit()
    except Exception as e:
        print(f"Error saving to {table} (id: {tweet_id}): {e}")
        conn.rollback()
    finally:
        cursor.close()

def prune_old_tweets(conn):
    print("Pruning old tweets...")
    cursor = conn.cursor()
    cutoff = datetime.datetime.now() - datetime.timedelta(days=7)
    
    try:
        for table in ['tweets', 'rss']:
            if IS_POSTGRES:
                cursor.execute(f"DELETE FROM {table} WHERE published_at < %s", (cutoff,))
            else:
                cursor.execute(f"DELETE FROM {table} WHERE published_at < ?", (cutoff,))
            
            deleted = cursor.rowcount
            print(f"Deleted {deleted} old items from {table}.")
            
        conn.commit()
    except Exception as e:
        print(f"Error pruning: {e}")
        conn.rollback()
    finally:
        cursor.close()

def main():
    print(f"Starting fetch job at {datetime.datetime.now()}")
    conn = get_db_connection()
    feeds = load_feeds()
    
    for feed in feeds:
        parsed = fetch_feed(feed['url'])
        if parsed and parsed.entries:
            print(f"Found {len(parsed.entries)} entries for {feed['name']}")
            for entry in parsed.entries:
                save_tweet(conn, feed, entry)
        else:
            print(f"No entries found for {feed['name']}")
        
        # Polite delay
        time.sleep(1)
        
    prune_old_tweets(conn)
    conn.close()
    print("Job completed.")

if __name__ == "__main__":
    main()
