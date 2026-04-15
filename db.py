# db.py
# SQLite database layer for PinClip's explore feed.
# Run this file directly once to initialize the database: python db.py

import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "pinclip.db")

# ─── Schema ───────────────────────────────────────────────────────────────────

def init_db():
    """Create tables if they don't exist. Safe to call on every startup."""
    conn = get_conn()
    c    = conn.cursor()

    # Each row = one shared playlist card in the explore feed
    c.execute("""
        CREATE TABLE IF NOT EXISTS explore_cards (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            board_name  TEXT    NOT NULL,
            mood        TEXT    NOT NULL,
            pin_images  TEXT    NOT NULL,   -- JSON array of up to 4 image URLs
            tracks      TEXT    NOT NULL,   -- JSON array of track objects
            playlist_id TEXT,              -- Spotify playlist ID (optional)
            board_moods TEXT,              -- JSON array of {label, score} top 3 moods
            created_at  TEXT    NOT NULL
        )
    """)

    conn.commit()
    conn.close()
    print("Database initialized at", DB_PATH)

# ─── Connection ───────────────────────────────────────────────────────────────

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row   # lets you access columns by name
    return conn

# ─── Write ────────────────────────────────────────────────────────────────────

def save_card(board_name: str, mood: str, pin_images: list,
              tracks: list, playlist_id: str = None,
              board_moods: list = None) -> int:
    """
    Save a completed playlist to the explore feed.
    pin_images: list of up to 4 image URLs
    tracks:     list of dicts with keys name, artist, href, thumbnail, track_id, preview_url
    Returns the new row ID.
    """
    conn = get_conn()
    c    = conn.cursor()

    c.execute("""
        INSERT INTO explore_cards (board_name, mood, pin_images, tracks, playlist_id, board_moods, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        board_name,
        mood,
        json.dumps(pin_images[:12]),
        json.dumps(tracks),
        playlist_id,
        json.dumps(board_moods or []),
        datetime.utcnow().isoformat()
    ))

    conn.commit()
    row_id = c.lastrowid
    conn.close()
    return row_id

# ─── Read ─────────────────────────────────────────────────────────────────────

def get_feed(limit: int = 20, offset: int = 0) -> list[dict]:
    """
    Return explore cards newest-first, paginated.
    Each dict has: id, board_name, mood, pin_images, tracks, playlist_id, created_at
    """
    conn = get_conn()
    c    = conn.cursor()

    c.execute("""
        SELECT * FROM explore_cards
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    """, (limit, offset))

    rows = c.fetchall()
    conn.close()

    result = []
    for row in rows:
        result.append({
            "id":          row["id"],
            "board_name":  row["board_name"],
            "mood":        row["mood"],
            "pin_images":  json.loads(row["pin_images"]),
            "tracks":      json.loads(row["tracks"]),
            "playlist_id": row["playlist_id"],
            "board_moods": json.loads(row["board_moods"] or "[]"),
            "created_at":  row["created_at"],
        })
    return result

# ─── Entry point — run once to create the DB ─────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("Done. pinclip.db is ready.")