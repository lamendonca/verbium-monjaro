// db.js — ÚNICA porta para o Supabase (equivalente ao shared/db.py do framework).
// Nenhum outro módulo instancia o client. Schema fixo em `monjaro`.
// Ver framework.md (§5) e architecture.md.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'monjaro' },
});

// Helpers de conveniência sugeridos (implementar conforme necessidade dos módulos):
//   export const list       = (table)        => db.from(table).select('*').eq('is_active', true);
//   export const insert     = (table, row)   => db.from(table).insert(row).select().single();
//   export const update     = (table, id, p) => db.from(table).update(p).eq('id', id).select().single();
//   export const softDelete = (table, id)    => db.from(table).update({ is_active: false }).eq('id', id);
// Soft delete SEMPRE — nunca db.from(table).delete(). Ver business-rules.md.
