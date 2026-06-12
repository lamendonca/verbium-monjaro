// config.js — ÚNICO módulo que lê variáveis de ambiente.
// Lê window.__ENV__ (injetado por /env.js, gerado pelo nginx a partir do .env).
// Os demais módulos importam daqui — nunca de window.__ENV__ diretamente,
// nunca hardcodam URL/chave/token. Ver framework.md e architecture.md.

const ENV = window.__ENV__ || {};

export const SUPABASE_URL      = ENV.SUPABASE_URL;
export const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY;
export const APP_TOKEN         = ENV.APP_TOKEN;
export const ENVIRONMENT       = ENV.ENV || 'development';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Falha cedo e visível: env não injetada (ver operations.md → injeção de env).
  console.error('[config] window.__ENV__ ausente ou incompleto. Conferir /env.js.');
}
