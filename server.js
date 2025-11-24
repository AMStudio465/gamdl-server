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

// Store job results in memory
const jobResults = new Map();

// Process queue - one job at a time
downloadQueue.process(1, async (job) => {
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
downloadQueue.on('completed', (job, result) => {
    console.log(`Job ${job.data.jobId} completed successfully`);
    jobResults.set(job.data.jobId, {
        status: 'completed',
        result
    });

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

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 GAMDL API Server running on port ${PORT}`);
    console.log(`📥 Submit downloads: POST /api/download`);
    console.log(`📊 Check status: GET /api/status/:jobId`);
    console.log(`📈 Queue stats: GET /api/queue/stats`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server gracefully...');
    await downloadQueue.close();
    process.exit(0);
});