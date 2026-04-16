import os
import uuid
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from pinclip import run_pipeline
import base64
import json, base64 as b64
from db import init_db, save_card, get_feed
from PIL import Image
from io import BytesIO

load_dotenv()

app = Flask(__name__)
CORS(app, resources={
    r"/*": {
        "origins": ["http://localhost:5500", "http://127.0.0.1:5500"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "X-Session-ID"]
    }
})
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-change-in-prod")

CLIENT_ID     = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
REDIRECT_URI  = os.getenv("REDIRECT_URI")

# Simple in-memory token store — swap for Redis in production
token_store = {}

SPOTIFY_CLIENT_ID     = os.getenv("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI  = os.getenv("SPOTIFY_REDIRECT_URI",
                                   "http://localhost:5500/spotify-callback.html")

# Separate store for Spotify tokens — do not mix with Pinterest token_store
spotify_token_store = {}

# ─── Helper ──────────────────────────────────────────────────────────────────

def pinterest_get(endpoint: str, access_token: str, params: dict = None):
    resp = requests.get(
        f"https://api.pinterest.com/v5{endpoint}",
        headers={"Authorization": f"Bearer {access_token}"},
        params=params or {},
        timeout=10
    )
    resp.raise_for_status()
    return resp.json()

# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.route("/exchange-token", methods=["POST"])
def exchange_token():
    code = request.json.get("code")
    if not code:
        return jsonify({"error": "No code provided"}), 400

    resp = requests.post(
        "https://api.pinterest.com/v5/oauth/token",
        auth=(CLIENT_ID, CLIENT_SECRET),
        data={
            "grant_type":   "authorization_code",
            "code":         code,
            "redirect_uri": REDIRECT_URI
        }
    )

    if not resp.ok:
        return jsonify({"error": resp.json()}), resp.status_code

    token_data   = resp.json()
    session_id   = str(uuid.uuid4())
    token_store[session_id] = token_data["access_token"]

    return jsonify({
        "session_id": session_id,
        "expires_in": token_data.get("expires_in"),
    })

# ─── Boards ───────────────────────────────────────────────────────────────────

@app.route("/boards", methods=["GET"])
def get_boards():
    access_token = token_store.get(request.headers.get("X-Session-ID"))
    if not access_token:
        return jsonify({"error": "Not authenticated"}), 401

    all_boards, cursor = [], None
    while True:
        params = {"page_size": 25}
        if cursor:
            params["bookmark"] = cursor
        data = pinterest_get("/boards", access_token, params)
        all_boards.extend(data.get("items", []))
        cursor = data.get("bookmark")
        if not cursor or not data.get("items"):
            break

    return jsonify({
        "boards": [
            {
                "id":          b["id"],
                "name":        b["name"],
                "description": b.get("description", ""),
                "pin_count":   b.get("pin_count", 0),
                "cover_image": b.get("media", {}).get("image_cover_url"),
            }
            for b in all_boards if b.get("privacy") != "SECRET"
        ]
    })

# ─── Pins ─────────────────────────────────────────────────────────────────────

@app.route("/pins/<board_id>", methods=["GET"])
def get_pins(board_id):
    access_token = token_store.get(request.headers.get("X-Session-ID"))
    if not access_token:
        return jsonify({"error": "Not authenticated"}), 401

    all_pins, cursor = [], None

    while len(all_pins) < 150:
        params = {"page_size": 25}
        if cursor:
            params["bookmark"] = cursor
        data = pinterest_get(f"/boards/{board_id}/pins", access_token, params)
        pins = data.get("items", [])
        if not pins:
            break
        all_pins.extend([p for p in (extract_pin_data(p) for p in pins) if p])
        cursor = data.get("bookmark")
        if not cursor:
            break

    return jsonify({
        "board_id":  board_id,
        "pin_count": len(all_pins),
        "pins":      all_pins
    })


def extract_pin_data(pin: dict) -> dict | None:
    images    = pin.get("media", {}).get("images", {})
    image_url = (
        images.get("1200x", {}).get("url")
        or images.get("600x",    {}).get("url")
        or images.get("400x300", {}).get("url")
        or images.get("150x150", {}).get("url")
    )
    if not image_url:
        return None
    return {
        "id":          pin.get("id"),
        "image_url":   image_url,
        "title":       pin.get("title", ""),
        "description": pin.get("description", ""),
        "link":        pin.get("link", ""),
    }

