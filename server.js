const express = require('express');
const Queue = require('bull');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL_DAYS = 3;
const CACHE_TTL_SECONDS = CACHE_TTL_DAYS * 24 * 60 * 60; // 3 days in seconds

// Middleware
app.use(cors());
app.use(express.json());
app.use('/downloads', express.static('downloads'));

// Create Bull queue (using in-memory if Redis is not available)
const downloadQueue = new Queue('music-downloads', {
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
    },
    settings: {
        maxStalledCount: 1,
    }
});

// Create Redis client for caching
const Redis = require('ioredis');
const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
});

// Store job results in memory
const jobResults = new Map();

// Helper function to create cache key from URL
function getCacheKey(url) {
    // Normalize URL to ensure consistent caching
    return `cache:url:${url.trim().toLowerCase()}`;
}

// Helper function to schedule file deletion
function scheduleFileDeletion(jobId, delayMs) {
    setTimeout(async () => {
        try {
            const outputDir = path.join(__dirname, 'downloads', jobId);
            await fs.rm(outputDir, { recursive: true, force: true });
            console.log(`Deleted cached files for job ${jobId} after ${CACHE_TTL_DAYS} days`);
        } catch (error) {
            console.error(`Error deleting files for job ${jobId}:`, error.message);
        }
    }, delayMs);
}

