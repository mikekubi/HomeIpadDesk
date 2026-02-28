/***************
 * CONFIG
 ***************/

const SPOTIFY_CLIENT_ID   = "099eefbf36214b4e93d0b19bba79ffc8";

// Arnhem default (you can change lat/lon later)
const DEFAULT_LAT = 51.9851;
const DEFAULT_LON = 5.8987;
const LOCATION_LABEL = "Arnhem";

/***************
 * UI helpers
 ***************/
const el = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, "0");

function fmtTime(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

/***************
 * Time loop
 ***************/
function startClock() {
  const tick = () => {
    const now = new Date();
    setText("time", fmtTime(now));
    setText("date", fmtDate(now));
  };
  tick();
  setInterval(tick, 1000);
}

/***************
 * Quotes (API + local fallback)
 ***************/
const LOCAL_QUOTES = [
  { text: "Stay curious. Stay building.", author: "" },
  { text: "Small steps, done daily, become big change.", author: "Unknown" },
  { text: "Simplicity is a form of discipline.", author: "Unknown" },
  { text: "Do the next right thing.", author: "Unknown" }
];

function pickDailyLocalQuote() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return LOCAL_QUOTES[day % LOCAL_QUOTES.length];
}

async function loadDailyQuote() {
  try {
    const res = await fetch("https://api.quotable.io/random?maxLength=140", { cache: "no-store" });
    if (!res.ok) throw new Error("Quote fetch failed");
    const data = await res.json();
    setText("quoteText", data.content || pickDailyLocalQuote().text);
    setText("quoteAuthor", data.author ? `— ${data.author}` : "");
  } catch (err) {
    console.error(err);
    const q = pickDailyLocalQuote();
    setText("quoteText", q.text);
    setText("quoteAuthor", q.author ? `— ${q.author}` : "");
  }
}

/***************
 * Weather + sunrise/sunset (Open-Meteo, no key)
 ***************/
async function loadWeather(lat = DEFAULT_LAT, lon = DEFAULT_LON) {
  setText("locationLabel", LOCATION_LABEL);

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("daily", "sunrise,sunset");
    url.searchParams.set("timezone", "Europe/Amsterdam");

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);

    const data = await res.json();

    const temp = Math.round(data.current?.temperature_2m);
    const code = data.current?.weather_code;

    const sunriseISO = data.daily?.sunrise?.[0];
    const sunsetISO = data.daily?.sunset?.[0];

    const sunrise = sunriseISO ? new Date(sunriseISO) : null;
    const sunset = sunsetISO ? new Date(sunsetISO) : null;

    setText("weatherTemp", Number.isFinite(temp) ? `${temp}°` : "--°");
    setText("weatherDesc", weatherCodeToText(code));
    setText("sunrise", sunrise ? fmtTime(sunrise) : "--:--");
    setText("sunset", sunset ? fmtTime(sunset) : "--:--");
    setText("updatedLabel", `Updated ${fmtTime(new Date())}`);
  } catch (err) {
    console.error(err);
    setText("weatherDesc", "Weather unavailable");
  }
}

function weatherCodeToText(code) {
  const map = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Heavy showers",
    82: "Violent showers",
    95: "Thunderstorm"
  };
  if (code === null || code === undefined) return "—";
  return map[code] ?? `Weather (${code})`;
}

/***************
 * Spotify PKCE (client-only)
 ***************/
const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state"
];

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(str) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return new Uint8Array(digest);
}

function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = "";
  const arr = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

function getRedirectUri() {
  return window.location.origin + window.location.pathname;
}

function store(k, v) { localStorage.setItem(k, v); }
function load(k) { return localStorage.getItem(k); }

async function spotifyLogin() {
  if (!SPOTIFY_CLIENT_ID || SPOTIFY_CLIENT_ID.includes("PASTE_")) {
    alert("Add your Spotify Client ID in app.js first.");
    return;
  }

  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));

  store("sp_pkce_verifier", verifier);

  const auth = new URL("https://accounts.spotify.com/authorize");
  auth.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", getRedirectUri());
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  auth.searchParams.set("show_dialog", "false");

  window.location.href = auth.toString();
}

async function spotifyHandleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;

  // Clean URL
  window.history.replaceState({}, document.title, window.location.pathname);

  const verifier = load("sp_pkce_verifier");
  if (!verifier) return;

  const tokenUrl = "https://accounts.spotify.com/api/token";
  const body = new URLSearchParams();
  body.set("client_id", SPOTIFY_CLIENT_ID);
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", getRedirectUri());
  body.set("code_verifier", verifier);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) {
    setText("spotifyTrack", "Spotify auth failed");
    return;
  }

  const tok = await res.json();
  store("sp_access_token", tok.access_token);
  store("sp_refresh_token", tok.refresh_token || "");
  store("sp_token_expires_at", String(Date.now() + (tok.expires_in * 1000)));

  setText("spotifyTrack", "Connected ✓");
}

async function spotifyRefreshIfNeeded() {
  const access = load("sp_access_token");
  const refresh = load("sp_refresh_token");
  const exp = Number(load("sp_token_expires_at") || 0);

  if (!access) return null;
  if (Date.now() < exp - 30_000) return access;

  if (!refresh) return access;

  const tokenUrl = "https://accounts.spotify.com/api/token";
  const body = new URLSearchParams();
  body.set("client_id", SPOTIFY_CLIENT_ID);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refresh);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) return access;

  const tok = await res.json();
  store("sp_access_token", tok.access_token);
  store("sp_token_expires_at", String(Date.now() + (tok.expires_in * 1000)));
  return tok.access_token;
}

