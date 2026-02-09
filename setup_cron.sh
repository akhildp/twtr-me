
#!/bin/bash

# Get absolute path to the workspace
WORKSPACE_DIR="/home/akhildp/workspace/twtr-me"
SERVER_DIR="$WORKSPACE_DIR/server"
VENV_PYTHON="$WORKSPACE_DIR/.venv/bin/python"
LOG_DIR="$WORKSPACE_DIR/data/logs"
LOG_FILE="$LOG_DIR/cron.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Cron entry
CRON_JOB="0 * * * * cd $SERVER_DIR && $VENV_PYTHON fetch_tweets_cron.py >> $LOG_FILE 2>&1"

# Check if cron job already exists
(crontab -l 2>/dev/null | grep -F "$SERVER_DIR") && echo "Cron job already exists." && exit 0

# Add cron job
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo "Cron job added successfully:"
echo "$CRON_JOB"
