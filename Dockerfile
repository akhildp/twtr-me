
# Use Node.js as the base since the main server is Node
FROM node:18-bullseye

# Install Python 3 and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    cron \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install --production

# Copy application code
COPY . .

# Setup Python Virtual Environment
RUN python3 -m venv .venv && \
    .venv/bin/pip install --no-cache-dir -r requirements.txt

# Create necessary directories
RUN mkdir -p data/logs

# Setup Cron
COPY docker-cron /etc/cron.d/twtr-cron
RUN chmod 0644 /etc/cron.d/twtr-cron && \
    crontab /etc/cron.d/twtr-cron && \
    touch /var/log/cron.log

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start command: Start Cron and Node Server
CMD service cron start && node server/index.js
