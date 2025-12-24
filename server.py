"""
HomeStream - Local Streaming Platform
A Netflix-style streaming server for your local network
"""

import os
import json
import uuid
import sqlite3
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_file, send_from_directory, Response

app = Flask(__name__, static_folder=None)

# Configuration
BASE_DIR = Path(__file__).parent
MEDIA_DIR = BASE_DIR / 'media'
VIDEOS_DIR = MEDIA_DIR / 'videos'
THUMBNAILS_DIR = MEDIA_DIR / 'thumbnails'
DB_PATH = BASE_DIR / 'homestream.db'

# Create directories
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

# ============ DATABASE SETUP ============

def get_db():
    """Get database connection with row factory"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database tables"""
    conn = get_db()
    conn.executescript('''
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
    ''')
    conn.commit()
    conn.close()

def row_to_dict(row):
    """Convert sqlite Row to dictionary"""
    if row is None:
        return None
    return dict(row)

def rows_to_list(rows):
    """Convert list of sqlite Rows to list of dictionaries"""
    return [dict(row) for row in rows]

# Initialize database on startup
init_db()

# ============ STATIC FILE SERVING ============

# Index route moved to end of file

@app.route('/media/<path:filename>')
def serve_media(filename):
    return send_from_directory('media', filename)

# Catch-all for static files (must be last, after API routes)
# This is handled by Flask's static_folder setting

# ============ API ROUTES ============

@app.route('/api/content', methods=['GET'])
def get_all_content():
    """Get all content"""
    conn = get_db()
    rows = conn.execute('SELECT * FROM content ORDER BY created_at DESC').fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))

@app.route('/api/content/type/<content_type>', methods=['GET'])
def get_content_by_type(content_type):
    """Get content by type (movies or series)"""
    conn = get_db()
    rows = conn.execute('SELECT * FROM content WHERE type = ? ORDER BY created_at DESC', (content_type,)).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))

@app.route('/api/content/recent/<int:limit>', methods=['GET'])
def get_recent_content(limit):
    """Get recent content"""
    conn = get_db()
    rows = conn.execute('SELECT * FROM content ORDER BY created_at DESC LIMIT ?', (limit,)).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))

@app.route('/api/content/search', methods=['GET'])
def search_content():
    """Search content by title or description"""
    query = request.args.get('q', '')
    search_term = f'%{query}%'
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM content WHERE title LIKE ? OR description LIKE ?',
        (search_term, search_term)
    ).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))

@app.route('/api/content/<content_id>', methods=['GET'])
def get_content_by_id(content_id):
    """Get single content by ID"""
    conn = get_db()
    row = conn.execute('SELECT * FROM content WHERE id = ?', (content_id,)).fetchone()
    
    if row is None:
        conn.close()
        return jsonify({'error': 'Content not found'}), 404
    
    content = row_to_dict(row)
    
    # If it's a series, include episodes
    if content['type'] == 'series':
        episodes = conn.execute(
            'SELECT * FROM episodes WHERE content_id = ? ORDER BY season, episode',
            (content_id,)
        ).fetchall()
        content['episodes'] = rows_to_list(episodes)
    
    conn.close()
    return jsonify(content)

