// spotifyAuth.js
// Handles Spotify OAuth entirely separately from Pinterest auth.
// The Pinterest session ID travels via OAuth `state` — no localStorage cross-origin issues.

const FLASK_URL = "http://localhost:5000";

// ─── State ────────────────────────────────────────────────────────────────────

let _spotifyConnected = false;

export function isSpotifyConnected() {
  return _spotifyConnected;
}

// ─── initSpotifyAuth ──────────────────────────────────────────────────────────
// Call once in board.js, passing the Pinterest sessionId.
// Wires the connect button and listens for the popup postMessage.

export function initSpotifyAuth(pinterestSessionId) {
  const btn = document.getElementById("spotify-connect-btn");
  if (!btn) return;

  // Popup signals success via postMessage
  window.addEventListener("message", (e) => {
    if (e.data === "spotify_connected") {
      _spotifyConnected = true;
      _markConnected(btn);
    }
  });

  btn.addEventListener("click", async () => {
    if (_spotifyConnected) return;
    await _openSpotifyPopup(pinterestSessionId, btn);
  });
}

// ─── _openSpotifyPopup ────────────────────────────────────────────────────────

async function _openSpotifyPopup(pinterestSessionId, btn) {
  try {
    // Pass the Pinterest session ID as OAuth `state` so the callback page
    // can read it directly from the redirect URL — no localStorage needed.
    const resp = await fetch(
      `${FLASK_URL}/spotify/auth-url?session_id=${encodeURIComponent(pinterestSessionId)}`
    );

    if (!resp.ok) throw new Error(`Auth URL fetch failed: ${resp.status}`);

    const { url } = await resp.json();
    window.open(url, "spotify_auth", "width=500,height=700");
  } catch (err) {
    console.error("Failed to open Spotify auth:", err);
    if (btn) btn.textContent = "Failed — try again";
  }
}

// ─── handleSpotifyCallback ────────────────────────────────────────────────────
// Call this in spotify-callback.html (runs in the popup).
// Reads `code` and `state` (= Pinterest session ID) from the redirect URL,
// exchanges the code with Flask, then signals the opener and closes.

export async function handleSpotifyCallback() {
  const msg       = document.getElementById("msg");
  const params    = new URLSearchParams(window.location.search);
  const code      = params.get("code");
  const sessionId = params.get("state"); // Pinterest session ID forwarded via state

  if (!code || !sessionId) {
    if (msg) msg.textContent = "Missing code or session — close and try again.";
    console.error("Spotify callback missing params:", { code, sessionId });
    return;
  }

  try {
    const resp = await fetch(`${FLASK_URL}/spotify/exchange-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": sessionId   // Flask keys the Spotify token to this same session
      },
      body: JSON.stringify({ code })
    });

    if (resp.ok) {
      if (msg) msg.textContent = "Spotify connected ✓  You can close this tab.";
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage("spotify_connected", "*");
        setTimeout(() => window.close(), 1000);
      }
    } else {
      const err = await resp.json().catch(() => ({}));
      console.error("Spotify token exchange failed:", err);
      if (msg) msg.textContent = "Failed — please try again.";
    }
  } catch (err) {
    console.error("Spotify callback error:", err);
    if (msg) msg.textContent = "Failed — please try again.";
  }
}

// ─── UI helper ────────────────────────────────────────────────────────────────

function _markConnected(btn) {
  btn.innerHTML         = "✓ Spotify connected";
  btn.style.color       = "#1DB954";
  btn.style.borderColor = "#1DB954";
  btn.style.cursor      = "default";
}