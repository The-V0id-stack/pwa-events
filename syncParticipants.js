// syncParticipants.js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { idb } from './idb.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Descarga TODOS los participantes y los guarda en IndexedDB.
 * Devuelve {ok:true, count:n} o {ok:false, error}
 */
export async function syncParticipantsFromSupabase() {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };

  try {
    // si la tabla es grande, considera paginar (limit/offset) o usar cursor
    const { data, error } = await supabase
      .from('participants')
      .select('*');

    if (error) throw error;
    if (!data || !data.length) return { ok: true, count: 0 };

    await idb.bulkPutParticipants(data);
    return { ok: true, count: data.length };
  } catch (err) {
    return { ok: false, error: err };
  }
}