# ─── Analyze ─────────────────────────────────────────────────────────────────

@app.route("/analyze", methods=["POST"])
def analyze():
    access_token = token_store.get(request.headers.get("X-Session-ID"))
    if not access_token:
        return jsonify({"error": "Not authenticated"}), 401

    image_urls = request.json.get("image_urls", [])
    if not image_urls:
        return jsonify({"error": "No images provided"}), 400

    try:
        playlist, mood, per_pin_moods, board_moods = run_pipeline(image_urls)
        print(f"Playlist length: {len(playlist)}, mood: {mood}")
        playlist_payload = []
        for entry in playlist:
            score, name, artist, url, thumbnail, *rest = entry
            track_id = rest[0] if rest else ""
            playlist_payload.append({
                "name":      name,
                "artist":    artist,
                "href":      url,
                "thumbnail": thumbnail,
                "track_id":  track_id,
                "score":     round(score, 3)
            })
        return jsonify({
            "mood":          mood,
            "playlist":      playlist_payload,
            "per_pin_moods": per_pin_moods,
            "board_moods":   board_moods,
        })
    except Exception as e:
        print(f"Pipeline error: {e}")
        return jsonify({"error": str(e)}), 500

# ─── Spotify Auth ─────────────────────────────────────────────────────────────

@app.route("/spotify/auth-url", methods=["GET"])
def spotify_auth_url():
    session_id = request.args.get("session_id", "")
    scopes = "playlist-modify-public"
    url = (
        "https://accounts.spotify.com/authorize"
        f"?client_id={SPOTIFY_CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={requests.utils.quote(SPOTIFY_REDIRECT_URI)}"
        f"&scope={requests.utils.quote(scopes)}"
        f"&state={session_id}"
        f"&show_dialog=true"
    )
    return jsonify({"url": url})


@app.route("/spotify/disconnect", methods=["POST"])
def spotify_disconnect():
    session_id = request.headers.get("X-Session-ID")
    spotify_token_store.pop(session_id, None)
    return jsonify({"ok": True})


@app.route("/spotify/exchange-token", methods=["POST"])
def spotify_exchange_token():
    code       = request.json.get("code")
    session_id = request.headers.get("X-Session-ID")
    if not code or not session_id:
        return jsonify({"error": "Missing code or session"}), 400

    credentials = base64.b64encode(
        f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()
    ).decode()

    resp = requests.post(
        "https://accounts.spotify.com/api/token",
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type":  "application/x-www-form-urlencoded"
        },
        data={
            "grant_type":   "authorization_code",
            "code":         code,
            "redirect_uri": SPOTIFY_REDIRECT_URI
        }
    )
    if not resp.ok:
        print("Spotify token error:", resp.json())
        return jsonify({"error": resp.json()}), resp.status_code

    spotify_token_store[session_id] = resp.json()["access_token"]
    print(f"Spotify token stored for session {session_id}")
    return jsonify({"ok": True})


@app.route("/spotify/create-playlist", methods=["POST"])
def create_spotify_playlist():
    session_id    = request.headers.get("X-Session-ID")
    spotify_token = spotify_token_store.get(session_id)

    if not spotify_token:
        return jsonify({"error": "Spotify not connected", "needs_auth": True}), 401

    body       = request.json
    track_ids  = body.get("track_ids", [])
    board_name = body.get("board_name", "My Board")
    mood       = body.get("mood", "")

    if not track_ids:
        return jsonify({"error": "No track IDs provided"}), 400

    headers = {
        "Authorization": f"Bearer {spotify_token}",
        "Content-Type":  "application/json"
    }

    # Get Spotify user ID
    user_resp = requests.get("https://api.spotify.com/v1/me", headers=headers)
    if not user_resp.ok:
        spotify_token_store.pop(session_id, None)
        return jsonify({"error": "Spotify token expired", "needs_auth": True}), 401

    user_id = user_resp.json()["id"]

    # Create the playlist
    create_resp = requests.post(
        "https://api.spotify.com/v1/me/playlists",
        headers=headers,
        json={
            "name":        f"{board_name} — by PinClip",
            "public":      True,
            "description": f"Generated from your Pinterest aesthetic ({mood}) by PinClip"
        }
    )
    if not create_resp.ok:
        print("Create playlist error:", create_resp.status_code, create_resp.json())
        return jsonify({"error": create_resp.json()}), create_resp.status_code

    playlist_id = create_resp.json()["id"]

    # Add tracks — /items is the correct current endpoint
    track_uris = [f"spotify:track:{tid}" for tid in track_ids[:100] if tid]
    add_resp = requests.post(
        f"https://api.spotify.com/v1/playlists/{playlist_id}/items",
        headers=headers,
        json={"uris": track_uris}
    )
    if not add_resp.ok:
        error_body = add_resp.json()
        if add_resp.status_code == 403:
            spotify_token_store.pop(session_id, None)
            return jsonify({"error": error_body, "needs_auth": True}), 403
        return jsonify({"error": error_body}), add_resp.status_code

    return jsonify({
        "playlist_id": playlist_id,
        "embed_url":   f"https://open.spotify.com/embed/playlist/{playlist_id}"
    })

