// db.js — ÚNICA porta para o Supabase (equivalente ao shared/db.py do framework).
// Nenhum outro módulo instancia o client. Schema fixo em `monjaro`.
// Ver framework.md (§5) e architecture.md.

// Versão pinada: sem pin o CDN entrega "latest" — quebra silenciosa e
// supply chain (WR-04 do review). Atualizar conscientemente quando quiser.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'monjaro' },
});

// Helpers de conveniência. Toda query lança em erro para o chamador tratar na UI.
function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function list(table, { order, ascending = true, select = '*' } = {}) {
  let q = db.from(table).select(select).eq('is_active', true);
  if (order) q = q.order(order, { ascending });
  return unwrap(await q);
}

export async function insert(table, row) {
  return unwrap(await db.from(table).insert(row).select().single());
}

export async function update(table, id, patch) {
  return unwrap(await db.from(table).update(patch).eq('id', id).select().single());
}

// Soft delete SEMPRE — nunca db.from(table).delete(). Ver business-rules.md.
export async function softDelete(table, id) {
  return unwrap(await db.from(table).update({ is_active: false }).eq('id', id).select().single());
}

// Views não têm is_active próprio (já filtram dentro).
export async function listView(view, select = '*') {
  return unwrap(await db.from(view).select(select));
}
