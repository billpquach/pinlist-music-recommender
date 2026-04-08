import { redirectToPinterestAuth, initAuth } from "./auth.js";

const FLASK_URL = "http://localhost:5000";

// ─── Elements ────────────────────────────────────────────────────────────────
const loginSection    = document.getElementById("login-section");
const boardsSection   = document.getElementById("boards-section");
const boardsContainer = document.getElementById("boards-container");

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

// ─── Utility ───────────────────────────────────────────────────────────────────
function escapeHtml(value) {
  const escapeMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, char => escapeMap[char]);
}

// ─── Render boards ────────────────────────────────────────────────────────────
// Each card navigates to board.html?id=BOARD_ID&name=BOARD_NAME
function renderBoards(boards) {
  boardsContainer.innerHTML = "";

  boards.forEach(board => {
    const card = document.createElement("article");
    card.className = "board-card";

    const cover = board.cover_image
      ? `<img class="board-thumb" src="${board.cover_image}"
             alt="${escapeHtml(board.name)}" loading="lazy"
             onerror="this.style.display='none'" />`
      : `<div class="board-thumb-placeholder">📌</div>`;

    const description = board.description
      ? `<p class="board-desc">${escapeHtml(board.description)}</p>`
      : "";

    card.innerHTML = `
      <div class="board-thumb-wrapper">${cover}</div>
      <div class="board-meta">
        <div>
          <h3>${escapeHtml(board.name)}</h3>
          ${description}
        </div>
        <div class="board-meta-footer">
          <span class="board-count">${board.pin_count ?? 0} pins</span>
          <span class="board-badge">Explore</span>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      const url = `board.html?id=${encodeURIComponent(board.id)}&name=${encodeURIComponent(board.name)}`;
      window.history.pushState({}, document.title, window.location.href);
      window.location.href = url;
    });

    boardsContainer.appendChild(card);
  });
}
