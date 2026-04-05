import { redirectToPinterestAuth, initAuth } from "./auth.js";

const FLASK_URL = "http://localhost:5000";

// ─── Elements ────────────────────────────────────────────────────────────────
const loginSection    = document.getElementById("login-section");
const boardsSection   = document.getElementById("boards-section");
const boardsContainer = document.getElementById("boards-container");
const analyzeBtn      = document.getElementById("analyze-btn");
const selectionCount  = document.getElementById("selection-count");
const demoBtn         = document.getElementById("demo-btn");

// ─── State ───────────────────────────────────────────────────────────────────
const selectedBoards = new Set();

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

// ─── Render boards ───────────────────────────────────────────────────────────
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

    card.addEventListener("click", () => toggleBoard(card, board.id));
    boardsContainer.appendChild(card);
  });
}

// ─── Board selection ─────────────────────────────────────────────────────────
function toggleBoard(card, id) {
  if (selectedBoards.has(id)) {
    selectedBoards.delete(id);
    card.classList.remove("selected");
  } else {
    selectedBoards.add(id);
    card.classList.add("selected");
  }

  const count = selectedBoards.size;

  if (count > 0) {
    analyzeBtn.classList.add("visible");
    selectionCount.classList.add("visible");
    selectionCount.textContent = `${count} board${count !== 1 ? "s" : ""} selected`;
  } else {
    analyzeBtn.classList.remove("visible");
    selectionCount.classList.remove("visible");
  }
}

// ─── Analyze ─────────────────────────────────────────────────────────────────
analyzeBtn.addEventListener("click", async () => {
  if (!selectedBoards.size) return;

  analyzeBtn.innerHTML = `<div class="spinner"></div> Analyzing…`;
  analyzeBtn.disabled = true;

  try {
    const imageUrls = await fetchAllPinImages([...selectedBoards]);
    console.log(`Fetched ${imageUrls.length} images across ${selectedBoards.size} boards`);

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
    console.log("analyze response:", data);
    renderPlaylist(data.playlist);

  } catch (err) {
    console.error(err);
    document.getElementById("results").innerHTML = `
      <p style="color:var(--muted);font-size:13px;margin-top:16px;">
        Something went wrong. Please try again.
      </p>`;
  } finally {
    analyzeBtn.innerHTML = `Find my music
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>`;
    analyzeBtn.disabled = false;
  }
});

// ─── Fetch pin images ─────────────────────────────────────────────────────────
async function fetchAllPinImages(boardIds) {
  const allUrls = [];

  for (const boardId of boardIds) {
    const resp = await fetch(`${FLASK_URL}/pins/${boardId}`, {
      headers: { "X-Session-ID": sessionId }
    });
    const data = await resp.json();
    const urls = (data.pins ?? []).map(p => p.image_url).filter(Boolean);
    allUrls.push(...urls);
  }

  return allUrls;
}

// ─── Render playlist ─────────────────────────────────────────────────────────
export function renderPlaylist(tracks) {
  const resultsList = document.getElementById("results");

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

  // Scroll to results after playlist renders
  resultsList.scrollIntoView({ behavior: "smooth", block: "start" });
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