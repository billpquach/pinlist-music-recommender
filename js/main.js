import { redirectToPinterestAuth, initAuth } from "./auth.js";

const FLASK_URL = "http://localhost:5000";

// ─── Elements ────────────────────────────────────────────────────────────────
const loginSection    = document.getElementById("login-section");
const boardsSection   = document.getElementById("boards-section");
const boardsContainer = document.getElementById("boards-container");
const demoBtn         = document.getElementById("demo-btn");

// ─── Init ─────────────────────────────────────────────────────────────────────
const sessionId = await initAuth();

if (!sessionId) {
  loginSection.style.display  = "block";
  boardsSection.style.display = "none";
  document.getElementById("login-btn")
    .addEventListener("click", redirectToPinterestAuth);
} else {
  loginSection.style.display  = "none";
  boardsSection.style.display = "block";
  await loadBoards(sessionId);
}

// ─── Load boards ─────────────────────────────────────────────────────────────
async function loadBoards(sessionId) {
  boardsContainer.innerHTML = `<div class="spinner"></div>`;

  try {
    const resp = await fetch(`${FLASK_URL}/boards`, {
      headers: { "X-Session-ID": sessionId }
    });

    if (resp.status === 401) {
      localStorage.removeItem("pinclip_session_id");
      window.location.reload();
      return;
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    if (!data.boards?.length) {
      boardsContainer.innerHTML = `<p style="color:var(--muted);font-size:13px;">No public boards found.</p>`;
      return;
    }

    renderBoards(data.boards);

  } catch (err) {
    console.error("Failed to load boards:", err);
    boardsContainer.innerHTML = `
      <p style="color:var(--muted);font-size:13px;">
        Could not load boards. Is Flask running on port 5000?<br>
        <a href="#" id="retry-link">Retry</a>
      </p>`;
    document.getElementById("retry-link")
      ?.addEventListener("click", e => { e.preventDefault(); loadBoards(sessionId); });
  }
}

// ─── Render boards ────────────────────────────────────────────────────────────
// Each card navigates to board.html?id=BOARD_ID&name=BOARD_NAME
function renderBoards(boards) {
  boardsContainer.innerHTML = "";

  boards.forEach(board => {
    const card = document.createElement("div");
    card.className = "board-card";

    const thumb = board.cover_image
      ? `<img class="board-thumb" src="${board.cover_image}"
             alt="${board.name}" loading="lazy"
             onerror="this.style.display='none'" />`
      : `<div class="board-thumb-placeholder">📌</div>`;

    card.innerHTML = `
      ${thumb}
      <div class="board-meta">
        <h3>${board.name}</h3>
        <span>${board.pin_count ?? 0} pins</span>
        ${board.description
          ? `<p class="board-desc">${board.description}</p>`
          : ""}
      </div>
    `;

    card.addEventListener("click", () => {
      const url = `board.html?id=${encodeURIComponent(board.id)}&name=${encodeURIComponent(board.name)}`;
      window.location.href = url;
    });

    boardsContainer.appendChild(card);
  });
}

// ─── Demo ─────────────────────────────────────────────────────────────────────
demoBtn?.addEventListener("click", () => {
  renderPlaylist([
    { name: "Holocene",        artist: "Bon Iver",         href: "https://open.spotify.com/track/7DfFc7a6Rwfi3YQMRbDMau" },
    { name: "Motion Sickness", artist: "Phoebe Bridgers",  href: "https://open.spotify.com/track/2Co0IjcLTSHMtodwD4gzfg" },
    { name: "Nuvole Bianche",  artist: "Ludovico Einaudi", href: "https://open.spotify.com/track/5l9c6bJmzvftumhz4TMPgk" },
    { name: "Skinny Love",     artist: "Bon Iver",         href: "https://open.spotify.com/track/7oK9VyNzrYvRFo7nQEYkWN" },
    { name: "Re: Stacks",      artist: "Bon Iver",         href: "https://open.spotify.com/track/4ww0eMBPmGP8xUNkCkrFfr" },
  ]);
});

// ─── Render playlist (demo only) ─────────────────────────────────────────────
function renderPlaylist(tracks) {
  const resultsList = document.getElementById("results");
  if (!resultsList) return;

  if (!tracks?.length) {
    resultsList.innerHTML = `<p style="color:var(--muted);font-size:13px;">No tracks found.</p>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "track-list";

  tracks.forEach((track, i) => {
    const item = document.createElement("a");
    item.className = "track-item";
    item.href      = track.href ?? "#";
    item.target    = "_blank";
    item.rel       = "noopener noreferrer";
    item.innerHTML = `
      <span class="track-num">${i + 1}</span>
      <div class="track-info">
        <div class="track-name">${track.name}</div>
        <div class="track-artist">${track.artist}</div>
      </div>
      <span class="track-link">Open ↗</span>
    `;
    list.appendChild(item);
  });

  resultsList.innerHTML = "";
  resultsList.appendChild(list);
  resultsList.scrollIntoView({ behavior: "smooth", block: "start" });
}