/***************
 * Lyrics (improved matching + auto-scroll)
 ***************/
let lastLyricsKey = "";
let lyricsScrollTimer = null;

function stopLyricsScroll() {
  if (lyricsScrollTimer) {
    clearInterval(lyricsScrollTimer);
    lyricsScrollTimer = null;
  }
}

function startLyricsScroll() {
  stopLyricsScroll();
  const win = el("lyricsWindow");
  if (!win) return;

  const maxScroll = win.scrollHeight - win.clientHeight;
  if (maxScroll <= 2) return;

  let direction = 1;
  lyricsScrollTimer = setInterval(() => {
    const max = win.scrollHeight - win.clientHeight;
    if (max <= 2) return;

    win.scrollTop += 0.5 * direction; // scroll speed
    if (win.scrollTop >= max) direction = -1;
    if (win.scrollTop <= 0) direction = 1;
  }, 30);
}

function normalizeTrackTitle(t) {
  if (!t) return "";
  return t
    .replace(/\s*\(.*?\)\s*/g, " ")   // remove (...) like (Remastered), (Live)
    .replace(/\s*\[.*?\]\s*/g, " ")   // remove [...] 
    .replace(/\s*-\s*.*$/g, "")       // remove " - Remastered 2011" etc.
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchLyrics(artist, track) {
  const primaryArtist = (artist || "").split(",")[0].trim();
  const cleanTrack = normalizeTrackTitle(track);

  const key = `${primaryArtist} — ${cleanTrack}`;
  if (key === lastLyricsKey) return;
  lastLyricsKey = key;

  setText("spotifyLyrics", "Loading lyrics…");
  const win = el("lyricsWindow");
  if (win) win.scrollTop = 0;
  stopLyricsScroll();

  const attempts = [
    { a: primaryArtist, t: cleanTrack },
    { a: primaryArtist, t: track }
  ];

  for (const at of attempts) {
    try {
      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(at.a)}/${encodeURIComponent(at.t)}`;
      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) continue;

      const data = await res.json();
      const lyrics = (data?.lyrics || "").trim();
      if (!lyrics) continue;

      const clipped = lyrics.length > 2500 ? (lyrics.slice(0, 2500) + "\n…") : lyrics;
      setText("spotifyLyrics", clipped);

      setTimeout(startLyricsScroll, 150);
      return;
    } catch (err) {
      // try next attempt
      console.error(err);
    }
  }

  setText("spotifyLyrics", "Lyrics unavailable for this track");
}

/***************
 * Now Playing (with album art + lyrics)
 ***************/
async function spotifyNowPlaying() {
  let access = await spotifyRefreshIfNeeded();

  const clearSpotifyUI = (trackText) => {
    setText("spotifyTrack", trackText);
    setText("spotifyArtist", "");
    setText("spotifyAlbum", "");
    setText("spotifyLyrics", "Lyrics will show here (when available).");
    const win = el("lyricsWindow");
    if (win) win.scrollTop = 0;
    stopLyricsScroll();

    const artEl = el("spotifyArt");
    if (artEl) {
      artEl.style.display = "none";
      artEl.removeAttribute("src");
      artEl.alt = "";
    }
  };

  if (!access) {
    clearSpotifyUI("Not connected");
    return;
  }

  let res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${access}` },
    cache: "no-store"
  });

  // 401 recovery: force refresh once and retry
  if (res.status === 401) {
    store("sp_token_expires_at", "0");
    access = await spotifyRefreshIfNeeded();
    res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store"
    });
  }

  if (res.status === 204) {
    clearSpotifyUI("Nothing playing");
    return;
  }

  if (!res.ok) {
    clearSpotifyUI("Spotify unavailable");
    return;
  }

  const data = await res.json();
  const item = data?.item;

  const track = item?.name ?? "—";
  const artist = item?.artists?.map(a => a.name).join(", ") ?? "";
  const album = item?.album?.name ?? "";
  const artUrl = item?.album?.images?.[0]?.url ?? "";

  setText("spotifyTrack", track);
  setText("spotifyArtist", artist);
  setText("spotifyAlbum", album);

  const artEl = el("spotifyArt");
  if (artEl && artUrl) {
    artEl.src = artUrl;
    artEl.alt = album ? `Album art: ${album}` : "Album art";
    artEl.style.display = "block";
  } else if (artEl) {
    artEl.style.display = "none";
    artEl.removeAttribute("src");
    artEl.alt = "";
  }

  // Fetch lyrics (improved matching)
  if (artist && track) fetchLyrics(artist, track);
}

function startSpotifyLoop() {
  spotifyNowPlaying();
  setInterval(spotifyNowPlaying, 10_000);
}

/***************
 * Boot
 ***************/
async function boot() {
  startClock();
  await loadDailyQuote();
  await loadWeather();
  await spotifyHandleRedirect();

  const btn = el("spotifyBtn");
  if (btn) btn.addEventListener("click", spotifyLogin);

  startSpotifyLoop();

  // Quote refresh hourly
  setInterval(loadDailyQuote, 60 * 60 * 1000);

  // Weather refresh every 10 minutes
  setInterval(loadWeather, 10 * 60 * 1000);
}

boot().catch(err => {
  console.error(err);
  setText("weatherDesc", "Error");
});
