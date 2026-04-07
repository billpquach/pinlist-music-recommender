import os
import uuid
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from pinclip import run_pipeline

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
        playlist, mood = run_pipeline(image_urls)
        print(f"Playlist length: {len(playlist)}, mood: {mood}")
        return jsonify({
            "mood": mood,
            "playlist": [
                {
                    "name":      name,
                    "artist":    artist,
                    "href":      url,
                    "thumbnail": thumbnail,
                    "score":     round(score, 3)
                }
                for score, name, artist, url, thumbnail in playlist
            ]
        })
    except Exception as e:
        print(f"Pipeline error: {e}")
        return jsonify({"error": str(e)}), 500

# ─── Entry Point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(port=5000, debug=True)