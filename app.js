/***************
 * CONFIG
 ***************/

const SPOTIFY_CLIENT_ID   = "099eefbf36214b4e93d0b19bba79ffc8";


// Arnhem default
const DEFAULT_LAT = 51.9851;
const DEFAULT_LON = 5.8987;
const LOCATION_LABEL = "Arnhem";

/***************
 * UI helpers
 ***************/
const el = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, "0");

function fmtTime(d){ return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtDate(d){
  return d.toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric" });
}
function setText(id, text){
  const node = el(id);
  if (node) node.textContent = text;
}

/***************
 * Time loop
 ***************/
function startClock(){
  const tick = () => {
    const now = new Date();
    setText("time", fmtTime(now));
    setText("date", fmtDate(now));
  };
  tick();
  setInterval(tick, 1000);
}

/***************
 * Daily Quote (from your repo's data/quote.json)
 ***************/
async function loadDailyQuote(){
  try {
    const res = await fetch("./data/quote.json", { cache:"no-store" });
    if (!res.ok) throw new Error("quote.json missing");
    const data = await res.json();

    setText("quoteText", data.quote || "—");
    setText("quoteAuthor", "— Leo Tolstoy");
    setText("quoteMeta", `Calendar of Wisdom • ${data.month} ${data.day}`);

  } catch (err) {
    console.error(err);
    setText("quoteText", "Daily quote unavailable (waiting for the GitHub daily update).");
    setText("quoteAuthor", "");
    setText("quoteMeta", "");
  }
}

/***************
 * Weather + sunrise/sunset (Open-Meteo)
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

    const res = await fetch(url.toString(), { cache:"no-store" });
    if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);

    const data = await res.json();
    const temp = Math.round(data.current?.temperature_2m);
    const code = data.current?.weather_code;

    const sunriseISO = data.daily?.sunrise?.[0];
    const sunsetISO  = data.daily?.sunset?.[0];

    setText("weatherTemp", Number.isFinite(temp) ? `${temp}°` : "--°");
    setText("weatherDesc", weatherCodeToText(code));
    setText("sunrise", sunriseISO ? fmtTime(new Date(sunriseISO)) : "--:--");
    setText("sunset", sunsetISO ? fmtTime(new Date(sunsetISO)) : "--:--");
    setText("updatedLabel", `Updated ${fmtTime(new Date())}`);
  } catch (err) {
    console.error(err);
    setText("weatherDesc", "Weather unavailable");
  }
}

function weatherCodeToText(code) {
  const map = {
    0:"Clear",1:"Mostly clear",2:"Partly cloudy",3:"Overcast",
    45:"Fog",48:"Rime fog",
    51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",
    61:"Light rain",63:"Rain",65:"Heavy rain",
    71:"Light snow",73:"Snow",75:"Heavy snow",
    80:"Rain showers",81:"Heavy showers",82:"Violent showers",
    95:"Thunderstorm"
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
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(str) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return new Uint8Array(digest);
}

function randomString(len=64){
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = "";
  const arr = crypto.getRandomValues(new Uint8Array(len));
  for (let i=0; i<len; i++) out += chars[arr[i] % chars.length];
  return out;
}

function getRedirectUri(){
  return window.location.origin + window.location.pathname;
}

function store(k,v){ localStorage.setItem(k,v); }
function load(k){ return localStorage.getItem(k); }

async function spotifyLogin(){
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

async function spotifyHandleRedirect(){
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;

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
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
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

async function spotifyRefreshIfNeeded(){
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
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) return access;

  const tok = await res.json();
  store("sp_access_token", tok.access_token);
  store("sp_token_expires_at", String(Date.now() + (tok.expires_in * 1000)));
  return tok.access_token;
}

/***************
 * Synced Lyrics (LRCLIB) - simple (no word highlight)
 ***************/
let syncedLyrics = [];
let lastTrackIdForLyrics = "";
let activeLyricIndex = -1;

// local player progress (for sync)
let playerProgressMs = 0;
let playerIsPlaying = false;
let playerStamp = performance.now();

function normalizeTrackTitle(t) {
  if (!t) return "";
  return t
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*\[.*?\]\s*/g, " ")
    .replace(/\s*-\s*.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLrcToLines(lrcText) {
  const lines = [];
  const regex = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/;

  for (const raw of lrcText.split("\n")) {
    const line = raw.trim();
    const m = line.match(regex);
    if (!m) continue;

    const mm = Number(m[1]);
    const ss = Number(m[2]);
    const frac = m[3] ? m[3].padEnd(3, "0") : "000";
    const text = (m[4] || "").trim();

    const timeMs = (mm * 60 + ss) * 1000 + Number(frac);
    if (text) lines.push({ timeMs, text });
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

async function fetchSyncedLyricsLRCLIB(artist, track) {
  const cleanArtist = (artist || "").split(",")[0].trim();
  const cleanTrack = normalizeTrackTitle(track);

  const searchUrl =
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(cleanArtist)}`;

  const res = await fetch(searchUrl, { cache: "no-store" });
  if (!res.ok) return [];

  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return [];

  const best = results[0];
  const lrc = best.syncedLyrics || best.synced_lyrics || best.lrc || "";
  if (!lrc) return [];

  return parseLrcToLines(lrc);
}

function renderLyricLine(text){
  const node = el("spotifyLyrics");
  if (!node) return;
  node.textContent = text;
}

function updateActiveLine(progressMs){
  if (!syncedLyrics.length) return;

  let idx = 0;
  while (idx + 1 < syncedLyrics.length && syncedLyrics[idx + 1].timeMs <= progressMs) idx++;

  if (idx !== activeLyricIndex){
    activeLyricIndex = idx;
    renderLyricLine(syncedLyrics[idx].text);
  }
}

/***************
 * Now Playing
 ***************/
async function spotifyNowPlaying(){
  let access = await spotifyRefreshIfNeeded();
  const btn = el("spotifyBtn");

  const clearSpotifyUI = (trackText) => {
    setText("spotifyTrack", trackText);
    setText("spotifyArtist", "");
    setText("spotifyAlbum", "");

    syncedLyrics = [];
    lastTrackIdForLyrics = "";
    activeLyricIndex = -1;
    renderLyricLine("Lyrics will show here (when available).");

    const artEl = el("spotifyArt");
    if (artEl) {
      artEl.style.display = "none";
      artEl.removeAttribute("src");
      artEl.alt = "";
    }

    if (btn) btn.style.display = "block";
  };

  if (!access) {
    clearSpotifyUI("Not connected");
    return;
  }

  // Hide button when connected
  if (btn) btn.style.display = "none";

  let res = await fetch("https://api.spotify.com/v1/me/player", {
    headers: { "Authorization": `Bearer ${access}` },
    cache: "no-store"
  });

  if (res.status === 401) {
    store("sp_token_expires_at", "0");
    access = await spotifyRefreshIfNeeded();
    res = await fetch("https://api.spotify.com/v1/me/player", {
      headers: { "Authorization": `Bearer ${access}` },
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

  playerProgressMs = Number(data.progress_ms ?? 0);
  playerIsPlaying = Boolean(data.is_playing);
  playerStamp = performance.now();

  const item = data?.item;
  const trackId = item?.id || "";
  const track = item?.name ?? "—";
  const artist = item?.artists?.map(a => a.name).join(", ") ?? "";
  const album = item?.album?.name ?? "";
  const artUrl = item?.album?.images?.[0]?.url ?? "";

  setText("spotifyTrack", track);
  setText("spotifyArtist", artist);
  setText("spotifyAlbum", album);

  const artEl = el("spotifyArt");
  if (artEl) {
    if (artUrl) {
      artEl.src = artUrl;
      artEl.alt = album ? `Album art: ${album}` : "Album art";
      artEl.style.display = "block";
    } else {
      artEl.style.display = "none";
      artEl.removeAttribute("src");
      artEl.alt = "";
    }
  }

  // Fetch lyrics only when track changes
  if (trackId && trackId !== lastTrackIdForLyrics) {
    lastTrackIdForLyrics = trackId;
    activeLyricIndex = -1;
    renderLyricLine("Loading synced lyrics…");

    try {
      syncedLyrics = await fetchSyncedLyricsLRCLIB(artist, track);
      if (!syncedLyrics.length) {
        renderLyricLine("Synced lyrics unavailable for this track");
      } else {
        updateActiveLine(playerProgressMs);
      }
    } catch {
      syncedLyrics = [];
      renderLyricLine("Synced lyrics unavailable for this track");
    }
  } else {
    if (syncedLyrics.length) updateActiveLine(playerProgressMs);
  }
}

/***************
 * Smooth lyric ticker (no extra Spotify calls)
 ***************/
function startLyricTicker(){
  setInterval(() => {
    if (!syncedLyrics.length) return;

    const now = performance.now();
    const delta = now - playerStamp;
    const estProgress = playerIsPlaying ? (playerProgressMs + delta) : playerProgressMs;

    updateActiveLine(estProgress);
  }, 200);
}

function startSpotifyLoop(){
  spotifyNowPlaying();
  setInterval(spotifyNowPlaying, 1000); // poll player
  startLyricTicker();
}

/***************
 * Boot
 ***************/
async function boot(){
  startClock();
  await loadDailyQuote();
  await loadWeather();
  await spotifyHandleRedirect();

  const btn = el("spotifyBtn");
  if (btn) btn.addEventListener("click", spotifyLogin);

  startSpotifyLoop();

  // update quote every hour (in case workflow ran and iPad is still open)
  setInterval(loadDailyQuote, 60 * 60 * 1000);

  // update weather every 10 minutes
  setInterval(loadWeather, 10 * 60 * 1000);
}

boot().catch(err => {
  console.error(err);
  setText("weatherDesc", "Error");
});
