const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { content, episodes } = require('./database');

const app = express();
const PORT = 3000;

// Ensure directories exist
const mediaDir = path.join(__dirname, 'media');
const videosDir = path.join(mediaDir, 'videos');
const thumbnailsDir = path.join(mediaDir, 'thumbnails');

[mediaDir, videosDir, thumbnailsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(mediaDir));

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = file.fieldname === 'thumbnail' ? thumbnailsDir : videosDir;
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB limit
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'video') {
            const videoTypes = /mp4|mkv|avi|mov|webm|m4v/;
            const ext = path.extname(file.originalname).toLowerCase().slice(1);
            cb(null, videoTypes.test(ext));
        } else if (file.fieldname === 'thumbnail') {
            const imageTypes = /jpg|jpeg|png|gif|webp/;
            const ext = path.extname(file.originalname).toLowerCase().slice(1);
            cb(null, imageTypes.test(ext));
        } else {
            cb(null, true);
        }
    }
});

// ============ API ROUTES ============

// Get all content
app.get('/api/content', (req, res) => {
    try {
        const allContent = content.getAll.all();
        res.json(allContent);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get content by type (movies or series)
app.get('/api/content/type/:type', (req, res) => {
    try {
        const items = content.getByType.all(req.params.type);
        res.json(items);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get recent content
app.get('/api/content/recent/:limit', (req, res) => {
    try {
        const items = content.getRecent.all(parseInt(req.params.limit) || 10);
        res.json(items);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Search content
app.get('/api/content/search', (req, res) => {
    try {
        const query = `%${req.query.q || ''}%`;
        const results = content.search.all(query, query);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single content by ID
app.get('/api/content/:id', (req, res) => {
    try {
        const item = content.getById.get(req.params.id);
        if (!item) return res.status(404).json({ error: 'Content not found' });

        // If it's a series, include episodes
        if (item.type === 'series') {
            item.episodes = episodes.getByContentId.all(item.id);
        }
        res.json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload new content
app.post('/api/content', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
]), (req, res) => {
    try {
        const id = uuidv4();
        const { title, description, type, genre, year } = req.body;

        const videoPath = req.files?.video?.[0]?.filename
            ? `/media/videos/${req.files.video[0].filename}`
            : null;
        const thumbnailPath = req.files?.thumbnail?.[0]?.filename
            ? `/media/thumbnails/${req.files.thumbnail[0].filename}`
            : null;

        content.insert.run(
            id, title, description, type, genre,
            parseInt(year) || null, thumbnailPath, videoPath, null
        );

        res.status(201).json({
            id,
            message: 'Content uploaded successfully',
            video_path: videoPath,
            thumbnail: thumbnailPath
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add episode to series
app.post('/api/content/:id/episodes', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
]), (req, res) => {
    try {
        const contentId = req.params.id;
        const item = content.getById.get(contentId);

        if (!item) return res.status(404).json({ error: 'Series not found' });
        if (item.type !== 'series') return res.status(400).json({ error: 'Can only add episodes to series' });

        const episodeId = uuidv4();
        const { season, episode, title, description } = req.body;

        const videoPath = req.files?.video?.[0]?.filename
            ? `/media/videos/${req.files.video[0].filename}`
            : null;
        const thumbnailPath = req.files?.thumbnail?.[0]?.filename
            ? `/media/thumbnails/${req.files.thumbnail[0].filename}`
            : null;

        episodes.insert.run(
            episodeId, contentId, parseInt(season), parseInt(episode),
            title, description, videoPath, null, thumbnailPath
        );

        res.status(201).json({
            id: episodeId,
            message: 'Episode added successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update content
app.put('/api/content/:id', upload.single('thumbnail'), (req, res) => {
    try {
        const item = content.getById.get(req.params.id);
        if (!item) return res.status(404).json({ error: 'Content not found' });

        const { title, description, genre, year } = req.body;
        const thumbnailPath = req.file
            ? `/media/thumbnails/${req.file.filename}`
            : item.thumbnail;

        content.update.run(
            title || item.title,
            description || item.description,
            genre || item.genre,
            parseInt(year) || item.year,
            thumbnailPath,
            req.params.id
        );

        res.json({ message: 'Content updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete content
app.delete('/api/content/:id', (req, res) => {
    try {
        const item = content.getById.get(req.params.id);
        if (!item) return res.status(404).json({ error: 'Content not found' });

        // Delete associated files
        if (item.video_path) {
            const videoFile = path.join(__dirname, 'public', item.video_path);
            if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile);
        }
        if (item.thumbnail) {
            const thumbFile = path.join(__dirname, 'public', item.thumbnail);
            if (fs.existsSync(thumbFile)) fs.unlinkSync(thumbFile);
        }

        content.delete.run(req.params.id);
        res.json({ message: 'Content deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ VIDEO STREAMING ============

// Stream video with range support (for seeking)
app.get('/stream/:filename', (req, res) => {
    const videoPath = path.join(videosDir, req.params.filename);

    if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ error: 'Video not found' });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4'
        };

        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4'
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
    }
});

// ============ START SERVER ============

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   🎬  HomeStream is running!                              ║
  ║                                                           ║
  ║   Local:    http://localhost:${PORT}                        ║
  ║   Network:  http://<YOUR_IP>:${PORT}                        ║
  ║                                                           ║
  ║   Run 'ipconfig' to find your network IP address          ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);
});