@app.route('/api/content', methods=['POST'])
def upload_content():
    """Upload new content"""
    try:
        content_id = str(uuid.uuid4())
        title = request.form.get('title', '')
        description = request.form.get('description', '')
        content_type = request.form.get('type', 'movie')
        genre = request.form.get('genre', '')
        year = request.form.get('year', '')
        
        video_path = None
        thumbnail_path = None
        
        # Handle video upload
        if 'video' in request.files:
            video = request.files['video']
            if video.filename:
                ext = Path(video.filename).suffix
                video_filename = f'{uuid.uuid4()}{ext}'
                video.save(VIDEOS_DIR / video_filename)
                video_path = f'/media/videos/{video_filename}'
        
        # Handle thumbnail upload
        if 'thumbnail' in request.files:
            thumbnail = request.files['thumbnail']
            if thumbnail.filename:
                ext = Path(thumbnail.filename).suffix
                thumb_filename = f'{uuid.uuid4()}{ext}'
                thumbnail.save(THUMBNAILS_DIR / thumb_filename)
                thumbnail_path = f'/media/thumbnails/{thumb_filename}'
        
        # Insert into database
        conn = get_db()
        conn.execute('''
            INSERT INTO content (id, title, description, type, genre, year, thumbnail, video_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (content_id, title, description, content_type, genre, int(year) if year else None, thumbnail_path, video_path))
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': content_id,
            'message': 'Content uploaded successfully',
            'video_path': video_path,
            'thumbnail': thumbnail_path
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/content/<content_id>/episodes', methods=['POST'])
def add_episode(content_id):
    """Add episode to series"""
    try:
        conn = get_db()
        row = conn.execute('SELECT * FROM content WHERE id = ?', (content_id,)).fetchone()
        
        if row is None:
            conn.close()
            return jsonify({'error': 'Series not found'}), 404
        
        content = row_to_dict(row)
        if content['type'] != 'series':
            conn.close()
            return jsonify({'error': 'Can only add episodes to series'}), 400
        
        episode_id = str(uuid.uuid4())
        season = request.form.get('season', 1)
        episode = request.form.get('episode', 1)
        title = request.form.get('title', '')
        description = request.form.get('description', '')
        
        video_path = None
        thumbnail_path = None
        
        # Handle video upload
        if 'video' in request.files:
            video = request.files['video']
            if video.filename:
                ext = Path(video.filename).suffix
                video_filename = f'{uuid.uuid4()}{ext}'
                video.save(VIDEOS_DIR / video_filename)
                video_path = f'/media/videos/{video_filename}'
        
        # Handle thumbnail upload
        if 'thumbnail' in request.files:
            thumbnail = request.files['thumbnail']
            if thumbnail.filename:
                ext = Path(thumbnail.filename).suffix
                thumb_filename = f'{uuid.uuid4()}{ext}'
                thumbnail.save(THUMBNAILS_DIR / thumb_filename)
                thumbnail_path = f'/media/thumbnails/{thumb_filename}'
        
        conn.execute('''
            INSERT INTO episodes (id, content_id, season, episode, title, description, video_path, thumbnail)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (episode_id, content_id, int(season), int(episode), title, description, video_path, thumbnail_path))
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': episode_id,
            'message': 'Episode added successfully'
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/content/<content_id>', methods=['DELETE'])
def delete_content(content_id):
    """Delete content"""
    try:
        conn = get_db()
        row = conn.execute('SELECT * FROM content WHERE id = ?', (content_id,)).fetchone()
        
        if row is None:
            conn.close()
            return jsonify({'error': 'Content not found'}), 404
        
        content = row_to_dict(row)
        
        # Delete associated files
        if content['video_path']:
            video_file = BASE_DIR / content['video_path'].lstrip('/')
            if video_file.exists():
                video_file.unlink()
        
        if content['thumbnail']:
            thumb_file = BASE_DIR / content['thumbnail'].lstrip('/')
            if thumb_file.exists():
                thumb_file.unlink()
        
        conn.execute('DELETE FROM content WHERE id = ?', (content_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Content deleted successfully'})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============ VIDEO STREAMING ============

@app.route('/stream/<filename>')
def stream_video(filename):
    """Stream video with range request support for seeking"""
    video_path = VIDEOS_DIR / filename
    
    if not video_path.exists():
        return jsonify({'error': 'Video not found'}), 404
    
    file_size = video_path.stat().st_size
    range_header = request.headers.get('Range')
    
    # Determine content type based on extension
    ext = video_path.suffix.lower()
    content_types = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.m4v': 'video/mp4'
    }
    content_type = content_types.get(ext, 'video/mp4')
    
    if range_header:
        # Parse range header
        byte_range = range_header.replace('bytes=', '').split('-')
        start = int(byte_range[0])
        end = int(byte_range[1]) if byte_range[1] else file_size - 1
        
        if start >= file_size:
            return Response(status=416)  # Range not satisfiable
        
        end = min(end, file_size - 1)
        chunk_size = end - start + 1
        
        def generate():
            with open(video_path, 'rb') as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    chunk = f.read(min(8192, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
        
        return Response(
            generate(),
            status=206,
            headers={
                'Content-Type': content_type,
                'Content-Range': f'bytes {start}-{end}/{file_size}',
                'Accept-Ranges': 'bytes',
                'Content-Length': str(chunk_size)
            }
        )
    else:
        # Full file response
        return send_file(video_path, mimetype=content_type)


# ============ STATIC FILE FALLBACK ============

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    """Serve static files from public directory"""
    return send_from_directory('public', filename)


# ============ SERVER STARTUP ============

if __name__ == '__main__':
    print('''
  ================================================================
  |                                                              |
  |   HomeStream is running!                                     |
  |                                                              |
  |   Local:    http://localhost:3000                            |
  |   Network:  http://<YOUR_IP>:3000                            |
  |                                                              |
  |   Run 'ipconfig' to find your network IP address             |
  |                                                              |
  ================================================================
    ''')
    
    app.run(host='0.0.0.0', port=3000, debug=False, threaded=True)
