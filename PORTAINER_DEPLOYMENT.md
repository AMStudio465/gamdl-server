# Deploying GAMDL API on Portainer

This guide walks you through deploying the GAMDL Music Downloader API on Portainer.

## Prerequisites

1. **Portainer installed and running** on your server
2. **Docker environment** connected to Portainer
3. **Apple Music cookies.txt file** exported from your browser
4. Access to Portainer web interface

## Deployment Methods

There are two main ways to deploy on Portainer:

### Method 1: Using Docker Compose (Recommended)

This is the easiest method and uses your existing `docker-compose.yml` file.

#### Step 1: Access Portainer

1. Log in to your Portainer web interface
2. Select your Docker environment (e.g., "local" or your remote Docker host)

#### Step 2: Create a Stack

1. Navigate to **Stacks** in the left sidebar
2. Click **+ Add stack**
3. Enter a name for your stack (e.g., `gamdl-api`)

#### Step 3: Configure the Stack

**Option A: Upload docker-compose.yml**

1. Select **Upload** tab
2. Click **Upload file** and select your `docker-compose.yml`
3. Scroll down to continue with Step 4

**Option B: Web Editor**

1. Select **Web editor** tab
2. Copy and paste your `docker-compose.yml` content:

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: gamdl-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  api:
    build: .
    container_name: gamdl-api
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - BASE_URL=http://localhost:3000
    volumes:
      - ./cookies.txt:/app/cookies.txt:ro
      - ./downloads:/app/downloads
    depends_on:
      - redis
    restart: unless-stopped

volumes:
  redis-data:
```

#### Step 4: Handle the Build Issue

⚠️ **Important**: Portainer Stacks cannot build images directly from a Dockerfile. You need to either:

**Option A: Build and Push to Registry (Recommended for Production)**

1. Build the image locally:
   ```bash
   docker build -t your-registry/gamdl-api:latest .
   ```

2. Push to a registry (Docker Hub, GitHub Container Registry, or private registry):
   ```bash
   docker push your-registry/gamdl-api:latest
   ```

3. Update the `docker-compose.yml` in Portainer to use the image:
   ```yaml
   api:
     image: your-registry/gamdl-api:latest  # Changed from 'build: .'
     container_name: gamdl-api
     # ... rest of the config
   ```

**Option B: Build Locally and Use Local Image**

1. Build the image on your Portainer host:
   ```bash
   docker build -t gamdl-api:latest .
   ```

2. Update the `docker-compose.yml` in Portainer:
   ```yaml
   api:
     image: gamdl-api:latest  # Changed from 'build: .'
     container_name: gamdl-api
     # ... rest of the config
   ```

#### Step 5: Configure Environment Variables (Optional)

In the **Environment variables** section, you can override any variables:

- `BASE_URL`: Change to your server's public URL (e.g., `http://your-server-ip:3000`)
- `PORT`: Change if you want to use a different port
- `QUEUE_CONCURRENCY`: Adjust concurrent downloads (default: 5)

#### Step 6: Handle the cookies.txt File

Since the stack references `./cookies.txt`, you need to handle this file:

**Option A: Use Portainer Volumes**

1. Before deploying, create a volume in Portainer:
   - Go to **Volumes** → **+ Add volume**
   - Name it `gamdl-cookies`

2. Upload your `cookies.txt` to the volume:
   - Click on the volume → **Browse**
   - Upload your `cookies.txt` file

3. Update the stack to use the volume:
   ```yaml
   api:
     # ...
     volumes:
       - gamdl-cookies:/app/cookies:ro  # Changed
       - gamdl-downloads:/app/downloads
   
   volumes:
     redis-data:
     gamdl-cookies:
       external: true
     gamdl-downloads:
   ```

**Option B: Use Bind Mount (If deploying on local server)**

1. SSH into your Portainer host
2. Create a directory and place `cookies.txt`:
   ```bash
   mkdir -p /opt/gamdl
   # Upload your cookies.txt to /opt/gamdl/cookies.txt
   ```

3. Update the stack:
   ```yaml
   api:
     # ...
     volumes:
       - /opt/gamdl/cookies.txt:/app/cookies.txt:ro
       - /opt/gamdl/downloads:/app/downloads
   ```

#### Step 7: Deploy the Stack

1. Click **Deploy the stack**
2. Wait for Portainer to pull images and start containers
3. Monitor the deployment in the **Containers** section

#### Step 8: Verify Deployment

1. Go to **Containers** and check both containers are running:
   - `gamdl-redis` (green/running)
   - `gamdl-api` (green/running)

2. Check logs by clicking on `gamdl-api` → **Logs**

