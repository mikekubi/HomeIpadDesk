/***************
 * CONFIG
 ***************/
const OPENWEATHER_API_KEY = "de1bae0f43adc5830a584c08a6d2fe92";
const SPOTIFY_CLIENT_ID   = "099eefbf36214b4e93d0b19bba79ffc8";

// Arnhem default (you can switch to navigator.geolocation if you want)
const DEFAULT_LAT = 51.9851;
const DEFAULT_LON = 5.8987;
const LOCATION_LABEL = "Arnhem";

/***************
 * UI helpers
 ***************/
const el = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, "0");

function fmtTime(d){
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDate(d){
  return d.toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric" });
}

function setText(id, text){ el(id).textContent = text; }

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
 * Quotes (daily)
 ***************/
async function loadDailyQuote(){
  try {
    const res = await fetch("https://api.quotable.io/random?maxLength=140");
    if (!res.ok) throw new Error("Quote fetch failed");

    const data = await res.json();
    setText("quoteText", data.content || "—");
    setText("quoteAuthor", data.author ? `— ${data.author}` : "");
  } catch (err) {
    console.error(err);
    setText("quoteText", "Stay curious. Stay building.");
    setText("quoteAuthor", "");
  }
}

/***************
 * Weather + sunrise/sunset (OpenWeather)
 ***************/
async function loadWeather(lat=DEFAULT_LAT, lon=DEFAULT_LON){
  setText("locationLabel", LOCATION_LABEL);

  if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY.includes("PASTE_")) {
    setText("weatherDesc", "Add OpenWeather API key");
    return;
  }

  // Current weather endpoint
  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("appid", OPENWEATHER_API_KEY);
  url.searchParams.set("units", "metric");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    setText("weatherDesc", "Weather unavailable");
    return;
  }

  const data = await res.json();
  const temp = Math.round(data.main?.temp);
  const desc = data.weather?.[0]?.description ?? "—";

  // sunrise/sunset are UNIX seconds (UTC). Convert using local time.
  const sunrise = new Date((data.sys?.sunrise ?? 0) * 1000);
  const sunset  = new Date((data.sys?.sunset  ?? 0) * 1000);

  setText("weatherTemp", Number.isFinite(temp) ? `${temp}°` : "--°");
  setText("weatherDesc", desc.charAt(0).toUpperCase() + desc.slice(1));
  setText("sunrise", fmtTime(sunrise));
  setText("sunset", fmtTime(sunset));
  setText("updatedLabel", `Updated ${fmtTime(new Date())}`);
}

/***************
 * Spotify PKCE (client-only)
 * - No client secret needed
 * - Token stored in localStorage
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
  // must match exactly what you put in Spotify app settings
  // For GitHub pages root:
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

async function spotifyRefreshIfNeeded(){
  const access = load("sp_access_token");
  const refresh = load("sp_refresh_token");
  const exp = Number(load("sp_token_expires_at") || 0);

  if (!access) return null;
  if (Date.now() < exp - 30_000) return access; // still valid

  if (!refresh) return access; // cannot refresh; hope it works

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

async function spotifyNowPlaying(){
  const access = await spotifyRefreshIfNeeded();
  if (!access) {
    setText("spotifyTrack", "Not connected");
    setText("spotifyArtist", "");
    return;
  }

  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { "Authorization": `Bearer ${access}` },
    cache: "no-store"
  });

  if (res.status === 204) {
    setText("spotifyTrack", "Nothing playing");
    setText("spotifyArtist", "");
    return;
  }
  if (!res.ok) {
    setText("spotifyTrack", "Spotify unavailable");
    setText("spotifyArtist", "");
    return;
  }

  const data = await res.json();
  const item = data?.item;
  const track = item?.name ?? "—";
  const artist = item?.artists?.map(a => a.name).join(", ") ?? "";

  setText("spotifyTrack", track);
  setText("spotifyArtist", artist);
}

function startSpotifyLoop(){
  // Update every 10s
  spotifyNowPlaying();
  setInterval(spotifyNowPlaying, 10_000);
}

/***************
 * Boot
 ***************/
async function boot(){
  startClock();
  await loadDailyQuote();
  await loadWeather();
  await spotifyHandleRedirect();
  startSpotifyLoop();

  el("spotifyBtn").addEventListener("click", spotifyLogin);

  // Refresh quote once per hour (it will still be daily-indexed)
  setInterval(loadDailyQuote, 60 * 60 * 1000);
  // Refresh weather every 10 minutes
  setInterval(loadWeather, 10 * 60 * 1000);
}

boot().catch(err => {
  console.error(err);
  setText("weatherDesc", "Error");
});
