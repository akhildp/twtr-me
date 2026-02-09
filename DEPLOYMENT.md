
# Deployment Guide (VPS)

This guide assumes you have a fresh Ubuntu/Debian VPS and are logged in as `root`.

## 1. Install Dependencies (as root)
```bash
# Update and install Git, Docker, and Docker Compose
apt update && apt install -y git docker.io docker-compose
```

## 2. Create a Deployment User
For security, run the application as a non-root user (e.g., `deployuser`).

```bash
# Create user
adduser deployuser

# Add to sudo and docker groups
usermod -aG sudo,docker deployuser

# Verify groups
groups deployuser
# Output should include: deployuser sudo docker
```

## 3. Switch to `deployuser`
```bash
su - deployuser
```

## 4. Setting Up the Application

### Clone the Repository
```bash
git clone https://github.com/akhildp/twtr-me.git
cd twtr-me
```

### Configure Credentials (CRITICAL)
You must manually add your `cookies.json` file because it is not in the git repository for security reasons.

**Option A: Create manually on server**
```bash
nano data/cookies.json
# Paste the content of your local data/cookies.json here
# Ctrl+O (Save), Enter, Ctrl+X (Exit)
```

**Option B: Upload from your local machine**
Run this command on your **LOCAL** computer (not the VPS):
```bash
scp data/cookies.json deployuser@YOUR_VPS_IP:~/twtr-me/data/
```

## 5. Deploy with Docker
```bash
# Build and start the container in detached mode
docker-compose up -d --build
```

## 6. Configure Firewall (Optional)
If your VPS uses UFW (Uncomplicated Firewall), you need to allow port 3000.

```bash
sudo ufw allow 3000/tcp
sudo ufw reload
```

## 7. Enable HTTPS (Optional)
To get the lock icon (SSL), follow these steps:

### 1. Point your Domain
Log in to your domain registrar and create an **A Record**:
-   **Host**: `@` (or a subdomain like `rss`)
-   **Value**: `74.208.174.161`

### 2. Configure Caddy
The repository includes a `Caddyfile`. If you are using a subdomain (like `rss.twtr.me`), edit it:
```bash
nano Caddyfile
# Change "twtr.me" to your subdomain
```

### 3. Open Web Ports
You must open ports 80 and 443 in your **IONOS Cloud Panel** and **UFW**:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

### 4. Redeploy
```bash
git pull origin main
docker-compose up -d --build
```
Caddy will automatically fetch certificates for your domain.

## 8. Verify Deployment
-   **Check status**: `docker ps`
-   **View logs**: `docker-compose logs -f caddy`
-   **Access App**: Open `https://twtr.me` in your browser.

## Maintenance

### Updating the App
To update the code and redeploy:
```bash
cd ~/twtr-me
git pull origin main
docker-compose up -d --build
```

### Troubleshooting
-   If fetching fails, check `data/cookies.json` format.
-   Cron logs are inside the container: `docker exec twtr-me cat /app/data/logs/cron.log`