3. Test the API:
   ```bash
   curl http://your-server-ip:3000/health
   ```

---

### Method 2: Deploy Individual Containers

If you prefer not to use stacks, you can deploy containers individually.

#### Step 1: Create Redis Container

1. Go to **Containers** → **+ Add container**
2. Configure:
   - **Name**: `gamdl-redis`
   - **Image**: `redis:7-alpine`
   - **Port mapping**: `6379:6379`
   - **Volumes**: Create volume `redis-data` → `/data`
   - **Restart policy**: Unless stopped

3. Click **Deploy the container**

#### Step 2: Build/Pull API Image

Follow **Option A** or **Option B** from Method 1, Step 4 to get your image ready.

#### Step 3: Create API Container

1. Go to **Containers** → **+ Add container**
2. Configure:
   - **Name**: `gamdl-api`
   - **Image**: `your-registry/gamdl-api:latest` (or `gamdl-api:latest`)
   - **Port mapping**: `3000:3000`
   - **Environment variables**:
     - `PORT=3000`
     - `REDIS_HOST=gamdl-redis`
     - `REDIS_PORT=6379`
     - `BASE_URL=http://your-server-ip:3000`
   - **Volumes**:
     - `/opt/gamdl/cookies.txt` → `/app/cookies.txt` (read-only)
     - `/opt/gamdl/downloads` → `/app/downloads`
   - **Network**: Same network as Redis
   - **Restart policy**: Unless stopped

3. Click **Deploy the container**

---

## Post-Deployment Configuration

### Update BASE_URL for Production

If deploying on a server with a domain name:

1. Edit your stack
2. Update the `BASE_URL` environment variable:
   ```yaml
   environment:
     - BASE_URL=https://your-domain.com
   ```
3. Click **Update the stack**

### Setup Reverse Proxy (Optional)

For HTTPS and custom domains, use a reverse proxy like Nginx or Traefik:

1. Deploy Nginx Proxy Manager via Portainer
2. Create a proxy host pointing to `gamdl-api:3000`
3. Enable SSL with Let's Encrypt

### Monitoring

Monitor your deployment in Portainer:

- **Container logs**: Click container → **Logs**
- **Stats**: View CPU/Memory usage in real-time
- **Console**: Access container shell for debugging

---

## Troubleshooting

### Container Won't Start

1. Check logs in Portainer
2. Verify `cookies.txt` is accessible
3. Ensure Redis container is running first

### Redis Connection Issues

1. Verify both containers are on the same network
2. Check `REDIS_HOST` environment variable matches Redis container name
3. Test connection: `docker exec gamdl-api ping gamdl-redis`

### File Download Issues

1. Verify `cookies.txt` is valid and not expired
2. Check volume mounts are correct
3. Ensure sufficient disk space for downloads

### Port Already in Use

If port 3000 is taken:

1. Edit stack and change port mapping:
   ```yaml
   ports:
     - "8080:3000"  # External:Internal
   ```
2. Update `BASE_URL` accordingly

---

## Updating the Application

### Update via Stack

1. Build new image with updated code
2. Push to registry (if using one)
3. Go to **Stacks** → Your stack → **Editor**
4. Click **Update the stack**
5. Enable **Re-pull image and redeploy**
6. Click **Update**

### Manual Update

1. SSH into server
2. Rebuild image:
   ```bash
   docker build -t gamdl-api:latest .
   ```
3. In Portainer, go to container → **Recreate**
4. Enable **Pull latest image**
5. Click **Recreate**

---

## Backup and Restore

### Backup

1. **Cookies file**: Keep a copy of `cookies.txt`
2. **Downloads**: Backup the downloads volume/directory
3. **Redis data**: 
   ```bash
   docker exec gamdl-redis redis-cli SAVE
   docker cp gamdl-redis:/data/dump.rdb ./backup/
   ```

### Restore

1. Restore `cookies.txt` to the appropriate location
2. Restore downloads directory
3. Restore Redis data:
   ```bash
   docker cp ./backup/dump.rdb gamdl-redis:/data/
   docker restart gamdl-redis
   ```

---

## Security Recommendations

1. **Don't expose Redis port** publicly - remove `6379:6379` from docker-compose if not needed
2. **Add authentication** - Consider adding API key authentication
3. **Use HTTPS** - Deploy behind a reverse proxy with SSL
4. **Limit access** - Use firewall rules to restrict access
5. **Rotate cookies** - Regularly update your `cookies.txt` file

---

## Additional Resources

- [Portainer Documentation](https://docs.portainer.io/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [GAMDL GitHub](https://github.com/glomatico/gamdl)
