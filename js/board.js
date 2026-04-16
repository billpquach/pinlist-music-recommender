import { initAuth } from "./auth.js";
import { initSpotifyAuth, isSpotifyConnected } from "./spotifyAuth.js";

const FLASK_URL = "http://localhost:5000";

// ─── URL params ───────────────────────────────────────────────────────────────
const params    = new URLSearchParams(window.location.search);
const boardId   = params.get("id");
const boardName = params.get("name") ?? "Board";

if (!boardId) window.location.href = "index.html";

// ─── Elements ─────────────────────────────────────────────────────────────────
const boardTitle         = document.getElementById("board-title");
const boardSubtitle      = document.getElementById("board-subtitle");
const pinsGrid           = document.getElementById("pins-grid");
const findBtn            = document.getElementById("find-btn");
const playlistBody       = document.getElementById("playlist-body");
const playlistMeta       = document.getElementById("playlist-meta");
const moodBadgeWrap      = document.getElementById("mood-badge-wrap");
const playlistActionRow  = document.getElementById("playlist-action-row");
const saveSpotifyInline  = document.getElementById("save-spotify-btn-inline");
const shareBtnInline     = document.getElementById("share-btn-inline");
const shareBtnHero       = document.getElementById("share-btn-hero");
const selectHint         = document.getElementById("select-hint");
const spotifyEmbed       = document.getElementById("spotify-embed");
const loadingOverlay   = document.getElementById("loading-overlay");
// modal elements
const shareModal         = document.getElementById("share-modal");
const modalClose         = document.getElementById("modal-close");
const modalCancel        = document.getElementById("modal-cancel");
const modalPinsGrid      = document.getElementById("modal-pins-grid");
const pinSelCount        = document.getElementById("pin-sel-count");
const trackSwapList      = document.getElementById("track-swap-list");
const modalDownload      = document.getElementById("modal-download");
const modalShareExplore  = document.getElementById("modal-share-explore");
const scCollage          = document.getElementById("sc-collage");
const scTracks           = document.getElementById("sc-tracks");
const scBoardName        = document.getElementById("sc-board-name");
const scMoodBadge        = document.getElementById("sc-mood-badge");

// screenshot overlay
const screenshotOverlay  = document.getElementById("screenshot-overlay");
const screenshotClose    = document.getElementById("screenshot-close");

// ─── State ────────────────────────────────────────────────────────────────────
let allPins        = [];
let currentTracks  = [];
let currentMood    = "";
let selectedPinUrls   = [];
let selectedTrackIds  = [];
let currentPlaylistId = "";
let pinMoods          = {};   // image_url → [{label, score}, ...]
let boardMoods        = [];   // [{label, score}, ...] top 3 aggregate

// ─── Init ─────────────────────────────────────────────────────────────────────
const sessionId = await initAuth();
if (!sessionId) window.location.href = "index.html";

boardTitle.textContent  = boardName;
scBoardName.textContent = boardName;

await loadPins();
initSpotifyAuth(sessionId, () => {
  // If a playlist was already generated, auto-save it once Spotify connects
  if (currentTracks.length && saveSpotifyInline && !saveSpotifyInline.textContent.includes("Saved")) {
    saveToSpotify();
  }
});