// Helper function to check if cached files still exist
async function cacheFilesExist(jobId, fileName) {
    try {
        const filePath = path.join(__dirname, 'downloads', jobId, fileName);
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Queue concurrency - number of simultaneous downloads
const QUEUE_CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY || '5', 10);

// Process queue - multiple jobs concurrently
downloadQueue.process(QUEUE_CONCURRENCY, async (job) => {
    const { url, jobId } = job.data;

    console.log(`Processing job ${jobId} for URL: ${url}`);

    try {
        const outputDir = path.join(__dirname, 'downloads', jobId);
        await fs.mkdir(outputDir, { recursive: true });

        // Execute gamdl command
        const command = `gamdl "${url}" -o "${outputDir}" --cookies-path ./cookies.txt`;

        console.log(`Executing: ${command}`);

        const { stdout, stderr } = await execAsync(command, {
            timeout: 600000, // 10 minutes timeout
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });

        console.log('GAMDL Output:', stdout);
        if (stderr) console.error('GAMDL Errors:', stderr);

        // Find the downloaded m4a file
        const files = await findM4aFiles(outputDir);

        if (files.length === 0) {
            throw new Error('No M4A file found after download');
        }

        // Return the first m4a file found
        const fileName = files[0];
        const fileUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/downloads/${jobId}/${fileName}`;

        return {
            success: true,
            fileUrl,
            fileName,
            jobId
        };

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        throw error;
    }
});

// Recursive function to find m4a files
async function findM4aFiles(dir) {
    const files = await fs.readdir(dir, { withFileTypes: true });
    const m4aFiles = [];

    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            const subFiles = await findM4aFiles(fullPath);
            m4aFiles.push(...subFiles.map(f => path.join(file.name, f)));
        } else if (file.name.endsWith('.m4a')) {
            m4aFiles.push(file.name);
        }
    }

    return m4aFiles;
}

// Queue event listeners
downloadQueue.on('completed', async (job, result) => {
    console.log(`Job ${job.data.jobId} completed successfully`);
    jobResults.set(job.data.jobId, {
        status: 'completed',
        result
    });

    // Save to cache with 3-day TTL
    try {
        const cacheKey = getCacheKey(job.data.url);
        await redisClient.setex(
            cacheKey,
            CACHE_TTL_SECONDS,
            JSON.stringify({
                ...result,
                cachedAt: new Date().toISOString()
            })
        );
        console.log(`Cached result for URL: ${job.data.url}`);

        // Schedule file deletion after 3 days
        scheduleFileDeletion(job.data.jobId, CACHE_TTL_SECONDS * 1000);
    } catch (error) {
        console.error('Error caching result:', error.message);
    }

    // Clean up old results after 1 hour
    setTimeout(() => {
        jobResults.delete(job.data.jobId);
    }, 3600000);
});

downloadQueue.on('failed', (job, err) => {
    console.error(`Job ${job.data.jobId} failed:`, err.message);
    jobResults.set(job.data.jobId, {
        status: 'failed',
        error: err.message
    });

    // Clean up old results after 1 hour
    setTimeout(() => {
        jobResults.delete(job.data.jobId);
    }, 3600000);
});

// API Routes

// Submit download request
app.post('/api/download', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        // Validate URL
        if (!url.includes('music.apple.com')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Apple Music URL'
            });
        }

        // Check cache first
        const cacheKey = getCacheKey(url);
        const cachedResult = await redisClient.get(cacheKey);

        if (cachedResult) {
            const cached = JSON.parse(cachedResult);
            console.log(`Cache hit for URL: ${url}`);

            // Verify files still exist
            const filesExist = await cacheFilesExist(cached.jobId, cached.fileName);

            if (filesExist) {
                // Return cached result immediately
                return res.json({
                    success: true,
                    jobId: cached.jobId,
                    message: 'Retrieved from cache',
                    cached: true,
                    cachedAt: cached.cachedAt,
                    result: {
                        success: cached.success,
                        fileUrl: cached.fileUrl,
                        fileName: cached.fileName,
                        jobId: cached.jobId
                    },
                    statusUrl: `/api/status/${cached.jobId}`
                });
            } else {
                // Cache exists but files are gone, invalidate cache
                console.log(`Cache invalid (files missing) for URL: ${url}`);
                await redisClient.del(cacheKey);
            }
        }

        console.log(`Cache miss for URL: ${url}, queuing new download`);

        const jobId = uuidv4();

        // Add job to queue
        const job = await downloadQueue.add({
            url,
            jobId
        });

        res.json({
            success: true,
            jobId,
            message: 'Download request queued',
            cached: false,
            statusUrl: `/api/status/${jobId}`
        });

    } catch (error) {
        console.error('Error submitting download:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Check job status
app.get('/api/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;

        // Check if we have cached result
        if (jobResults.has(jobId)) {
            const result = jobResults.get(jobId);
            return res.json(result);
        }

        // Try to find the job in the queue
        const jobs = await downloadQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
        const job = jobs.find(j => j.data.jobId === jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }

        const state = await job.getState();

        let response = {
            status: state,
            jobId
        };

        if (state === 'completed') {
            response.result = job.returnvalue;
        } else if (state === 'failed') {
            response.error = job.failedReason;
        }

        res.json(response);

    } catch (error) {
        console.error('Error checking status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get queue stats
app.get('/api/queue/stats', async (req, res) => {
    try {
        const [waiting, active, completed, failed] = await Promise.all([
            downloadQueue.getWaitingCount(),
            downloadQueue.getActiveCount(),
            downloadQueue.getCompletedCount(),
            downloadQueue.getFailedCount()
        ]);

        res.json({
            success: true,
            stats: {
                waiting,
                active,
                completed,
                failed,
                total: waiting + active + completed + failed
            }
        });
    } catch (error) {
        console.error('Error getting queue stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get cache statistics
app.get('/api/cache/stats', async (req, res) => {
    try {
        // Get all cache keys
        const cacheKeys = await redisClient.keys('cache:url:*');
        const cacheEntries = [];
        let totalSize = 0;

        for (const key of cacheKeys) {
            const data = await redisClient.get(key);
            if (data) {
                const cached = JSON.parse(data);
                const ttl = await redisClient.ttl(key);

                // Get file size if it exists
                let fileSize = 0;
                try {
                    const filePath = path.join(__dirname, 'downloads', cached.jobId, cached.fileName);
                    const stats = await fs.stat(filePath);
                    fileSize = stats.size;
                    totalSize += fileSize;
                } catch {
                    // File doesn't exist
                }

                cacheEntries.push({
                    url: key.replace('cache:url:', ''),
                    fileName: cached.fileName,
                    fileSize,
                    cachedAt: cached.cachedAt,
                    ttlSeconds: ttl,
                    expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
                });
            }
        }

        res.json({
            success: true,
            stats: {
                totalCached: cacheKeys.length,
                totalSizeBytes: totalSize,
                totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
                cacheTTLDays: CACHE_TTL_DAYS,
                entries: cacheEntries
            }
        });
    } catch (error) {
        console.error('Error getting cache stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear queue and force kill running processes
app.post('/api/queue/clear', async (req, res) => {
    try {
        console.log('Clearing queue and killing active jobs...');

        // Get counts before clearing
        const [waiting, active, completed, failed] = await Promise.all([
            downloadQueue.getWaitingCount(),
            downloadQueue.getActiveCount(),
            downloadQueue.getCompletedCount(),
            downloadQueue.getFailedCount()
        ]);

        // Get all active jobs and try to kill their processes
        const activeJobs = await downloadQueue.getActive();
        for (const job of activeJobs) {
            try {
                // Try to kill any gamdl process that might be running
                await execAsync('pkill -9 -f gamdl').catch(() => {
                    // Ignore errors if no process found
                });
                console.log(`Killed process for job ${job.data.jobId}`);
            } catch (error) {
                console.error(`Error killing process for job ${job.data.jobId}:`, error.message);
            }
        }

        // Obliterate all jobs (waiting, active, completed, failed, delayed)
        await downloadQueue.obliterate({ force: true });

        // Clear the in-memory job results
        const cachedResultsCount = jobResults.size;
        jobResults.clear();

        console.log('Queue cleared successfully');

        res.json({
            success: true,
            message: 'Queue cleared and all processes killed',
            cleared: {
                waiting,
                active,
                completed,
                failed,
                cachedResults: cachedResultsCount,
                total: waiting + active + completed + failed
            }
        });

    } catch (error) {
        console.error('Error clearing queue:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Cleanup old cached files on startup
async function cleanupOldCaches() {
    try {
        const downloadsDir = path.join(__dirname, 'downloads');
        const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
        const now = Date.now();
        let cleaned = 0;

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const dirPath = path.join(downloadsDir, entry.name);
                const stats = await fs.stat(dirPath);
                const ageMs = now - stats.mtimeMs;
                const ageDays = ageMs / (1000 * 60 * 60 * 24);

                if (ageDays > CACHE_TTL_DAYS) {
                    await fs.rm(dirPath, { recursive: true, force: true });
                    console.log(`Cleaned up old cache directory: ${entry.name} (${ageDays.toFixed(1)} days old)`);
                    cleaned++;
                }
            }
        }

        if (cleaned > 0) {
            console.log(`✨ Cleaned up ${cleaned} old cache directories`);
        }
    } catch (error) {
        console.error('Error during cache cleanup:', error.message);
    }
}

// Start server
app.listen(PORT, async () => {
    console.log(`🚀 GAMDL API Server running on port ${PORT}`);
    console.log(`📥 Submit downloads: POST /api/download`);
    console.log(`📊 Check status: GET /api/status/:jobId`);
    console.log(`📈 Queue stats: GET /api/queue/stats`);
    console.log(`💾 Cache stats: GET /api/cache/stats`);
    console.log(`🗑️  Clear queue: POST /api/queue/clear`);
    console.log(`⏱️  Cache TTL: ${CACHE_TTL_DAYS} days`);
    console.log(`⚡ Queue concurrency: ${QUEUE_CONCURRENCY} workers`);

    // Run cleanup on startup
    await cleanupOldCaches();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server gracefully...');
    await downloadQueue.close();
    await redisClient.quit();
    process.exit(0);
});