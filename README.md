# GAMDL Music Downloader API

A Docker-based Node.js Express API with queue system for downloading Apple Music tracks using [gamdl](https://github.com/glomatico/gamdl).

## Features

- ✅ Queue system (processes one download at a time)
- ✅ RESTful API with job status tracking
- ✅ Returns M4A file URL after download
- ✅ Redis-backed job queue
- ✅ Docker & Docker Compose setup

## Prerequisites

1. **Docker & Docker Compose** installed
2. **Apple Music Cookies** - Export your browser cookies in Netscape format while logged in with an active subscription:
   - **Firefox**: [Export Cookies](https://addons.mozilla.org/addon/export-cookies-txt)
   - **Chrome**: [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)

## Setup

1. **Clone/Create the project directory**

```bash
mkdir gamdl-api && cd gamdl-api
```

2. **Create all the files** (Dockerfile, package.json, server.js, docker-compose.yml)

3. **Add your cookies file**

Place your exported `cookies.txt` file in the project root directory.

```bash
# Your directory should look like:
gamdl-api/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server.js
├── cookies.txt          # Your Apple Music cookies
└── downloads/           # Will be created automatically
```

4. **Build and run**

```bash
docker-compose up --build
```

The API will be available at `http://localhost:3000`

## API Endpoints

### 1. Submit Download Request

**POST** `/api/download`

**Request Body:**
```json
{
  "url": "https://music.apple.com/us/album/song-name/123456?i=789012"
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Download request queued",
  "statusUrl": "/api/status/550e8400-e29b-41d4-a716-446655440000"
}
```

### 2. Check Job Status

**GET** `/api/status/:jobId`

**Response (Processing):**
```json
{
  "status": "active",
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (Completed):**
```json
{
  "status": "completed",
  "result": {
    "success": true,
    "fileUrl": "http://localhost:3000/downloads/550e8400-e29b-41d4-a716-446655440000/Artist/Album/01 Song.m4a",
    "fileName": "Artist/Album/01 Song.m4a",
    "jobId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Response (Failed):**
```json
{
  "status": "failed",
  "error": "Error message here",
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 3. Queue Statistics

**GET** `/api/queue/stats`

**Response:**
```json
{
  "success": true,
  "stats": {
    "waiting": 2,
    "active": 1,
    "completed": 15,
    "failed": 0,
    "total": 18
  }
}
```

### 4. Health Check

**GET** `/health`

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2025-01-24T12:00:00.000Z"
}
```

## Usage Example

```bash
# Submit download
curl -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url": "https://music.apple.com/us/album/never-gonna-give-you-up/1624945511?i=1624945512"}'

# Response:
# {"success":true,"jobId":"abc-123","message":"Download request queued","statusUrl":"/api/status/abc-123"}

# Check status
curl http://localhost:3000/api/status/abc-123

# When completed, you'll get the M4A URL:
# {"status":"completed","result":{"fileUrl":"http://localhost:3000/downloads/abc-123/Rick Astley/Album/01 Never Gonna Give You Up.m4a"}}

# Download the file
curl -O http://localhost:3000/downloads/abc-123/Rick%20Astley/Album/01%20Never%20Gonna%20Give%20Up.m4a
```

## Environment Variables

You can customize these in `docker-compose.yml`:

- `PORT` - API port (default: 3000)
- `REDIS_HOST` - Redis hostname (default: redis)
- `REDIS_PORT` - Redis port (default: 6379)
- `BASE_URL` - Base URL for file downloads (default: http://localhost:3000)

## Queue System

- Uses **Bull** queue with Redis backend
- Processes **one download at a time** to avoid overloading
- Jobs are automatically cleaned up 1 hour after completion
- Failed jobs are retained for debugging

## Troubleshooting

### Cookies not working
- Make sure you're logged in to Apple Music with an active subscription
- Re-export cookies.txt and restart the container

### Downloads failing
- Check logs: `docker-compose logs -f api`
- Verify the URL is a valid Apple Music link
- Ensure FFmpeg is working (included in the Docker image)

### Redis connection issues
- Make sure Redis container is running: `docker ps`
- Check Redis logs: `docker-compose logs redis`

## Stopping the API

```bash
docker-compose down
```

To remove downloaded files:
```bash
docker-compose down -v
rm -rf downloads/*
```

## Notes

- Downloaded files are stored in `./downloads` directory
- Each job gets a unique directory based on its jobId
- Files are served statically at `/downloads/:jobId/*`
- Queue processes jobs sequentially to respect rate limits