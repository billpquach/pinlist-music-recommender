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
}