import './style.css';
import { sb } from './supabase';
import { capturePendingInvite, showAuth, showMain } from './app';

capturePendingInvite();

let current: string | null | undefined;
function route(userId: string | null): void {
  if (userId === current) return;
  current = userId;
  if (userId) void showMain(userId);
  else showAuth();
}

sb.auth.onAuthStateChange((_event, session) => route(session?.user.id ?? null));
sb.auth.getSession().then(({ data }) => route(data.session?.user.id ?? null));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
