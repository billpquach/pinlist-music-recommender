import os
import uuid
import requests
from flask import Flask, request, jsonify, session
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

CLIENT_ID    = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
REDIRECT_URI  = os.getenv("REDIRECT_URI")

# Simple in-memory token store — swap for Redis in production
token_store = {}

# ─── Helper ──────────────────────────────────────────────────────────────────

def pinterest_get(endpoint: str, access_token: str, params: dict = None):
    """Wrapper for authenticated Pinterest GET requests with error handling."""
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
        data={                              # NOTE: form-encoded, not JSON
            "grant_type":   "authorization_code",
            "code":         code,
            "redirect_uri": REDIRECT_URI
        }
    )

    if not resp.ok:
        return jsonify({"error": resp.json()}), resp.status_code

    token_data = resp.json()
    access_token = token_data["access_token"]

    # Generate a session ID to return to the frontend
    session_id = str(uuid.uuid4())
    token_store[session_id] = access_token

    return jsonify({
        "session_id":    session_id,
        "expires_in":    token_data.get("expires_in"),
        "refresh_token": token_data.get("refresh_token"),
    })

# ─── Boards ───────────────────────────────────────────────────────────────────

@app.route("/boards", methods=["GET"])
def get_boards():
    session_id   = request.headers.get("X-Session-ID")
    access_token = token_store.get(session_id)
    if not access_token:
        return jsonify({"error": "Not authenticated"}), 401

    all_boards = []
    cursor     = None

    # Pinterest paginates — keep fetching until no bookmark
    while True:
        params = {"page_size": 25}
        if cursor:
            params["bookmark"] = cursor

        data   = pinterest_get("/boards", access_token, params)
        boards = data.get("items", [])
        all_boards.extend(boards)

        cursor = data.get("bookmark")
        if not cursor or not boards:
            break

    # Return only the fields the frontend needs
    return jsonify({
        "boards": [
            {
                "id":          b["id"],
                "name":        b["name"],
                "description": b.get("description", ""),
                "pin_count":   b.get("pin_count", 0),
                "cover_image": (
                    b.get("media", {})
                     .get("image_cover_url")
                ),
                "privacy":     b.get("privacy", "PUBLIC"),
            }
            for b in all_boards
            if b.get("privacy") != "SECRET"  # skip private boards
        ]
    })

# ─── Pins ─────────────────────────────────────────────────────────────────────

@app.route("/pins/<board_id>", methods=["GET"])
def get_pins(board_id):
    session_id   = request.headers.get("X-Session-ID")
    access_token = token_store.get(session_id)
    if not access_token:
        return jsonify({"error": "Not authenticated"}), 401

    all_pins = []
    cursor   = None
    max_pins = 150   # cap per board — more than enough for CLIP

    while len(all_pins) < max_pins:
        params = {"page_size": 25}
        if cursor:
            params["bookmark"] = cursor

        data  = pinterest_get(f"/boards/{board_id}/pins", access_token, params)
        pins  = data.get("items", [])
        if not pins:
            break

        for pin in pins:
            extracted = extract_pin_data(pin)
            if extracted:
                all_pins.append(extracted)

        cursor = data.get("bookmark")
        if not cursor:
            break

    return jsonify({
        "board_id":  board_id,
        "pin_count": len(all_pins),
        "pins":      all_pins
    })

def extract_pin_data(pin: dict) -> dict | None:
    """
    Pull out every field useful for CLIP and text embedding.
    Returns None if the pin has no usable image.
    """
    # Images are nested under media.images with size keys
    # Pinterest v5 returns multiple sizes — grab the largest available
    images = (
        pin.get("media", {}).get("images", {})
        or pin.get("media", {})
    )

    image_url = (
        images.get("1200x", {}).get("url")
        or images.get("600x", {}).get("url")
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
        "alt_text":    pin.get("alt_text", ""),
    }

# ─── Board data packaged for the ML pipeline ─────────────────────────────────

@app.route("/board-data/<board_id>", methods=["GET"])
def get_board_data(board_id):
    """
    Single endpoint that returns everything the CLIP pipeline needs
    for a given board: board metadata + all pin images + all text.
    This is what you'll call from your ML service.
    """
    session_id   = request.headers.get("X-Session-ID")
    access_token = token_store.get(session_id)
    if not access_token:
        return jsonify({"error": "Not authenticated"}), 401

    # Board metadata
    board = pinterest_get(f"/boards/{board_id}", access_token)

    # All pins
    pins_resp = get_pins(board_id)          # reuse existing route logic
    pins      = pins_resp.get_json()["pins"]

    return jsonify({
        "board": {
            "id":          board["id"],
            "name":        board.get("name", ""),
            "description": board.get("description", ""),
        },
        "pins": pins,
        # Pre-assembled text blob for the sentence-transformer
        "text_corpus": assemble_text(board, pins),
        # Just the image URLs for CLIP
        "image_urls": [p["image_url"] for p in pins if p.get("image_url")]
    })

def assemble_text(board: dict, pins: list[dict]) -> list[str]:
    """
    Build the weighted text list that goes into sentence-transformers.
    Board name is repeated 5x to upweight it — the highest signal field.
    """
    texts = [board.get("name", "")] * 5

    if board.get("description"):
        texts.append(board["description"])

    for pin in pins:
        if pin.get("title"):       texts.append(pin["title"])
        if pin.get("description"): texts.append(pin["description"])
        if pin.get("alt_text"):    texts.append(pin["alt_text"])

    # Filter empty strings
    return [t.strip() for t in texts if t.strip()]


# ─── Board data packaged for the ML pipeline ─────────────────────────────────
# ... (existing /board-data route if you kept it, or just the /pins route above)


# ─── Analysis ────────────────────────────────────────────────────────────────

from pinclip import run_pipeline          # add this import at the TOP of the file
                                          # not here — shown here just for clarity

@app.route("/analyze", methods=["POST"])
def analyze():
    session_id = request.headers.get("X-Session-ID")
    if not token_store.get(session_id):
        return jsonify({"error": "Not authenticated"}), 401

    image_urls = request.json.get("image_urls", [])
    if not image_urls:
        return jsonify({"error": "No images provided"}), 400

    try:
        playlist = run_pipeline(image_urls)
        return jsonify({
            "playlist": [
                {"name": name, "artist": artist, "href": url, "score": round(score, 3)}
                for score, name, artist, url in playlist
            ]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Entry Point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(port=5000, debug=True)