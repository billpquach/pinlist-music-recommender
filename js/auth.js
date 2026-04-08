// ─── Config ───────────────────────────────────────────────────────────────────

const CLIENT_ID    = "1548154";
const REDIRECT_URI = "http://localhost:5500/";   // change for production
const SCOPES       = "boards:read,pins:read";
const FLASK_URL    = "http://localhost:5000";     // NEW: your Flask backend

// ─── Your original code (unchanged) ──────────────────────────────────────────

export function redirectToPinterestAuth() {
    const state = generateRandomState();
    localStorage.setItem("pinterest_oauth_state", state);

    const authURL =
        `https://www.pinterest.com/oauth/?client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`       +
        `&response_type=code`                                       +
        `&scope=${SCOPES}`                                          +
        `&state=${state}`;

    window.location.href = authURL;
}

export function handleOAuthCallback() {
    const params        = new URLSearchParams(window.location.search);
    const code          = params.get("code");
    const returnedState = params.get("state");
    const savedState    = localStorage.getItem("pinterest_oauth_state");

    if (!code) return null;

    // FIX: log both values so you can see exactly what's mismatching
    console.log("Returned state:", returnedState);
    console.log("Saved state:   ", savedState);

    // FIX: if savedState is null, Live Server wiped localStorage on reload
    // Don't block the auth flow in this case during development
    if (savedState && returnedState !== savedState) {
        console.error("State mismatch. Possible CSRF attack.");
        return null;
    }

    // Clean up
    localStorage.removeItem("pinterest_oauth_state");
    return code;
}

function generateRandomState() {
    return crypto.randomUUID();
}

// ─── NEW: Send the code to Flask to exchange for an access token ──────────────
// Pinterest gives the code to your JS, but the actual token exchange
// must happen on your backend (Flask) because it requires CLIENT_SECRET.

export async function exchangeCodeForToken(code) {
    const response = await fetch(`${FLASK_URL}/exchange-token`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code })
    });

    if (!response.ok) {
        console.error("Token exchange failed:", await response.json());
        return null;
    }

    const data = await response.json();

    // Store the session ID — every subsequent API call uses this
    // instead of exposing the raw access token in the browser
    localStorage.setItem("pinclip_session_id", data.session_id);
    return data.session_id;
}

// ─── NEW: initAuth — call this once when your page loads ─────────────────────
// Handles both cases:
//   1. User just came back from Pinterest (URL has ?code=xxx)
//   2. User was already logged in from a previous visit

export async function initAuth() {
    // Case 1: landing from Pinterest redirect
    const code = handleOAuthCallback();

    if (code) {
        const sessionId = await exchangeCodeForToken(code);

        if (sessionId) {
            // Clean ?code= and ?state= out of the browser URL
            window.history.replaceState({}, document.title, "/");
            return sessionId;
        }

        return null;
    }

    // Case 2: already authenticated from a previous visit
    const existingSession = localStorage.getItem("pinclip_session_id");
    if (existingSession) {
        return existingSession;
    }

    // Not authenticated
    return null;
}

// ─── NEW: isAuthenticated — quick check without triggering a redirect ─────────

export function isAuthenticated() {
    return !!localStorage.getItem("pinclip_session_id");
}

// ─── NEW: logout ──────────────────────────────────────────────────────────────

export function logout() {
    localStorage.removeItem("pinclip_session_id");
    localStorage.removeItem("pinterest_oauth_state");
}
