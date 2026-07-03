// auth.js — login por APP_TOKEN (sem Supabase Auth).
// A sessão guarda o digest SHA-256 do token: rotacionar o APP_TOKEN no .env
// invalida sessões antigas automaticamente. NUNCA logar o token. Ver security.md.

import { APP_TOKEN } from './config.js';

const SESSION_KEY = 'monjaro.session';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Comparação em tempo constante sobre digests de tamanho fixo — evita timing
// e evita comparar o token cru. Ver security.md → comparação constante.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAuthenticated() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved || !APP_TOKEN) return false;
  return constantTimeEqual(saved, await sha256Hex(APP_TOKEN));
}

export async function login(tokenDigitado) {
  if (!APP_TOKEN) return false;
  const [digitado, esperado] = await Promise.all([sha256Hex(tokenDigitado), sha256Hex(APP_TOKEN)]);
  if (!constantTimeEqual(digitado, esperado)) return false;
  localStorage.setItem(SESSION_KEY, esperado);
  return true;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}
