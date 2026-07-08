import { generateRandomString, generateCodeChallenge } from './pkce.js?v=8';

const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SCOPES = [
  'user-read-recently-played',
  'user-top-read',
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
];

const KEYS = {
  clientId: 'spotify_stats_client_id',
  verifier: 'spotify_stats_code_verifier',
  state: 'spotify_stats_auth_state',
  tokens: 'spotify_stats_tokens',
};

export function getClientId() {
  return localStorage.getItem(KEYS.clientId) || '';
}

export function setClientId(id) {
  localStorage.setItem(KEYS.clientId, (id || '').trim());
}

export function getRedirectUri() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function getStoredTokens() {
  const raw = localStorage.getItem(KEYS.tokens);
  return raw ? JSON.parse(raw) : null;
}

function storeTokens(tokens) {
  localStorage.setItem(KEYS.tokens, JSON.stringify(tokens));
}

export function logout() {
  localStorage.removeItem(KEYS.tokens);
}

export function isLoggedIn() {
  return !!getStoredTokens();
}

export async function redirectToSpotifyAuthorize() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Enter your Spotify app Client ID first.');

  const verifier = generateRandomString(64);
  const challenge = await generateCodeChallenge(verifier);
  const state = generateRandomString(16);

  sessionStorage.setItem(KEYS.verifier, verifier);
  sessionStorage.setItem(KEYS.state, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });

  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}

export async function handleRedirectCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (!code && !error) return false;

  window.history.replaceState({}, document.title, getRedirectUri());

  if (error) {
    throw new Error(`Spotify authorization failed: ${error}`);
  }

  const expectedState = sessionStorage.getItem(KEYS.state);
  sessionStorage.removeItem(KEYS.state);
  if (!state || state !== expectedState) {
    throw new Error('Authorization state mismatch. Please try logging in again.');
  }

  const verifier = sessionStorage.getItem(KEYS.verifier);
  sessionStorage.removeItem(KEYS.verifier);
  if (!verifier) {
    throw new Error('Missing PKCE verifier. Please try logging in again.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: getClientId(),
    code_verifier: verifier,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }

  const data = await response.json();
  storeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });

  return true;
}

async function refreshAccessToken() {
  const tokens = getStoredTokens();
  const clientId = getClientId();
  if (!tokens?.refresh_token || !clientId) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    logout();
    return null;
  }

  const data = await response.json();
  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  storeTokens(updated);
  return updated;
}

export async function getValidAccessToken() {
  let tokens = getStoredTokens();
  if (!tokens) return null;
  if (Date.now() > tokens.expires_at - 60_000) {
    tokens = await refreshAccessToken();
  }
  return tokens?.access_token || null;
}
