# test_pinclip_logic.py
# Tests pure logic only — no CLIP import, no model load

import pytest

# ─── Replicate only the constants and pure functions needed ──────────────────

MOOD_LABELS = [
    "dark and moody", "bright and energetic", "calm and peaceful",
    "romantic and dreamy", "edgy and intense", "cozy and warm",
    "melancholic and sad", "euphoric and joyful", "orchestra", "gothic",
    "coastal beach", "preppy", "performative matcha", "performative totebag",
    "performative book", "performative vinyl", "wired earbuds",
    "old money mediterranean outfit", "old money academia outfit",
    "hypebeast", "beach day outfit", "gym bro", "goth",
]

SUBCATEGORY_MAP = {
    "performative matcha":            "performative",
    "performative totebag":           "performative",
    "performative book":              "performative",
    "performative vinyl":             "performative",
    "wired earbuds":                  "performative",
    "old money mediterranean outfit": "old money",
    "old money academia outfit":      "dark academia",
}

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
    "performative":         ["08PdFBcXzpkn1cWNgmKqhn", "3vkCueOmm7xQDoJ17W1Pm3"],
    "old money":            ["78OdnOhPOk19xYhGAKgjCO", "3lAun9V0YdTlCSIEXPvfsY", "0cgcD73SD4nFdTK2oKofzW"],
    "dark academia":        ["2Co0IjcLTSHMtodwD4gzfg"],
    "hypebeast":            ["1e1JKLEDKP7hEQzJfNAgPl"],
    "beach day outfit":     ["3xKsf9qdS1CyvXSMEid6g8"],
    "gym bro":              ["3QFInJAm9eyaho5vBzxInN"],
    "goth":                 ["5dTHtzHFPyi8TlTtzoz1J9", ""],
}

# ─── Pure functions copied from pinclip.py ───────────────────────────────────

def deduplicate_by_artist(scored: list, max_per_artist: int = 2) -> list:
    artist_count = {}
    result = []
    for entry in scored:
        artist = entry[2]
        if artist_count.get(artist, 0) < max_per_artist:
            result.append(entry)
            artist_count[artist] = artist_count.get(artist, 0) + 1
    return result

def make_track(score, title, artist):
    return (score, title, artist, "http://spotify.com", "http://thumb.com", "track_id")

# ─── SUBCATEGORY_MAP Tests ────────────────────────────────────────────────────

def test_subcategory_resolves_performative_matcha():
    assert SUBCATEGORY_MAP["performative matcha"] == "performative"

def test_subcategory_resolves_old_money():
    assert SUBCATEGORY_MAP["old money mediterranean outfit"] == "old money"

def test_subcategory_resolves_dark_academia():
    assert SUBCATEGORY_MAP["old money academia outfit"] == "dark academia"

def test_parent_moods_not_in_subcategory_map():
    assert "performative" not in SUBCATEGORY_MAP
    assert "old money" not in SUBCATEGORY_MAP
    assert "dark academia" not in SUBCATEGORY_MAP

# ─── MOOD_SEEDS Integrity Tests ───────────────────────────────────────────────

def test_mood_seeds_no_empty_strings():
    """Catches the known empty string bug in the goth seed list."""
    for mood, seeds in MOOD_SEEDS.items():
        for seed in seeds:
            assert seed != "", f"Empty seed string found in mood: '{mood}'"

def test_mood_seeds_all_values_are_lists():
    for mood, seeds in MOOD_SEEDS.items():
        assert isinstance(seeds, list), f"Seeds for '{mood}' is not a list"

def test_mood_seeds_no_duplicate_seeds_per_mood():
    for mood, seeds in MOOD_SEEDS.items():
        assert len(seeds) == len(set(seeds)), f"Duplicate seed in mood: '{mood}'"

# ─── deduplicate_by_artist Tests ─────────────────────────────────────────────

def test_deduplicate_caps_artist_at_two():
    tracks = [
        make_track(0.9, "Song A", "Artist X"),
        make_track(0.8, "Song B", "Artist X"),
        make_track(0.7, "Song C", "Artist X"),
    ]
    result = deduplicate_by_artist(tracks)
    assert sum(1 for t in result if t[2] == "Artist X") == 2

def test_deduplicate_preserves_other_artists():
    tracks = [
        make_track(0.9, "Song A", "Artist X"),
        make_track(0.8, "Song B", "Artist X"),
        make_track(0.7, "Song C", "Artist X"),
        make_track(0.6, "Song D", "Artist Y"),
    ]
    result = deduplicate_by_artist(tracks)
    assert any(t[2] == "Artist Y" for t in result)

def test_deduplicate_empty_input():
    assert deduplicate_by_artist([]) == []

def test_deduplicate_single_track():
    tracks = [make_track(0.9, "Song A", "Artist X")]
    assert deduplicate_by_artist(tracks) == tracks

def test_deduplicate_all_unique_artists():
    tracks = [
        make_track(0.9, "Song A", "Artist X"),
        make_track(0.8, "Song B", "Artist Y"),
        make_track(0.7, "Song C", "Artist Z"),
    ]
    assert deduplicate_by_artist(tracks) == tracks

# ─── Aggregation Logic Tests ──────────────────────────────────────────────────

def test_average_aggregation_correct():
    n_labels = len(MOOD_LABELS)
    uniform = [1.0 / n_labels] * n_labels
    all_probs = [uniform, uniform]
    n = len(all_probs)
    result = [sum(p[i] for p in all_probs) / n for i in range(n_labels)]
    assert len(result) == n_labels
    assert abs(sum(result) - 1.0) < 1e-5

def test_aggregation_output_length():
    all_probs = [[1.0 / len(MOOD_LABELS)] * len(MOOD_LABELS)]
    n = len(all_probs)
    result = [sum(p[i] for p in all_probs) / n for i in range(len(MOOD_LABELS))]
    assert len(result) == len(MOOD_LABELS)

def test_aggregation_single_dominant_mood():
    probs = [0.0] * len(MOOD_LABELS)
    probs[0] = 1.0  # dark and moody dominates
    all_probs = [probs]
    n = len(all_probs)
    result = [sum(p[i] for p in all_probs) / n for i in range(len(MOOD_LABELS))]
    assert result[0] == 1.0
    assert result.index(max(result)) == 0