// ─── Load pins ────────────────────────────────────────────────────────────────
async function loadPins() {
  pinsGrid.innerHTML = `<div class="spinner"></div>`;
  try {
    const resp = await fetch(`${FLASK_URL}/pins/${boardId}`, {
      headers: { "X-Session-ID": sessionId }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    allPins = data.pins ?? [];
    boardSubtitle.textContent = `${allPins.length} pin${allPins.length !== 1 ? "s" : ""}`;
    if (!allPins.length) {
      pinsGrid.innerHTML = `<p style="color:var(--muted);font-size:13px;">No pins found.</p>`;
      return;
    }
    renderPins(allPins);
  } catch (err) {
    console.error("Failed to load pins:", err);
    pinsGrid.innerHTML = `<p style="color:var(--muted);font-size:13px;">Could not load pins.</p>`;
  }
}

// ─── Render pins — masonry ────────────────────────────────────────────────────
function renderPins(pins) {
  pinsGrid.innerHTML = "";
  pins.forEach(pin => {
    const item = document.createElement("div");
    item.className   = "pin-item";
    item.dataset.url = pin.image_url;
    item.innerHTML = `
      <img src="${pin.image_url}" alt="${pin.title || ""}" loading="lazy"
        style="width:100%;height:auto;display:block;" />
      <div class="pin-check">✓</div>
    `;
    pinsGrid.appendChild(item);
  });
}

// ─── Pin selection ────────────────────────────────────────────────────────────
function enablePinSelection() {
  selectHint.style.display = "inline";

  document.querySelectorAll(".pin-item").forEach(item => {
    item.classList.add("selectable");
    const url   = item.dataset.url;
    const moods = pinMoods[url] ?? [];

    // ── build mood overlay ──────────────────────────────────────
    const overlay = document.createElement("div");
    overlay.className = "pin-mood-overlay";

    moods.forEach(m => {
      overlay.innerHTML += `
        <div class="mood-bar-row">
          <span class="mood-bar-label">${m.label}</span>
          <div class="mood-bar-track">
            <div class="mood-bar-fill" style="width:${Math.round(m.score * 100)}%"></div>
          </div>
        </div>`;
    });

    item.appendChild(overlay);

    // ── (i) button — mobile only (CSS hides on desktop) ─────────
    const infoBtn = document.createElement("button");
    infoBtn.className   = "pin-info-btn";
    infoBtn.textContent = "i";
    infoBtn.addEventListener("click", e => {
      e.stopPropagation();   // don't trigger pin selection
      const isOpen = item.classList.contains("mood-visible");
      // close any other open overlays first
      document.querySelectorAll(".pin-item.mood-visible")
        .forEach(el => el.classList.remove("mood-visible"));
      if (!isOpen) item.classList.add("mood-visible");
    });

    item.appendChild(infoBtn);

    // ── pin body click = select (existing behaviour) ─────────────
    item.addEventListener("click", () => togglePinSelection(item));
  });
}

function togglePinSelection(item) {
  const url = item.dataset.url;
  if (item.classList.contains("selected")) {
    item.classList.remove("selected");
    selectedPinUrls = selectedPinUrls.filter(u => u !== url);
  } else {
    if (selectedPinUrls.length >= 5) return;
    item.classList.add("selected");
    selectedPinUrls.push(url);
  }
  syncModalPinGrid();
  updateShareCard();
}

// ─── Find music ───────────────────────────────────────────────────────────────
findBtn.addEventListener("click", async () => {
  // Show overlay and reset steps
  loadingOverlay.classList.add("visible");
  const steps = [1, 2, 3, 4].map(n => document.getElementById(`step-${n}`));
  steps.forEach(s => s.classList.remove("active", "done"));

  try {
    // Step 1: Processing
    steps[0].classList.add("active");
    const pinResp = await fetch(`${FLASK_URL}/pins/${boardId}`, {
      headers: { "X-Session-ID": sessionId }
    });
    const pinData = await pinResp.json();
    const imageUrls = (pinData.pins ?? []).map(p => p.image_url).filter(Boolean);
    steps[0].classList.replace("active", "done");

    // Step 2: Classifying
    steps[1].classList.add("active");
    const resp = await fetch(`${FLASK_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-ID": sessionId },
      body: JSON.stringify({ image_urls: imageUrls })
    });
    if (!resp.ok) throw new Error(`Analyze failed: HTTP ${resp.status}`);
    const data = await resp.json();
    steps[1].classList.replace("active", "done");

    // Step 3 & 4: Finalizing
    steps[2].classList.add("active");
    currentTracks = data.playlist ?? [];
    currentMood   = data.mood ?? "";
    boardMoods    = data.board_moods ?? [];
    
    pinMoods = {};
    (data.per_pin_moods ?? []).forEach(entry => {
      pinMoods[entry.url] = entry.moods;
    });
    steps[2].classList.replace("active", "done");

    steps[3].classList.add("active");
    renderPlaylist(currentTracks, currentMood, boardMoods);
    enablePinSelection();

    selectedTrackIds = currentTracks.slice(0, 4).map((_, i) => i);
    updateShareCard();
    steps[3].classList.replace("active", "done");

    // UI Updates
    playlistActionRow.style.display = "flex";
    saveSpotifyInline.disabled = false;
    shareBtnInline.classList.add("enabled");
    shareBtnHero.classList.add("enabled");

  } catch (err) {
    console.error(err);
    alert("Something went wrong during analysis.");
  } finally {
    // Hide overlay after a short delay
    setTimeout(() => {
      loadingOverlay.classList.remove("visible");
    }, 500);
  }
});

// ─── Render playlist ──────────────────────────────────────────────────────────
function renderPlaylist(tracks, mood, bMoods = []) {
  if (!tracks?.length) {
    playlistBody.innerHTML = `
      <div class="playlist-empty">
        <div class="empty-icon">🎵</div>
        <p>No tracks found for this board's mood.</p>
      </div>`;
    return;
  }

  if (mood) {
    // primary mood badge
    let badgeHtml = `<span class="mood-badge">✦ ${mood}</span>`;
    // secondary mood words (2nd and 3rd only — 1st is already the badge)
    bMoods.slice(1).forEach(m => {
      badgeHtml += `<span class="mood-badge" style="opacity:0.7;">✦ ${m.label}</span>`;
    });
    moodBadgeWrap.innerHTML = badgeHtml;
    scMoodBadge.textContent = mood;
  }

  // board mood bars below the badges
  if (bMoods.length) {
    const barsWrap = document.createElement("div");
    barsWrap.className = "board-mood-bars";
    bMoods.forEach(m => {
      barsWrap.innerHTML += `
        <div class="board-mood-bar-row">
          <div class="board-mood-bar-track">
            <div class="board-mood-bar-fill" style="width:${Math.round(m.score * 100)}%"></div>
          </div>
        </div>`;
    });
    moodBadgeWrap.appendChild(barsWrap);
  }

  playlistMeta.textContent = `${tracks.length} tracks · based on your pins`;

  const list = document.createElement("div");
  list.className = "track-list";

  tracks.forEach((track, i) => {
    const item = document.createElement("a");
    item.className = "track-item";
    item.href   = track.href ?? "#";
    item.target = "_blank";
    item.rel    = "noopener noreferrer";

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

// ─── Save to Spotify ──────────────────────────────────────────────────────────
saveSpotifyInline.addEventListener("click", async () => {
  if (!isSpotifyConnected()) {
    // Kick off the connect popup — saveToSpotify() will fire automatically
    // via the onConnect callback in initSpotifyAuth once auth completes.
    const resp = await fetch(`${FLASK_URL}/spotify/auth-url?session_id=${sessionId}`);
    const data = await resp.json();
    window.open(data.url, "spotify_auth", "width=500,height=700");
    saveSpotifyInline.textContent = "Waiting for Spotify…";
    return;
  }
  await saveToSpotify();
});

async function saveToSpotify() {
  saveSpotifyInline.disabled    = true;
  saveSpotifyInline.textContent = "Creating playlist…";

  try {
    const resp = await fetch(`${FLASK_URL}/spotify/create-playlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-ID": sessionId },
      body: JSON.stringify({
        track_ids:  currentTracks.map(t => t.track_id).filter(Boolean),
        board_name: boardName,
        mood:       currentMood
      })
    });

    const data = await resp.json();

    if (data.needs_auth) {
      saveSpotifyInline.disabled    = false;
      saveSpotifyInline.textContent = "Connect Spotify first ↑";
      return;
    }
    if (!resp.ok) throw new Error(data.error || "Failed");

    currentPlaylistId = data.playlist_id ?? "";
    saveSpotifyInline.textContent = "✓ Saved";
    spotifyEmbed.innerHTML = `
      <iframe
        src="${data.embed_url}"
        width="100%" height="200"
        frameborder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        style="border-radius:12px; margin-top:12px;">
      </iframe>`;

  } catch (err) {
    console.error(err);
    saveSpotifyInline.disabled    = false;
    saveSpotifyInline.textContent = "Try again";
  }
}

// ─── Share modal ──────────────────────────────────────────────────────────────
function openShareModal() {
  if (!currentTracks.length) return;
  buildModalPinGrid();
  buildTrackSwapList();
  updateShareCard();
  shareModal.classList.add("open");
}

function closeShareModal() {
  shareModal.classList.remove("open");
}

shareBtnInline.addEventListener("click", () => {
  if (shareBtnInline.classList.contains("enabled")) openShareModal();
});
shareBtnHero.addEventListener("click", () => {
  if (shareBtnHero.classList.contains("enabled")) openShareModal();
});
modalClose.addEventListener("click",  closeShareModal);
modalCancel.addEventListener("click", closeShareModal);
shareModal.addEventListener("click",  e => { if (e.target === shareModal) closeShareModal(); });

// ─── Modal pin grid ───────────────────────────────────────────────────────────
function buildModalPinGrid() {
  modalPinsGrid.innerHTML = "";
  allPins.forEach(pin => {
    const item = document.createElement("div");
    item.className   = "modal-pin-item";
    item.dataset.url = pin.image_url;
    if (selectedPinUrls.includes(pin.image_url)) item.classList.add("selected");

    const num = selectedPinUrls.indexOf(pin.image_url) + 1;
    item.innerHTML = `
      <img src="${pin.image_url}" alt="" loading="lazy" />
      <div class="pin-num">${num || ""}</div>
    `;
    item.addEventListener("click", () => toggleModalPin(item, pin.image_url));
    modalPinsGrid.appendChild(item);
  });
  updatePinCount();
}

function toggleModalPin(item, url) {
  if (item.classList.contains("selected")) {
    item.classList.remove("selected");
    selectedPinUrls = selectedPinUrls.filter(u => u !== url);
    document.querySelectorAll(".pin-item")
      .forEach(el => { if (el.dataset.url === url) el.classList.remove("selected"); });
  } else {
    if (selectedPinUrls.length >= 5) return;
    item.classList.add("selected");
    selectedPinUrls.push(url);
    document.querySelectorAll(".pin-item")
      .forEach(el => { if (el.dataset.url === url) el.classList.add("selected"); });
  }
  syncModalPinGrid();
  updateShareCard();
}

function syncModalPinGrid() {
  document.querySelectorAll(".modal-pin-item").forEach(item => {
    const idx   = selectedPinUrls.indexOf(item.dataset.url);
    const numEl = item.querySelector(".pin-num");
    if (idx >= 0) {
      item.classList.add("selected");
      if (numEl) numEl.textContent = idx + 1;
    } else {
      item.classList.remove("selected");
      if (numEl) numEl.textContent = "";
    }
  });
  updatePinCount();
}

function updatePinCount() {
  const n = selectedPinUrls.length;
  pinSelCount.textContent    = `${n} / 5`;
  const ready                = n >= 3 && n <= 5 && selectedTrackIds.length >= 1;
  modalDownload.disabled     = !ready;
  modalShareExplore.disabled = !ready;
}

// ─── Track swap ───────────────────────────────────────────────────────────────
function buildTrackSwapList() {
  const heading = trackSwapList.querySelector("h4");
  trackSwapList.innerHTML = "";
  trackSwapList.appendChild(heading);

  currentTracks.forEach((track, i) => {
    const row = document.createElement("div");
    row.className   = "swap-track" + (selectedTrackIds.includes(i) ? " active" : "");
    row.dataset.idx = i;

    const thumb = track.thumbnail
      ? `<img src="${track.thumbnail}" alt="${track.name}" />`
      : `<div style="width:30px;height:30px;border-radius:5px;background:var(--color-border);flex-shrink:0;"></div>`;

    row.innerHTML = `
      ${thumb}
      <div class="swap-track-info">
        <div class="swap-track-name">${track.name}</div>
        <div class="swap-track-artist">${track.artist}</div>
      </div>
      <div class="swap-check">${selectedTrackIds.includes(i) ? "✓" : ""}</div>
    `;
    row.addEventListener("click", () => toggleTrackSwap(i));
    trackSwapList.appendChild(row);
  });
}

function toggleTrackSwap(idx) {
  if (selectedTrackIds.includes(idx)) {
    if (selectedTrackIds.length <= 1) return;
    selectedTrackIds = selectedTrackIds.filter(i => i !== idx);
  } else {
    if (selectedTrackIds.length >= 4) selectedTrackIds.shift();
    selectedTrackIds.push(idx);
  }
  document.querySelectorAll(".swap-track").forEach(row => {
    const i = parseInt(row.dataset.idx);
    row.classList.toggle("active", selectedTrackIds.includes(i));
    row.querySelector(".swap-check").textContent = selectedTrackIds.includes(i) ? "✓" : "";
  });
  updateShareCard();
  updatePinCount();
}

// ─── Share card preview ───────────────────────────────────────────────────────
function updateShareCard() {
  renderCollage();
  renderCardTracks();
  renderCardMoods();
}
// ─── Share card mood bars ─────────────────────────────────────────────────────
function renderCardMoods() {
  const wrap = document.getElementById("sc-mood-bars");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!boardMoods.length) return;

  const label = document.createElement("div");
  label.style.cssText = "font-size:0.65rem;text-transform:uppercase;letter-spacing:0.22em;color:var(--color-secondary-text);margin-bottom:6px;";
  label.textContent = "Board Mood";
  wrap.appendChild(label);

  boardMoods.forEach(m => {
    wrap.innerHTML += `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <span style="font-size:0.62rem;font-weight:600;color:var(--color-secondary-text);
          text-transform:capitalize;min-width:110px;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis;">${m.label}</span>
        <div style="flex:1;height:4px;background:var(--color-border);border-radius:999px;overflow:hidden;">
          <div style="height:100%;border-radius:999px;background:var(--color-accent);
            width:${Math.round(m.score * 100)}%;"></div>
        </div>
      </div>`;
  });
}

function renderCollage() {
  scCollage.innerHTML = "";

  if (!selectedPinUrls.length) {
    scCollage.innerHTML = `
      <p style="padding:24px;font-size:0.82rem;
        color:var(--color-secondary-text);text-align:center;">
        Select pins to build your collage
      </p>`;
    return;
  }

  // CSS columns masonry — same as boardList.html
  const cols = selectedPinUrls.length <= 4 ? 2 : 3;
  scCollage.style.cssText = `
    display: block;
    columns: ${cols};
    column-gap: 6px;
    padding: 6px;
  `;

  const heights = [160, 220, 180, 200, 140, 190, 170, 210, 150, 185, 165, 195];

  selectedPinUrls.forEach((url, i) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      break-inside: avoid;
      margin-bottom: 6px;
      border-radius: 12px;
      overflow: hidden;
      height: ${heights[i % heights.length]}px;
    `;
    const img   = document.createElement("img");
    img.src     = url;
    img.alt     = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
    wrap.appendChild(img);
    scCollage.appendChild(wrap);
  });
}

function renderCardTracks() {
  scTracks.innerHTML = "";
  selectedTrackIds.slice(0, 4).forEach(idx => {
    const track = currentTracks[idx];
    if (!track) return;
    const div = document.createElement("div");
    div.className = "sc-track";
    const thumb = track.thumbnail
      ? `<img src="${track.thumbnail}" alt="${track.name}" />`
      : `<div style="width:28px;height:28px;border-radius:5px;background:var(--color-border);flex-shrink:0;"></div>`;
    div.innerHTML = `
      ${thumb}
      <div class="sc-track-info">
        <div class="sc-track-name">${track.name}</div>
        <div class="sc-track-artist">${track.artist}</div>
      </div>
    `;
    scTracks.appendChild(div);
  });
}

// ─── Screenshot mode ──────────────────────────────────────────────────────────
modalDownload.addEventListener("click", () => {
  const card       = document.getElementById("share-card");
  const previewCol = document.querySelector(".modal-preview-col");
  screenshotOverlay.insertBefore(card, screenshotOverlay.firstChild);
  screenshotOverlay.classList.add("open");
  shareModal.classList.remove("open");
});

screenshotClose.addEventListener("click", () => {
  const card       = document.getElementById("share-card");
  const previewCol = document.querySelector(".modal-preview-col");
  previewCol.appendChild(card);
  screenshotOverlay.classList.remove("open");
  shareModal.classList.add("open");
});

// ─── Share to Explore ─────────────────────────────────────────────────────────
modalShareExplore.addEventListener("click", async () => {
  modalShareExplore.disabled    = true;
  modalShareExplore.textContent = "Sharing…";

  try {
    const resp = await fetch(`${FLASK_URL}/explore/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-ID": sessionId },
      body: JSON.stringify({
        board_name:  boardName,
        mood:        currentMood,
        pin_images:  selectedPinUrls,
        tracks:      selectedTrackIds.map(i => currentTracks[i]).filter(Boolean),
        playlist_id: currentPlaylistId || undefined,
        board_moods: boardMoods,
      })
    });

    if (resp.ok) {
      modalShareExplore.textContent = "✓ Shared!";
      setTimeout(closeShareModal, 1200);
    } else {
      throw new Error("Share failed");
    }
  } catch (err) {
    console.error(err);
    modalShareExplore.disabled    = false;
    modalShareExplore.textContent = "Try again";
  }
});