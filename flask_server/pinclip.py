# pinclip.py
# ─────────────────────────────────────────────────────────────────────────────
# Pinterest board → mood classification → music recommendations
# ─────────────────────────────────────────────────────────────────────────────

import os
import requests
import torch
import torch.nn.functional as F
from PIL import Image
from io import BytesIO
from transformers import CLIPProcessor, CLIPModel
from dotenv import load_dotenv

load_dotenv()

# ─── CLIP Setup ───────────────────────────────────────────────────────────────

print("Loading CLIP model...")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
model     = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
model.eval()
print("CLIP ready.\n")

# ─── Mood Labels ─────────────────────────────────────────────────────────────

MOOD_LABELS = [
    # ── existing ──────────────────────────────────────────────────
    "dark and moody",
    "bright and energetic",
    "calm and peaceful",
    "romantic and dreamy",
    "edgy and intense",
    "cozy and warm",
    "melancholic and sad",
    "euphoric and joyful",
    "orchestra",
    "gothic",
    "coastal beach",
    "preppy",
    # ── performative subcategories (map to parent "performative") ──
    "performative matcha",
    "performative totebag",
    "performative book",
    "performative vinyl",
    "wired earbuds",
    # ── old money subcategories ────────────────────────────────────
    "old money mediterranean outfit",  # → "old money"
    "old money academia outfit",       # → "dark academia"
    # ── standalone new moods ──────────────────────────────────────
    "hypebeast",
    "beach day outfit",
    "gym bro",
    "goth",
]

# ─── Subcategory → Parent Mood Map ───────────────────────────────────────────
# CLIP classifies against subcategory labels for better visual recognition.
# Any label found here is resolved to its parent before fetching recommendations.

SUBCATEGORY_MAP = {
    "performative matcha":            "performative",
    "performative totebag":           "performative",
    "performative book":              "performative",
    "performative vinyl":             "performative",
    "wired earbuds":                  "performative",
    "old money mediterranean outfit": "old money",
    "old money academia outfit":      "dark academia",
}

# ─── Mood Prompts ─────────────────────────────────────────────────────────────

MOOD_PROMPTS = {
    "dark and moody":       "A slow, brooding song with minor chords and a melancholic atmosphere",
    "bright and energetic": "An upbeat, high-energy song with a driving rhythm and positive feeling",
    "calm and peaceful":    "A soft, gentle song with acoustic instruments and a tranquil mood",
    "romantic and dreamy":  "A tender love song with lush instrumentation and an intimate, longing feel",
    "edgy and intense":     "An aggressive, high-intensity track with distorted guitars and raw emotion",
    "cozy and warm":        "A cozy, heartwarming song that feels like sitting by a fire on a quiet evening",
    "melancholic and sad":  "A quiet, emotional song about loss, longing, or heartbreak",
    "euphoric and joyful":  "A feel-good, danceable track with an infectious, uplifting energy",
    "orchestra":            "A sweeping orchestral composition with strings, brass, and classical structure",
    "gothic":               "A dark, theatrical song with gothic imagery, heavy atmosphere, and minor tonality",
    "coastal beach":        "A breezy, sun-soaked track with a relaxed, summery, coastal feel",
    "preppy":               "A clean, polished pop song with bright production and an upscale, carefree vibe",
    # ── new parent moods ───────────────────────────────────────────
    "performative":   "An intimate indie-pop or bedroom-pop song in the style of Laufey, Clairo, or Mitski — delicate vocals, lo-fi production, soft guitar, and an introspective emotional atmosphere",
    "old money":      "A romantic mid-20th century jazz song or R&B song or opera song or classical song or instrumental song or classic French chanson or Italian canzone — think Dean Martin, Frank Sinatra, Édith Piaf, or Pino Daniele",
    "dark academia":  "A brooding, literary song blending jazz piano and cinematic folk, with rich melancholic atmosphere and poetic lyricism",
    "hypebeast":      "A hard-hitting trap banger with heavy 808 bass, aggressive ad-libs, and high-energy production",
    "beach day outfit": "A warm breezy surf-rock or indie track with bright guitar and an effortlessly relaxed summery feel",
    "gym bro":        "A high-energy rap or trap track with driving bass and motivational energy for a workout",
    "goth":           "A dark post-punk or goth rock track with brooding guitars, dramatic vocals, and a theatrical atmosphere",
}

# ─── Mood Seeds ──────────────────────────────────────────────────────────────