# ─── Outfit Analysis (no auth required) ───────────────────────────────────────

@app.route("/analyze-outfit", methods=["POST"])
def analyze_outfit():
    image_data = request.json.get("image_data", [])
    if not image_data:
        return jsonify({"error": "No images provided"}), 400

    # decode base64 strings → PIL images
    images = []
    for b64_str in image_data:
        try:
            # strip data URL prefix if present
            if "," in b64_str:
                b64_str = b64_str.split(",", 1)[1]
            img_bytes = base64.b64decode(b64_str)
            img       = Image.open(BytesIO(img_bytes)).convert("RGB")
            images.append(img)
        except Exception as e:
            print(f"Image decode error: {e}")

    if not images:
        return jsonify({"error": "No valid images could be decoded"}), 400

    try:
        from pinclip import run_pipeline_from_images
        playlist, mood, per_pin_moods, board_moods = run_pipeline_from_images(images)

        playlist_payload = []
        for entry in playlist:
            score, name, artist, url, thumbnail, *rest = entry
            track_id = rest[0] if rest else ""
            playlist_payload.append({
                "name":      name,
                "artist":    artist,
                "href":      url,
                "thumbnail": thumbnail,
                "track_id":  track_id,
                "score":     round(score, 3)
            })
        return jsonify({
            "mood":          mood,
            "playlist":      playlist_payload,
            "per_pin_moods": per_pin_moods,
            "board_moods":   board_moods,
        })
    except Exception as e:
        print(f"Outfit pipeline error: {e}")
        return jsonify({"error": str(e)}), 500

# ─── Explore ──────────────────────────────────────────────────────────────────

@app.route("/explore/feed", methods=["GET"])
def explore_feed():
    try:
        limit  = int(request.args.get("limit",  20))
        offset = int(request.args.get("offset",  0))
        cards  = get_feed(limit=limit, offset=offset)
        return jsonify({"cards": cards, "offset": offset, "limit": limit})
    except Exception as e:
        print(f"Explore feed error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/explore/save", methods=["POST"])
def explore_save():
    session_id = request.headers.get("X-Session-ID")

    # Allow both Pinterest-authenticated sessions AND anonymous photo sessions.
    # Pinterest sessions are in token_store; photo sessions are bare UUIDs that
    # won't be in token_store — that's fine, we just need *some* session ID so
    # we can identify the submitter. Reject only completely missing session IDs.
    if not session_id:
        return jsonify({"error": "Missing session ID"}), 401

    body       = request.json or {}
    board_name = body.get("board_name", "").strip()
    mood       = body.get("mood",       "").strip()
    pin_images = body.get("pin_images", [])
    tracks     = body.get("tracks",     [])
    playlist_id = body.get("playlist_id", None)

    if not board_name or not pin_images or not tracks:
        return jsonify({"error": "Missing board_name, pin_images, or tracks"}), 400

    try:
        row_id = save_card(
            board_name=board_name,
            mood=mood,
            pin_images=pin_images[:12],
            tracks=tracks[:4],
            playlist_id=playlist_id,
            board_moods=body.get("board_moods", []),
        )
        return jsonify({"ok": True, "id": row_id})
    except Exception as e:
        print(f"Explore save error: {e}")
        return jsonify({"error": str(e)}), 500

# ─── Entry Point ──────────────────────────────────────────────────────────────

init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)