import { initAuth } from "./auth.js";

const FLASK_URL = "http://localhost:5000";

// ─── Read board ID from URL ───────────────────────────────────────────────────
// index.html links to board.html?id=BOARD_ID&name=BOARD_NAME
const params  = new URLSearchParams(window.location.search);
const boardId = params.get("id");
const boardName = params.get("name") ?? "Board";

if (!boardId) {
  window.location.href = "index.html";
}

// ─── Elements ────────────────────────────────────────────────────────────────
const boardTitle    = document.getElementById("board-title");
const boardSubtitle = document.getElementById("board-subtitle");
const pinsGrid      = document.getElementById("pins-grid");
const findBtn       = document.getElementById("find-btn");
const playlistBody  = document.getElementById("playlist-body");
const playlistMeta  = document.getElementById("playlist-meta");
const moodBadgeWrap = document.getElementById("mood-badge-wrap");

// ─── Init ─────────────────────────────────────────────────────────────────────
const sessionId = await initAuth();
if (!sessionId) {
  window.location.href = "index.html";
}

boardTitle.textContent = boardName;
await loadPins();

// ─── Spotify ──────────────────────────────────────────────────────────────────
let spotifyConnected = false;

// Listen for the callback popup signaling connection
window.addEventListener("message", (e) => {
  if (e.data === "spotify_connected") {
    spotifyConnected = true;
    const btn = document.getElementById("spotify-connect-btn");
    if (btn) {
      btn.textContent = "✓ Spotify connected";
      btn.style.color = "#1DB954";
      btn.style.borderColor = "#1DB954";
      btn.style.cursor = "default";
    }
  }
});

