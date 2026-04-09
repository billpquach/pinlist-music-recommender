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

// ─── State ────────────────────────────────────────────────────────────────────
let allPins        = [];   // all pins loaded from Flask
let currentTracks  = [];   // playlist tracks after analysis
let currentMood    = "";

// share card state
let selectedPinUrls  = [];  // ordered list of selected image URLs (max 12)
let selectedTrackIds = [];  // 4 track indices from currentTracks

// ─── Init ─────────────────────────────────────────────────────────────────────
const sessionId = await initAuth();
if (!sessionId) window.location.href = "index.html";

boardTitle.textContent = boardName;
scBoardName.textContent = boardName;

await loadPins();
initSpotifyAuth(sessionId);

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

// ─── Render pins (board view) ─────────────────────────────────────────────────
function renderPins(pins) {
  pinsGrid.innerHTML = "";
  pins.forEach(pin => {
    const item = document.createElement("div");
    item.className = "pin-item";
    item.dataset.url = pin.image_url;
    item.innerHTML = `
      <img src="${pin.image_url}" alt="${pin.title || ""}" loading="lazy" />
      <div class="pin-check">✓</div>
    `;
    pinsGrid.appendChild(item);
  });
}

// ─── Enable pin selection mode ────────────────────────────────────────────────
// Called once a playlist is generated so pins become clickable for the share card
function enablePinSelection() {
  selectHint.style.display = "inline";
  document.querySelectorAll(".pin-item").forEach(item => {
    item.classList.add("selectable");
    item.addEventListener("click", () => togglePinSelection(item), { once: false });
  });
}

function togglePinSelection(item) {
  const url = item.dataset.url;
  if (item.classList.contains("selected")) {
    item.classList.remove("selected");
    selectedPinUrls = selectedPinUrls.filter(u => u !== url);
  } else {
    if (selectedPinUrls.length >= 12) return; // cap at 12
    item.classList.add("selected");
    selectedPinUrls.push(url);
  }
  // keep modal pin grid in sync if open
  syncModalPinGrid();
  updateShareCard();
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
  playlistActionRow.style.display = "none";

  try {
    const pinResp   = await fetch(`${FLASK_URL}/pins/${boardId}`, {
      headers: { "X-Session-ID": sessionId }
    });
    const pinData   = await pinResp.json();
    const imageUrls = (pinData.pins ?? []).map(p => p.image_url).filter(Boolean);

    const resp = await fetch(`${FLASK_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-ID": sessionId },
      body: JSON.stringify({ image_urls: imageUrls })
    });
    if (!resp.ok) throw new Error(`Analyze failed: HTTP ${resp.status}`);

    const data = await resp.json();
    currentTracks = data.playlist ?? [];
    currentMood   = data.mood ?? "";

    renderPlaylist(currentTracks, currentMood);
    enablePinSelection();

    // seed top 4 tracks for share card
    selectedTrackIds = currentTracks.slice(0, 4).map((_, i) => i);
    updateShareCard();

    // show action row
    playlistActionRow.style.display = "flex";
    saveSpotifyInline.disabled = false;

    // enable share buttons
    shareBtnInline.classList.add("enabled");
    shareBtnHero.classList.add("enabled");

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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>`;
  }
});

