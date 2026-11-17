import { fail, text } from './domain.mjs';

export function loginName(data, creating = false) {
  const value = text(data.username ?? data.email, 'Identifiant', 200).toLowerCase();
  // Existing installations keep their former email as their login identifier.
  const legacy = data.username === undefined && data.email !== undefined;
  if (creating && !(legacy ? /^\S+@\S+\.\S+$/.test(value) : /^[a-z0-9][a-z0-9._-]{2,39}$/.test(value)))
    fail(400, 'Identifiant : 3 à 40 caractères, lettres sans accents, chiffres, point, tiret ou underscore.');
  return value;
}

export function secret(value, creating = false) {
  if (typeof value !== 'string' || value.length > 200 || value.length < (creating ? 8 : 1) || !value.trim())
    fail(400, creating ? 'Le mot de passe doit contenir au moins 8 caractères (200 maximum).' : 'Mot de passe requis.');
  return value;
}

export function accessConfig(env) {
  const raw = env.APP_URL || env.PUBLIC_ORIGIN || '';
  let origin = '';
  if (raw) {
    let url;
    try { url = new URL(raw); } catch { throw Error('APP_URL : adresse complète requise (https://temps.votre-domaine.ch).'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw Error('APP_URL doit contenir seulement le protocole et le domaine, sans chemin ni identifiants.');
    origin = url.origin;
  }
  return { publicOrigin: origin, secureCookies: origin ? origin.startsWith('https:') : env.COOKIE_SECURE === '1' };
}