document.getElementById("spotify-connect-btn")?.addEventListener("click", async () => {
  if (spotifyConnected) return;
  const resp = await fetch(`${FLASK_URL}/spotify/auth-url`);
  const { url } = await resp.json();
  window.open(url, "spotify_auth", "width=500,height=700");
});
// ─── Load and render pins ─────────────────────────────────────────────────────
async function loadPins() {
  pinsGrid.innerHTML = `<div class="spinner"></div>`;

  try {
    const resp = await fetch(`${FLASK_URL}/pins/${boardId}`, {
      headers: { "X-Session-ID": sessionId }
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const pins = data.pins ?? [];

    boardSubtitle.textContent = `${pins.length} pin${pins.length !== 1 ? "s" : ""}`;

    if (!pins.length) {
      pinsGrid.innerHTML = `<p style="color:var(--muted);font-size:13px;">No pins found.</p>`;
      return;
    }

    renderPins(pins);

  } catch (err) {
    console.error("Failed to load pins:", err);
    pinsGrid.innerHTML = `<p style="color:var(--muted);font-size:13px;">Could not load pins.</p>`;
  }
}

function renderPins(pins) {
  pinsGrid.innerHTML = "";

  pins.forEach(pin => {
    const item = document.createElement("div");
    item.className = "pin-item";
    item.innerHTML = `<img src="${pin.image_url}" alt="${pin.title || ''}" loading="lazy" />`;
    pinsGrid.appendChild(item);
  });
}

// ─── Find music ───────────────────────────────────────────────────────────────
findBtn.addEventListener("click", async () => {
  findBtn.disabled = true;
  findBtn.innerHTML = `<div class="spinner"></div> Analyzing…`;

  playlistBody.innerHTML = `
    <div class="playlist-loading">
      <div class="spinner"></div>
      <p>Classifying your pins and finding music…</p>
    </div>`;
  playlistMeta.textContent = "Working…";
  moodBadgeWrap.innerHTML  = "";

  try {
    // Collect image URLs from the already-loaded pins
    const pinResp  = await fetch(`${FLASK_URL}/pins/${boardId}`, {
      headers: { "X-Session-ID": sessionId }
    });
    const pinData  = await pinResp.json();
    const imageUrls = (pinData.pins ?? []).map(p => p.image_url).filter(Boolean);

    const resp = await fetch(`${FLASK_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": sessionId
      },
      body: JSON.stringify({ image_urls: imageUrls })
    });

    if (!resp.ok) throw new Error(`Analyze failed: HTTP ${resp.status}`);

    const data = await resp.json();
    renderPlaylist(data.playlist, data.mood);

  } catch (err) {
    console.error(err);
    playlistBody.innerHTML = `
      <div class="playlist-empty">
        <div class="empty-icon">⚠️</div>
        <p>Something went wrong. Please try again.</p>
      </div>`;
    playlistMeta.textContent = "Error";
  } finally {
    findBtn.disabled = false;
    findBtn.innerHTML = `Find music for this board
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>`;
  }
});

// ─── Render playlist ─────────────────────────────────────────────────────────
function renderPlaylist(tracks, mood) {
  if (!tracks?.length) {
    playlistBody.innerHTML = `
      <div class="playlist-empty">
        <div class="empty-icon">🎵</div>
        <p>No tracks found for this board's mood.</p>
      </div>`;
      // Show Save to Spotify button below the track list
    return;
  }

  // Mood badge
  if (mood) {
    moodBadgeWrap.innerHTML = `<span class="mood-badge">✦ ${mood}</span>`;
  }

  playlistMeta.textContent = `${tracks.length} tracks · based on your pins`;

  const list = document.createElement("div");
  list.className = "track-list";

  tracks.forEach((track, i) => {
    const item = document.createElement("a");
    item.className = "track-item";
    item.href      = track.href ?? "#";
    item.target    = "_blank";
    item.rel       = "noopener noreferrer";

    const thumb = track.thumbnail
      ? `<img class="track-thumb" src="${track.thumbnail}" alt="${track.name}" loading="lazy" onerror="this.style.display='none'" />`
      : `<div class="track-thumb-placeholder">♪</div>`;

    item.innerHTML = `
      <span class="track-num">${i + 1}</span>
      ${thumb}
      <div class="track-info">
        <div class="track-name">${track.name}</div>
        <div class="track-artist">${track.artist}</div>
      </div>
      <span class="track-link">Open ↗</span>
    `;
    list.appendChild(item);
  });

  playlistBody.innerHTML = "";
  playlistBody.appendChild(list);
  renderSpotifyButton(tracks, mood);
}



function renderSpotifyButton(tracks, mood) {
  // Remove any existing button
  document.getElementById("spotify-action")?.remove();

  const wrap = document.createElement("div");
  wrap.id = "spotify-action";
  wrap.style.cssText = "padding:16px 0 0;";

  wrap.innerHTML = `
    <button id="save-spotify-btn" style="
      display:flex; align-items:center; justify-content:center; gap:8px;
      width:100%; padding:14px;
      background:#1DB954; color:#000;
      border:none; border-radius:50px;
      font-family:'DM Sans',sans-serif; font-size:15px; font-weight:600;
      cursor:pointer; transition:background 0.2s;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
      Save playlist to Spotify
    </button>
    <div id="spotify-embed" style="margin-top:16px;display:none;"></div>
  `;

  // Append below the track list inside the playlist card
  document.getElementById("playlist-body").after(wrap);

  document.getElementById("save-spotify-btn").addEventListener("click", async () => {
    if (!spotifyConnected) {
      alert("Connect Spotify first using the button above.");
      return;
    }
    await saveToSpotify(tracks, mood, wrap);
  });
}

async function saveToSpotify(tracks, mood, wrap) {
  const btn = document.getElementById("save-spotify-btn");
  btn.disabled = true;
  btn.textContent = "Creating playlist…";

  try {
    const resp = await fetch(`${FLASK_URL}/spotify/create-playlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": sessionId
      },
      body: JSON.stringify({
        track_ids:  tracks.map(t => t.track_id).filter(Boolean),
        board_name: boardName,
        mood
      })
    });

    const data = await resp.json();

    if (data.needs_auth) {
      btn.disabled = false;
      btn.textContent = "Connect Spotify first ↑";
      return;
    }

    if (!resp.ok) throw new Error(data.error || "Failed");

    // Replace button with embedded player
    btn.style.display = "none";
    const embedWrap = document.getElementById("spotify-embed");
    embedWrap.style.display = "block";
    embedWrap.innerHTML = `
      <iframe
        src="${data.embed_url}"
        width="100%" height="380"
        frameborder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        style="border-radius:12px">
      </iframe>
    `;

  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = "Try again";
  }
}