// ─── Render playlist ──────────────────────────────────────────────────────────
function renderPlaylist(tracks, mood) {
  if (!tracks?.length) {
    playlistBody.innerHTML = `
      <div class="playlist-empty">
        <div class="empty-icon">🎵</div>
        <p>No tracks found for this board's mood.</p>
      </div>`;
    return;
  }

  if (mood) {
    moodBadgeWrap.innerHTML = `<span class="mood-badge">✦ ${mood}</span>`;
    scMoodBadge.textContent = mood;
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

// ─── Save to Spotify (inline button) ─────────────────────────────────────────
saveSpotifyInline.addEventListener("click", async () => {
  if (!isSpotifyConnected()) {
    alert("Connect Spotify first using the button above.");
    return;
  }
  await saveToSpotify();
});

async function saveToSpotify() {
  saveSpotifyInline.disabled = true;
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
      saveSpotifyInline.disabled = false;
      saveSpotifyInline.textContent = "Connect Spotify first ↑";
      return;
    }
    if (!resp.ok) throw new Error(data.error || "Failed");

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
    saveSpotifyInline.disabled = false;
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
shareModal.addEventListener("click", e => {
  if (e.target === shareModal) closeShareModal();
});

// ─── Modal pin grid ───────────────────────────────────────────────────────────
function buildModalPinGrid() {
  modalPinsGrid.innerHTML = "";
  allPins.forEach(pin => {
    const item = document.createElement("div");
    item.className  = "modal-pin-item";
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
    // also deselect in main grid
    const mainItem = [...document.querySelectorAll(".pin-item")]
      .find(el => el.dataset.url === url);
    mainItem?.classList.remove("selected");
  } else {
    if (selectedPinUrls.length >= 12) return;
    item.classList.add("selected");
    selectedPinUrls.push(url);
    const mainItem = [...document.querySelectorAll(".pin-item")]
      .find(el => el.dataset.url === url);
    mainItem?.classList.add("selected");
  }
  syncModalPinGrid();
  updateShareCard();
}

// Re-number the modal pins after any change
function syncModalPinGrid() {
  document.querySelectorAll(".modal-pin-item").forEach(item => {
    const idx = selectedPinUrls.indexOf(item.dataset.url);
    const numEl = item.querySelector(".pin-num");
    if (idx >= 0) {
      item.classList.add("selected");
      if (numEl) numEl.textContent = idx + 1;
    } else {
      item.classList.remove("selected");
    }
  });
  updatePinCount();
}

function updatePinCount() {
  pinSelCount.textContent = `${selectedPinUrls.length} / 12`;
  const ready = selectedPinUrls.length >= 2 && selectedTrackIds.length === 4;
  modalDownload.disabled      = !ready;
  modalShareExplore.disabled  = !ready;
}

// ─── Track swap list ──────────────────────────────────────────────────────────
function buildTrackSwapList() {
  // Keep the h4 heading, replace rest
  const heading = trackSwapList.querySelector("h4");
  trackSwapList.innerHTML = "";
  trackSwapList.appendChild(heading);

  currentTracks.forEach((track, i) => {
    const row = document.createElement("div");
    row.className = "swap-track" + (selectedTrackIds.includes(i) ? " active" : "");
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
    if (selectedTrackIds.length <= 1) return; // keep at least 1
    selectedTrackIds = selectedTrackIds.filter(i => i !== idx);
  } else {
    if (selectedTrackIds.length >= 4) {
      // replace the oldest selection
      selectedTrackIds.shift();
    }
    selectedTrackIds.push(idx);
  }
  // re-render swap list rows
  document.querySelectorAll(".swap-track").forEach(row => {
    const i = parseInt(row.dataset.idx);
    row.classList.toggle("active", selectedTrackIds.includes(i));
    row.querySelector(".swap-check").textContent = selectedTrackIds.includes(i) ? "✓" : "";
  });
  updateShareCard();
  updatePinCount();
}

// ─── Update share card preview ────────────────────────────────────────────────
function updateShareCard() {
  renderCollage();
  renderCardTracks();
}

function renderCollage() {
  scCollage.innerHTML = "";
  if (!selectedPinUrls.length) {
    scCollage.style.minHeight = "60px";
    scCollage.innerHTML = `<p style="padding:16px;font-size:0.8rem;color:var(--color-secondary-text);text-align:center;">Select pins to build your collage</p>`;
    return;
  }

  scCollage.style.minHeight = "180px";

  // Asymmetric layout: scatter polaroids across the collage area
  const positions = generatePositions(selectedPinUrls.length);

  selectedPinUrls.forEach((url, i) => {
    const pos  = positions[i];
    const card = document.createElement("div");
    card.className = "sc-pin";
    card.style.cssText = `
      left: ${pos.x}%;
      top:  ${pos.y}px;
      width: ${pos.w}px;
      height: ${pos.h}px;
      transform: rotate(${pos.rot}deg);
      z-index: ${i + 1};
    `;
    card.innerHTML = `<img src="${url}" alt="" />`;
    scCollage.appendChild(card);
  });

  // Set collage height to fit all pins
  const maxBottom = Math.max(...positions.map(p => p.y + p.h + 28));
  scCollage.style.minHeight = `${Math.max(180, maxBottom + 16)}px`;
}

function generatePositions(count) {
  // Predefined asymmetric layouts for 2–12 pins
  const configs = {
    1:  [{ x: 10, y: 16, w: 120, h: 110, rot: -2  }],
    2:  [
          { x: 5,  y: 12, w: 120, h: 110, rot: -3  },
          { x: 48, y: 20, w: 110, h: 100, rot:  2  },
        ],
    3:  [
          { x: 3,  y: 10, w: 115, h: 105, rot: -4  },
          { x: 42, y: 8,  w: 120, h: 110, rot:  3  },
          { x: 22, y: 90, w: 105, h: 95,  rot: -1  },
        ],
    4:  [
          { x: 2,  y: 8,  w: 110, h: 100, rot: -3  },
          { x: 45, y: 6,  w: 115, h: 105, rot:  4  },
          { x: 5,  y: 95, w: 105, h: 95,  rot:  2  },
          { x: 48, y: 90, w: 110, h: 100, rot: -2  },
        ],
  };

  // For 5+ pins, tile with slight jitter
  if (count <= 4) return configs[count] || configs[1];

  const positions = [];
  const cols = 3;
  const wBase = 90, hBase = 82;
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x:   col * 32 + (Math.random() * 4 - 2),
      y:   row * 95 + 10 + (Math.random() * 8 - 4),
      w:   wBase + Math.floor(Math.random() * 16 - 8),
      h:   hBase + Math.floor(Math.random() * 14 - 7),
      rot: (Math.random() * 8 - 4),
    });
  }
  return positions;
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

// ─── Download card as image ───────────────────────────────────────────────────
modalDownload.addEventListener("click", async () => {
  const card = document.getElementById("share-card");
  modalDownload.textContent = "Rendering…";
  modalDownload.disabled = true;

  try {
    const canvas = await html2canvas(card, {
      scale:            2,
      useCORS:          true,
      backgroundColor:  null,
      logging:          false,
    });

    const link    = document.createElement("a");
    link.download = `pinclip-${boardName.replace(/\s+/g, "-").toLowerCase()}.png`;
    link.href     = canvas.toDataURL("image/png");
    link.click();
  } catch (err) {
    console.error("Download failed:", err);
    alert("Could not render image. Try a different browser.");
  } finally {
    modalDownload.textContent = "↓ Download image";
    modalDownload.disabled = false;
  }
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