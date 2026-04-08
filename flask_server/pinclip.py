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
]

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
    top_mood     = sorted_moods[0][1]
    seeds        = MOOD_SEEDS.get(top_mood, [])[:5]

    print(f"Top mood:    {top_mood}")
    print(f"Seeds:       {seeds}")

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

def run_pipeline(image_urls: list[str]) -> list[tuple]:
    print(f"\n── Classifying {len(image_urls)} image(s)...")
    probs = aggregate_board_probs(image_urls)

    top_mood = MOOD_LABELS[probs.index(max(probs))]
    print(f"\n── Board mood fingerprint — top: {top_mood}")

    print("\n── Fetching recommendations...")
    recs, mood = board_to_recommendations(probs)

    if "content" not in recs:
        print(f"ReccoBeats error: {recs.get('detail', 'Unknown error')}")
        return []

    print(f"── Received {len(recs['content'])} candidates, filtering with CLIP...")
    playlist = filter_to_final_playlist(recs, mood)

    return playlist, mood


def print_playlist(playlist: list[tuple]) -> None:
    print(f"\n🎵 Final Playlist ({len(playlist)} tracks)\n{'─'*48}")
    for i, (score, name, artist, url, thumbnail, track_id) in enumerate(playlist, 1):
        print(f"  {i:>2}. {name} — {artist}")
        print(f"      {url}")
        print(f"      similarity: {score:.3f}\n")


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    TEST_IMAGES = [
        "https://www.theknot.com/tk-media/images/f2b93b5b-623e-42d4-a76e-8f38d4ed463a",
    ]
    playlist = run_pipeline(TEST_IMAGES)
    print_playlist(playlist)
