# Cache Implementation

## Overview
The GAMDL API now includes a robust caching system that prevents duplicate downloads and automatically manages storage.

## Features

### 1. **URL-Based Caching**
- When a download request is submitted, the system first checks if the URL has been downloaded before
- Cache keys are normalized (trimmed and lowercased) to ensure consistent matching
- If a cached result exists and files are still available, the response is returned immediately
- Cache entries are stored in Redis with automatic expiration

### 2. **3-Day Cache TTL**
- All cached downloads are kept for **3 days** (259,200 seconds)
- After 3 days, both the Redis cache entry and the downloaded files are automatically deleted
- TTL is configurable via the `CACHE_TTL_DAYS` constant

### 3. **Automatic File Cleanup**
- **On Startup**: Scans the downloads directory and removes any folders older than 3 days
- **After Download**: Schedules automatic deletion of files after the cache TTL expires
- **Cache Validation**: Before returning cached results, verifies that files still exist on disk

### 4. **Cache Invalidation**
- If a cache entry exists but files are missing, the cache is automatically invalidated
- The system will then proceed with a fresh download

## API Endpoints

### Submit Download (with Cache Check)
```bash
POST /api/download
```

**Request:**
```json
{
  "url": "https://music.apple.com/us/album/..."
}
```

**Response (Cache Hit):**
```json
{
  "success": true,
  "jobId": "abc-123",
  "message": "Retrieved from cache",
  "cached": true,
  "cachedAt": "2025-11-25T01:00:00.000Z",
  "result": {
    "success": true,
    "fileUrl": "http://localhost:3000/downloads/abc-123/song.m4a",
    "fileName": "song.m4a",
    "jobId": "abc-123"
  },
  "statusUrl": "/api/status/abc-123"
}
```

**Response (Cache Miss):**
```json
{
  "success": true,
  "jobId": "xyz-789",
  "message": "Download request queued",
  "cached": false,
  "statusUrl": "/api/status/xyz-789"
}
```

### Get Cache Statistics
```bash
GET /api/cache/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalCached": 5,
    "totalSizeBytes": 52428800,
    "totalSizeMB": "50.00",
    "cacheTTLDays": 3,
    "entries": [
      {
        "url": "https://music.apple.com/us/album/...",
        "fileName": "song.m4a",
        "fileSize": 10485760,
        "cachedAt": "2025-11-25T01:00:00.000Z",
        "ttlSeconds": 259200,
        "expiresAt": "2025-11-28T01:00:00.000Z"
      }
    ]
  }
}
```

## Implementation Details

### Cache Storage
- **Redis Keys**: `cache:url:<normalized-url>`
- **Value**: JSON object containing:
  - `success`: boolean
  - `fileUrl`: string
  - `fileName`: string
  - `jobId`: string
  - `cachedAt`: ISO timestamp

### File Storage
- Files are stored in: `downloads/<jobId>/<fileName>`
- Directory structure is preserved for organization
- Files are automatically deleted after cache expiration

### Cleanup Process
1. **Startup Cleanup**: Removes directories older than `CACHE_TTL_DAYS`
2. **Scheduled Deletion**: After successful download, schedules deletion using `setTimeout`
3. **Redis Expiration**: Redis automatically removes cache entries after TTL

## Benefits

1. **Faster Response Times**: Cached downloads return instantly
2. **Reduced Server Load**: No duplicate processing for the same URL
3. **Bandwidth Savings**: Avoid re-downloading the same content
4. **Automatic Storage Management**: No manual cleanup required
5. **Consistent User Experience**: Same URL always returns the same result (within cache period)

## Configuration

To change the cache TTL, modify the constant in `server.js`:

```javascript
const CACHE_TTL_DAYS = 3; // Change to desired number of days
```

## Monitoring

Use the cache stats endpoint to monitor:
- Number of cached URLs
- Total storage used
- Individual cache entries and their expiration times
- File sizes

## Notes

- Cache is persistent across server restarts (stored in Redis)
- File cleanup on startup ensures orphaned files are removed
- Cache validation prevents serving broken links
- Normalized URLs ensure consistent caching regardless of URL formatting
