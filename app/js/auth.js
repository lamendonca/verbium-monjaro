// auth.js — login por APP_TOKEN (sem Supabase Auth). STUB: spec abaixo.
//
// Responsabilidade:
//   - Na carga, verificar se há sessão válida em localStorage; se não, mostrar
//     a tela de login (#login) e esconder o shell do app.
//   - Comparar o token digitado com APP_TOKEN em TEMPO CONSTANTE
//     (não usar `digitado === APP_TOKEN`; ver security.md → comparação constante,
//     ex.: comparar digests via crypto.subtle).
//   - Em sucesso: marcar flag de sessão em localStorage e revelar o app.
//   - Expor logout() que limpa a flag.
//
// Importa: APP_TOKEN de ./config.js.
// NUNCA logar o token. Ver security.md.
//
// Esboço de API:
//   export function isAuthenticated() { ... }
//   export async function login(tokenDigitado) { ... return boolean }
//   export function logout() { ... }

import { APP_TOKEN } from './config.js';

export function isAuthenticated() {
  // TODO: ler flag de sessão em localStorage.
  return false;
}

export async function login(/* tokenDigitado */) {
  // TODO: comparar em tempo constante com APP_TOKEN; setar sessão; ver security.md.
  throw new Error('auth.login não implementado — ver auth.js spec');
}

export function logout() {
  // TODO: limpar flag de sessão.
}
