const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'homestream.db'));

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
    genre TEXT,
    year INTEGER,
    thumbnail TEXT,
    video_path TEXT,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    title TEXT,
    description TEXT,
    video_path TEXT,
    duration INTEGER,
    thumbnail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS watch_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id TEXT NOT NULL,
    episode_id TEXT,
    progress INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE
  );
`);

// Content CRUD operations
const contentQueries = {
    getAll: db.prepare('SELECT * FROM content ORDER BY created_at DESC'),
    getById: db.prepare('SELECT * FROM content WHERE id = ?'),
    getByType: db.prepare('SELECT * FROM content WHERE type = ? ORDER BY created_at DESC'),
    getRecent: db.prepare('SELECT * FROM content ORDER BY created_at DESC LIMIT ?'),
    search: db.prepare('SELECT * FROM content WHERE title LIKE ? OR description LIKE ?'),

    insert: db.prepare(`
    INSERT INTO content (id, title, description, type, genre, year, thumbnail, video_path, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

    update: db.prepare(`
    UPDATE content SET title = ?, description = ?, genre = ?, year = ?, thumbnail = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

    delete: db.prepare('DELETE FROM content WHERE id = ?')
};

// Episode operations
const episodeQueries = {
    getByContentId: db.prepare('SELECT * FROM episodes WHERE content_id = ? ORDER BY season, episode'),
    getById: db.prepare('SELECT * FROM episodes WHERE id = ?'),

    insert: db.prepare(`
    INSERT INTO episodes (id, content_id, season, episode, title, description, video_path, duration, thumbnail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

    delete: db.prepare('DELETE FROM episodes WHERE id = ?')
};

// Watch progress operations
const progressQueries = {
    get: db.prepare('SELECT * FROM watch_progress WHERE content_id = ? AND (episode_id = ? OR episode_id IS NULL)'),
    upsert: db.prepare(`
    INSERT INTO watch_progress (content_id, episode_id, progress, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET progress = ?, updated_at = CURRENT_TIMESTAMP
  `)
};

module.exports = {
    db,
    content: contentQueries,
    episodes: episodeQueries,
    progress: progressQueries
};
