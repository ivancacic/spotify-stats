import { getValidAccessToken, logout } from './auth.js';

const API_BASE = 'https://api.spotify.com/v1';

async function apiFetch(path, params = {}) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Not authenticated.');

  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    logout();
    throw new Error('Session expired. Please log in again.');
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || '2';
    throw new Error(`Rate limited by Spotify. Try again in ${retryAfter}s.`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || '';
    } catch {
      // ignore
    }
    throw new Error(`Spotify API error (${response.status}) ${detail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export function getCurrentUser() {
  return apiFetch('/me');
}

export function getRecentlyPlayed(limit = 50) {
  return apiFetch('/me/player/recently-played', { limit });
}

export function getTopTracks(timeRange = 'medium_term', limit = 50) {
  return apiFetch('/me/top/tracks', { time_range: timeRange, limit });
}

export function getTopArtists(timeRange = 'medium_term', limit = 50) {
  return apiFetch('/me/top/artists', { time_range: timeRange, limit });
}

export async function getAudioFeaturesForTracks(trackIds) {
  const ids = trackIds.filter(Boolean);
  if (ids.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  const results = await Promise.all(
    chunks.map((chunk) => apiFetch('/audio-features', { ids: chunk.join(',') })),
  );
  return results.flatMap((r) => r?.audio_features || []).filter(Boolean);
}