MOOD_SEEDS = {
    "dark and moody":       ["21qg0IBZf8R12qHd9A3AA4"],
    "bright and energetic": ["32OlwWuMpZ6b0aN2RZOeMS"],
    "calm and peaceful":    ["7DfFc7a6Rwfi3YQMRbDMau", "5W0j7P73UBuiRvExwNVbYc"],
    "romantic and dreamy":  ["6cx5CvFhqN19efStehJqoW"],
    "edgy and intense":     ["0fv2KH6hac06J86hBUTcSf"],
    "cozy and warm":        ["5l9c6bJmzvftumhz4TMPgk"],
    "melancholic and sad":  ["2Co0IjcLTSHMtodwD4gzfg"],
    "euphoric and joyful":  ["60nZcImufyMA1MKQY3dcCH"],
    "orchestra":            ["61dYvvfIRtIDFuqZypPAta"],
    "gothic":               ["1EryAkZ0VHstC6haIxVBiE"],
    "coastal beach":        ["3xKsf9qdS1CyvXSMEid6g8"],
    "preppy":               ["43iIQbw5hx986dUEZbr3eN"],
    # ── new moods — ⚠️ PLACEHOLDER seeds, swap with real ReccoBeats IDs ──
    "performative":         ["08PdFBcXzpkn1cWNgmKqhn", "3vkCueOmm7xQDoJ17W1Pm3"],  # ⚠️ borrowed: romantic and dreamy
    "old money":            ["78OdnOhPOk19xYhGAKgjCO", "3lAun9V0YdTlCSIEXPvfsY", "0cgcD73SD4nFdTK2oKofzW"],  # ⚠️ borrowed: preppy
    "dark academia":        ["2Co0IjcLTSHMtodwD4gzfg"],  # ⚠️ borrowed: melancholic and sad
    "hypebeast":            ["1e1JKLEDKP7hEQzJfNAgPl"],  # ⚠️ borrowed: edgy and intense
    "beach day outfit":     ["3xKsf9qdS1CyvXSMEid6g8"],  # ⚠️ borrowed: coastal beach
    "gym bro":              ["3QFInJAm9eyaho5vBzxInN"],  # ⚠️ borrowed: bright and energetic
    "goth":                 ["5dTHtzHFPyi8TlTtzoz1J9", ""],  # ⚠️ borrowed: gothic
}

# ─── Pre-cache mood embeddings ────────────────────────────────────────────────

print("Caching mood embeddings...")
mood_embeddings: dict[str, torch.Tensor] = {}

for mood, prompt in MOOD_PROMPTS.items():
    inputs = processor(
        text=[prompt],
        return_tensors="pt",
        padding=True,
        truncation=True
    )
    with torch.no_grad():
        emb = model.text_model(
            input_ids=inputs["input_ids"],
            attention_mask=inputs["attention_mask"]
        ).pooler_output
        emb = model.text_projection(emb)
    mood_embeddings[mood] = F.normalize(emb, p=2, dim=-1).squeeze(0)

print("Mood embeddings cached.\n")

# ─── Image Classification ─────────────────────────────────────────────────────

def load_image(url: str) -> Image.Image:
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    return Image.open(BytesIO(resp.content)).convert("RGB")


def classify_image(image: Image.Image) -> list[float]:
    inputs = processor(
        text=MOOD_LABELS,
        images=image,
        return_tensors="pt",
        padding=True
    )
    with torch.no_grad():
        outputs = model(**inputs)
    return outputs.logits_per_image.softmax(dim=1)[0].tolist()


def aggregate_board_probs(image_urls: list[str]) -> list[float]:
    all_probs = []

    for i, url in enumerate(image_urls):
        try:
            image = load_image(url)
            probs = classify_image(image)
            all_probs.append(probs)
            print(f"  [{i+1}/{len(image_urls)}] classified")
        except Exception as e:
            print(f"  [{i+1}/{len(image_urls)}] skipped — {e}")

    if not all_probs:
        raise ValueError("No images could be classified.")

    n = len(all_probs)
    return [sum(p[i] for p in all_probs) / n for i in range(len(MOOD_LABELS))]

# ─── ReccoBeats ───────────────────────────────────────────────────────────────

RECCOBEATS_BASE = "https://api.reccobeats.com/v1"


def board_to_recommendations(probs: list[float], size: int = 50) -> tuple[dict, str]:
    sorted_moods = sorted(zip(probs, MOOD_LABELS), reverse=True)
    raw_mood     = sorted_moods[0][1]

    # resolve subcategory to parent if applicable
    top_mood = SUBCATEGORY_MAP.get(raw_mood, raw_mood)

    seeds = MOOD_SEEDS.get(top_mood, [])[:5]

    print(f"Raw CLIP mood:  {raw_mood}")
    print(f"Resolved mood:  {top_mood}")
    print(f"Seeds:          {seeds}")

    params = [("seeds", s) for s in seeds]
    params.append(("size", size))

    resp = requests.get(f"{RECCOBEATS_BASE}/track/recommendation", params=params)
    resp.raise_for_status()
    return resp.json(), top_mood

# ─── CLIP Track Scoring ───────────────────────────────────────────────────────

