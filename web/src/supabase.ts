import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export type State = 'online' | 'away' | 'busy' | 'offline';

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  avatar_path: string | null;
}

export interface Status {
  user_id: string;
  state: State;
  message: string | null;
  updated_at: string;
}

// Ordre = ordre d'affichage des boutons et du tri de la liste
export const STATES: Record<State, { label: string; color: string; hint: string }> = {
  online: { label: 'En ligne', color: '#23a55a', hint: 'Disponible' },
  away: { label: 'Absent(e)', color: '#f0b232', hint: 'Pas devant l’écran' },
  busy: { label: 'Occupé(e)', color: '#f23f43', hint: 'Ne pas déranger' },
  offline: { label: 'Hors ligne', color: '#80848e', hint: 'Invisible' },
};
export const STATE_ORDER: State[] = ['online', 'busy', 'away', 'offline'];
