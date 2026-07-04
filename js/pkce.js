const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateRandomString(length) {
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => CHARSET[v % CHARSET.length]).join('');
}

function base64UrlEncode(buffer) {
  let str = '';
  for (const byte of new Uint8Array(buffer)) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}