def score_all_tracks(recs: dict, mood: str) -> list[tuple]:
    """
    Scores every track against the cached mood embedding.
    Returns (score, title, artist, spotify_url, thumbnail_url) tuples.
    """
    tracks = recs.get("content", [])
    if not tracks:
        return []

    track_texts = []
    track_meta  = []

    for track in tracks:
        name      = track.get("trackTitle", "Unknown")
        artist    = track["artists"][0]["name"] if track.get("artists") else "Unknown"
        href      = track.get("href", "")
        url       = f"https://open.spotify.com/track/{href.split('/')[-1]}"

        # ReccoBeats returns thumbnail under track.thumbnail or track.album.thumbnail
        thumbnail = (
            track.get("thumbnail")
            or track.get("album", {}).get("thumbnail")
            or ""
        )
        track_id = href.split("/")[-1]   # from the ReccoBeats href field
        track_meta.append((name, artist, url, thumbnail, track_id))
        track_texts.append(f'A song called "{name}" by {artist}')
        print(track_id)

    inputs = processor(
        text=track_texts,
        return_tensors="pt",
        padding=True,
        truncation=True
    )
    with torch.no_grad():
        embeddings = model.text_model(
            input_ids=inputs["input_ids"],
            attention_mask=inputs["attention_mask"]
        ).pooler_output
        embeddings = model.text_projection(embeddings)

    embeddings  = F.normalize(embeddings, p=2, dim=-1)
    mood_vec    = mood_embeddings[mood]
    scores      = (embeddings @ mood_vec).tolist()

    return [
        (score, name, artist, url, thumbnail, track_id)
        for score, (name, artist, url, thumbnail, track_id) in zip(scores, track_meta)
    ]

# ─── Playlist Filtering ───────────────────────────────────────────────────────

def deduplicate_by_artist(scored: list[tuple], max_per_artist: int = 2) -> list[tuple]:
    artist_count: dict[str, int] = {}
    result = []
    for entry in scored:
        artist = entry[2]
        if artist_count.get(artist, 0) < max_per_artist:
            result.append(entry)
            artist_count[artist] = artist_count.get(artist, 0) + 1
    return result


def filter_to_final_playlist(
    recs:       dict,
    mood:       str,
    target:     int   = 12,
    min_target: int   = 8,
    threshold:  float = 0.25,
) -> list[tuple]:
    scored = score_all_tracks(recs, mood)
    scored.sort(reverse=True)
    scored   = deduplicate_by_artist(scored)
    playlist = [t for t in scored[:target] if t[0] > threshold]

    if len(playlist) < min_target:
        playlist = scored[:min_target]

    return playlist

# ─── Main Pipeline ────────────────────────────────────────────────────────────

def run_pipeline(image_urls: list[str]):
    print(f"\n── Classifying {len(image_urls)} image(s)...")

    # ── Per-pin classification ────────────────────────────────────────
    all_probs   = []
    per_pin_moods = []

    for i, url in enumerate(image_urls):
        try:
            image = load_image(url)
            probs = classify_image(image)
            all_probs.append(probs)

            # top 3 moods for this pin, normalized to sum to 1
            indexed = sorted(enumerate(probs), key=lambda x: x[1], reverse=True)[:3]
            top3_sum = sum(s for _, s in indexed)
            per_pin_moods.append({
                "url": url,
                "moods": [
                    {
                        "label": SUBCATEGORY_MAP.get(MOOD_LABELS[idx], MOOD_LABELS[idx]),
                        "score": round(s / top3_sum, 4)
                    }
                    for idx, s in indexed
                ]
            })
            print(f"  [{i+1}/{len(image_urls)}] classified")
        except Exception as e:
            print(f"  [{i+1}/{len(image_urls)}] skipped — {e}")
            per_pin_moods.append({"url": url, "moods": []})

    if not all_probs:
        raise ValueError("No images could be classified.")

    # ── Board-level aggregate ─────────────────────────────────────────
    n     = len(all_probs)
    probs = [sum(p[i] for p in all_probs) / n for i in range(len(MOOD_LABELS))]

    # top 3 board moods — resolve subcategories and deduplicate parents
    indexed = sorted(enumerate(probs), key=lambda x: x[1], reverse=True)
    seen_parents = {}
    for idx, s in indexed:
        parent = SUBCATEGORY_MAP.get(MOOD_LABELS[idx], MOOD_LABELS[idx])
        if parent not in seen_parents:
            seen_parents[parent] = s
        if len(seen_parents) == 3:
            break

    top3_sum = sum(seen_parents.values())
    board_moods = [
        {"label": parent, "score": round(s / top3_sum, 4)}
        for parent, s in seen_parents.items()
    ]

    top_mood = MOOD_LABELS[probs.index(max(probs))]
    print(f"\n── Board mood fingerprint — top: {top_mood}")
    print(f"── Board top 3: {[m['label'] for m in board_moods]}")

    print("\n── Fetching recommendations...")
    recs, mood = board_to_recommendations(probs)

    if "content" not in recs:
        print(f"ReccoBeats error: {recs.get('detail', 'Unknown error')}")
        return []

    print(f"── Received {len(recs['content'])} candidates, filtering with CLIP...")
    playlist = filter_to_final_playlist(recs, mood)

    return playlist, mood, per_pin_moods, board_moods


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    TEST_IMAGES = [
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTNSKRJGKtVXqi19M9-Ks-CtckHJszXj1swRg&s",
    ]
    playlist = run_pipeline(TEST_IMAGES)
    print(playlist)
