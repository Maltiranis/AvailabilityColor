import QRCode from 'qrcode';
import { sb, STATES, STATE_ORDER, type Profile, type State, type Status } from './supabase';
import { colorFor, esc, fullName, initials, resizeImage, timeAgo, toast } from './util';

const root = document.getElementById('app')!;
const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

// ------------------------------------------------------------------ état
let uid = '';
let profiles = new Map<string, Profile>();
let statuses = new Map<string, Status>();
let myCode = '';
const avatarUrls = new Map<string, string>();
let avatarsAt = 0;
let refreshTimer: number | undefined;
let tickTimer: number | undefined;
let msgTimer: number | undefined;

const CODE_RE = /^[A-Z2-9]{10}$/;

// ------------------------------------------------------------------ invitation par lien (#/add/CODE)
export function capturePendingInvite(): void {
  const m = location.hash.match(/^#\/add\/([A-Za-z0-9]{10})$/);
  if (m) {
    sessionStorage.setItem('pendingCode', m[1].toUpperCase());
    history.replaceState(null, '', location.pathname + location.search);
  }
}

async function handlePendingInvite(): Promise<void> {
  const code = sessionStorage.getItem('pendingCode');
  if (!code) return;
  sessionStorage.removeItem('pendingCode');
  if (CODE_RE.test(code)) await addContact(code);
}

// ------------------------------------------------------------------ écran de connexion
export function showAuth(mode: 'login' | 'signup' = 'login'): void {
  stop();
  const signup = mode === 'signup';
  root.innerHTML = `
  <main class="auth">
    <div class="brand"><i style="background:#23a55a"></i><i style="background:#f0b232"></i><i style="background:#f23f43"></i><i style="background:#80848e"></i></div>
    <h1>Dispo</h1>
    <p class="sub">Dis à ton cercle si tu es disponible.</p>
    <div class="tabs" role="tablist">
      <button type="button" data-m="login" class="${signup ? '' : 'on'}">Connexion</button>
      <button type="button" data-m="signup" class="${signup ? 'on' : ''}">Créer un compte</button>
    </div>
    <form id="authForm">
      ${
        signup
          ? `<div class="row">
               <input name="first" placeholder="Prénom" required maxlength="50" autocomplete="given-name" />
               <input name="last" placeholder="Nom" required maxlength="50" autocomplete="family-name" />
             </div>`
          : ''
      }
      <input name="email" type="email" placeholder="Adresse e-mail" required autocomplete="username" value="${esc(savedEmail())}" />
      <input name="password" type="password" placeholder="Mot de passe${signup ? ' (10 caractères min.)' : ''}" required minlength="${signup ? 10 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}" />
      <p class="err" id="authErr" role="alert"></p>
      <button class="primary" type="submit">${signup ? 'Créer mon compte' : 'Se connecter'}</button>
    </form>
  </main>`;

  root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
    b.addEventListener('click', () => showAuth(b.dataset.m as 'login' | 'signup')),
  );

  $<HTMLFormElement>('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const email = String(f.get('email')).trim();
    const password = String(f.get('password'));
    const err = $('#authErr');
    const btn = $<HTMLButtonElement>('#authForm .primary');
    err.textContent = '';
    btn.disabled = true;
    if (signup) {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { first_name: String(f.get('first')).trim(), last_name: String(f.get('last')).trim() } },
      });
      if (error) err.textContent = authError(error.message);
      else if (!data.session) err.textContent = 'Compte créé. Vérifie ta boîte mail pour confirmer, puis connecte-toi.';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) err.textContent = authError(error.message);
    }
    btn.disabled = false;
    if (!err.textContent) await rememberLogin(email, password);
  });
}

// On retient l'e-mail (pratique, non secret). Le mot de passe n'est JAMAIS écrit en clair par l'app :
// il est confié au gestionnaire de mots de passe du navigateur/téléphone, qui le chiffre.
const savedEmail = (): string => {
  try {
    return localStorage.getItem('dispo.email') ?? '';
  } catch {
    return '';
  }
};

async function rememberLogin(email: string, password: string): Promise<void> {
  try {
    localStorage.setItem('dispo.email', email);
  } catch {
    /* stockage indisponible */
  }
  try {
    const PC = (window as unknown as { PasswordCredential?: new (d: { id: string; password: string }) => Credential })
      .PasswordCredential;
    if (PC && navigator.credentials) await navigator.credentials.store(new PC({ id: email, password }));
  } catch {
    /* le navigateur gère l'enregistrement via sa propre fenêtre */
  }
}

function authError(m: string): string {
  if (/invalid login/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already been registered/i.test(m)) return 'Cette adresse a déjà un compte. Connecte-toi.';
  if (/password/i.test(m)) return 'Mot de passe trop faible (10 caractères minimum).';
  if (/signups not allowed/i.test(m)) return 'Les inscriptions sont désactivées sur le serveur.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives. Réessaie dans quelques minutes.';
  if (/fetch|network/i.test(m)) return 'Pas de connexion internet.';
  return `Une erreur est survenue. Réessaie. (détail : ${m})`;
}

// ------------------------------------------------------------------ écran principal
export async function showMain(userId: string): Promise<void> {
  stop();
  uid = userId;
  root.innerHTML = `
  <div class="shell">
    <header class="top">
      <button id="meBtn" class="me" aria-label="Mon profil"></button>
      <div class="grow"><b id="meName">…</b><span class="muted" id="meState"></span></div>
      <button id="addBtn" class="pill" type="button">＋ Contact</button>
    </header>

    <section class="card">
      <h2>Mon statut</h2>
      <div class="states" id="states"></div>
      <input id="msg" maxlength="140" placeholder="Ce que tu fais (optionnel)…" enterkeyhint="done" />
    </section>

    <section>
      <h2 class="sec">Mon cercle <span id="count" class="muted"></span></h2>
      <ul id="list" class="list"></ul>
    </section>
  </div>

  <dialog id="dlgAdd">
    <h3>Ajouter un contact</h3>
    <label class="lbl" for="codeIn">Il t'a donné son code ?</label>
    <form id="addForm" class="inline">
      <input id="codeIn" placeholder="Code à 10 caractères" maxlength="10" autocapitalize="characters" autocomplete="off" spellcheck="false" />
      <button class="primary" type="submit">Ajouter</button>
    </form>
    <hr />
    <p class="lbl">Ou donne-lui ton code / ton lien :</p>
    <div class="code" id="myCode">…</div>
    <div class="inline">
      <button type="button" id="copyCode">Copier le code</button>
      <button type="button" id="copyLink">Copier le lien</button>
    </div>
    <img id="qr" alt="QR code de ton lien d'invitation" width="180" height="180" />
    <button type="button" id="regen" class="link">Changer mon code (l'ancien ne marchera plus)</button>
    <button type="button" class="close" data-close>Fermer</button>
  </dialog>

  <dialog id="dlgMe">
    <h3>Mon profil</h3>
    <div class="av big" id="meAv"></div>
    <div class="inline center">
      <button type="button" id="pickPhoto">Changer la photo</button>
      <button type="button" id="delPhoto" class="link">Retirer</button>
    </div>
    <input type="file" id="photoIn" accept="image/jpeg,image/png,image/webp" hidden />
    <form id="meForm">
      <div class="row">
        <input id="fn" placeholder="Prénom" required maxlength="50" />
        <input id="ln" placeholder="Nom" required maxlength="50" />
      </div>
      <button class="primary" type="submit">Enregistrer</button>
    </form>
    <button type="button" id="logout" class="danger">Se déconnecter</button>
    <button type="button" class="close" data-close>Fermer</button>
  </dialog>`;

  bindMain();
  await refresh();
  subscribe();
  await handlePendingInvite();
}

function stop(): void {
  clearTimeout(refreshTimer);
  clearInterval(tickTimer);
  clearTimeout(msgTimer);
  void sb.removeAllChannels();
  profiles = new Map();
  statuses = new Map();
  avatarUrls.clear();
  myCode = '';
}

function bindMain(): void {
  $('#addBtn').addEventListener('click', openAdd);
  $('#meBtn').addEventListener('click', openMe);
  root.querySelectorAll<HTMLElement>('[data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog')!.close()),
  );

  // statut
  const msg = $<HTMLInputElement>('#msg');
  msg.addEventListener('input', () => {
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => void saveStatus({ message: msg.value }), 800);
  });
  msg.addEventListener('change', () => {
    clearTimeout(msgTimer);
    void saveStatus({ message: msg.value });
  });
  msg.addEventListener('keydown', (e) => e.key === 'Enter' && msg.blur());

  // liste : retirer un contact
  $('#list').addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-rm]');
    if (t) return void removeContact(t.dataset.rm!);
    if ((e.target as HTMLElement).closest('[data-empty-add]')) openAdd();
  });

  // dialogue ajout
  $<HTMLFormElement>('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('#codeIn');
    const code = input.value.trim().toUpperCase();
    if (!CODE_RE.test(code)) return toast('Un code contient 10 caractères (lettres et chiffres).', 'err');
    if (await addContact(code)) {
      input.value = '';
      $<HTMLDialogElement>('#dlgAdd').close();
    }
  });
  $('#copyCode').addEventListener('click', () => copy(myCode, 'Code copié'));
  $('#copyLink').addEventListener('click', async () => {
    const link = inviteLink();
    if (navigator.share) {
      try {
        return await navigator.share({ title: 'Dispo', text: 'Rejoins mon cercle sur Dispo', url: link });
      } catch {
        /* annulé */
      }
    }
    copy(link, 'Lien copié');
  });
  $('#regen').addEventListener('click', async () => {
    if (!confirm('Changer ton code ? L’ancien code et l’ancien lien cesseront de fonctionner. Tes contacts actuels ne changent pas.')) return;
    const { data, error } = await sb.rpc('regenerate_invite_code');
    if (error || !data) return toast('Impossible de changer le code.', 'err');
    myCode = data as string;
    await paintCode();
    toast('Nouveau code créé');
  });

  // dialogue profil
  $('#pickPhoto').addEventListener('click', () => $<HTMLInputElement>('#photoIn').click());
  $<HTMLInputElement>('#photoIn').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (file) await uploadPhoto(file);
  });
  $('#delPhoto').addEventListener('click', () => void setPhoto(null));
  $<HTMLFormElement>('#meForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const first_name = $<HTMLInputElement>('#fn').value.trim();
    const last_name = $<HTMLInputElement>('#ln').value.trim();
    const { error } = await sb.from('profiles').update({ first_name, last_name }).eq('id', uid);
    if (error) return toast('Enregistrement impossible.', 'err');
    await refresh();
    $<HTMLDialogElement>('#dlgMe').close();
    toast('Profil mis à jour');
  });
  $('#logout').addEventListener('click', () => void sb.auth.signOut());
}

// ------------------------------------------------------------------ données
async function refresh(): Promise<void> {
  const [p, s, c] = await Promise.all([
    sb.from('profiles').select('id,first_name,last_name,avatar_path'),
    sb.from('statuses').select('user_id,state,message,updated_at'),
    sb.from('invite_codes').select('code').maybeSingle(),
  ]);
  if (p.error || s.error) {
    toast('Connexion au serveur impossible.', 'err');
    return;
  }
  profiles = new Map((p.data as Profile[]).map((x) => [x.id, x]));
  statuses = new Map((s.data as Status[]).map((x) => [x.user_id, x]));
  myCode = (c.data?.code as string | undefined) ?? myCode;
  await loadAvatars();
  paintAll();
}

async function loadAvatars(): Promise<void> {
  if (Date.now() - avatarsAt > 45 * 60_000) {
    avatarUrls.clear();
    avatarsAt = Date.now();
  }
  const need = [...profiles.values()].map((p) => p.avatar_path).filter((x): x is string => !!x && !avatarUrls.has(x));
  if (!need.length) return;
  const { data } = await sb.storage.from('avatars').createSignedUrls(need, 3600);
  data?.forEach((d) => d.path && d.signedUrl && avatarUrls.set(d.path, d.signedUrl));
}

function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), 250);
}

function subscribe(): void {
  const ch = sb.channel(`dispo-${uid}`);
  for (const table of ['statuses', 'connections', 'profiles'])
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
  ch.subscribe();
  tickTimer = window.setInterval(() => {
    paintList();
  }, 30_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && scheduleRefresh());
}

async function saveStatus(patch: { state?: State; message?: string | null }): Promise<void> {
  const cur = statuses.get(uid);
  if (cur) {
    statuses.set(uid, { ...cur, ...patch, message: patch.message !== undefined ? patch.message?.trim() || null : cur.message });
    paintMine();
  }
  const { error } = await sb.from('statuses').update(patch).eq('user_id', uid);
  if (error) toast('Impossible d’enregistrer ton statut.', 'err');
}

async function addContact(code: string): Promise<boolean> {
  const { data, error } = await sb.rpc('add_contact_by_code', { p_code: code });
  if (error) {
    toast(
      /too_many/.test(error.message)
        ? 'Trop d’essais ratés. Réessaie dans une heure.'
        : /self/.test(error.message)
          ? 'C’est ton propre code 🙂'
          : 'Impossible d’ajouter ce contact.',
      'err',
    );
    return false;
  }
  if (!data) {
    toast('Code invalide. Vérifie-le avec ton contact.', 'err');
    return false;
  }
  await refresh();
  const p = profiles.get(data as string);
  toast(p ? `${fullName(p)} fait maintenant partie de ton cercle` : 'Contact ajouté');
  return true;
}

async function removeContact(id: string): Promise<void> {
  const p = profiles.get(id);
  if (!p || !confirm(`Retirer ${fullName(p)} de ton cercle ?\nVous ne verrez plus rien l’un de l’autre.`)) return;
  const { error } = await sb.rpc('remove_contact', { p_contact: id });
  if (error) return toast('Suppression impossible.', 'err');
  await refresh();
  toast('Contact retiré');
}

// ------------------------------------------------------------------ photo
async function uploadPhoto(file: File): Promise<void> {
  try {
    const blob = await resizeImage(file);
    const path = `${uid}/avatar-${Date.now()}.jpg`;
    const up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    await setPhoto(path);
  } catch {
    toast('Photo impossible à enregistrer.', 'err');
  }
}

async function setPhoto(path: string | null): Promise<void> {
  const old = profiles.get(uid)?.avatar_path;
  const { error } = await sb.from('profiles').update({ avatar_path: path }).eq('id', uid);
  if (error) return toast('Enregistrement impossible.', 'err');
  if (old && old !== path) await sb.storage.from('avatars').remove([old]);
  await refresh();
  paintMeDialog();
}

// ------------------------------------------------------------------ affichage
const avatarHtml = (p: Profile, dot?: State): string => {
  const url = p.avatar_path ? avatarUrls.get(p.avatar_path) : undefined;
  const inner = url
    ? `<img src="${esc(url)}" alt="" />`
    : `<span style="background:${colorFor(p.id)}">${esc(initials(p))}</span>`;
  const d = dot ? `<i class="dot" style="background:${STATES[dot].color}" title="${STATES[dot].label}"></i>` : '';
  return inner + d;
};

function paintAll(): void {
  paintMine();
  paintList();
  if ($<HTMLDialogElement>('#dlgMe')?.open) paintMeDialog();
  if ($<HTMLDialogElement>('#dlgAdd')?.open) void paintCode();
}

function paintMine(): void {
  const me = profiles.get(uid);
  const st = statuses.get(uid);
  if (!me || !st) return;
  $('#meName').textContent = fullName(me);
  $('#meState').textContent = ' · ' + STATES[st.state].label;
  $('#meBtn').innerHTML = avatarHtml(me, st.state);
  $('#states').innerHTML = STATE_ORDER.map((k) => {
    const s = STATES[k];
    return `<button type="button" class="state${k === st.state ? ' on' : ''}" data-s="${k}" aria-pressed="${k === st.state}" style="--c:${s.color}">
      <i style="background:${s.color}"></i><span><b>${s.label}</b><small>${s.hint}</small></span></button>`;
  }).join('');
  $('#states')
    .querySelectorAll<HTMLButtonElement>('.state')
    .forEach((b) => b.addEventListener('click', () => void saveStatus({ state: b.dataset.s as State })));
  const msg = $<HTMLInputElement>('#msg');
  if (document.activeElement !== msg) msg.value = st.message ?? '';
}

function paintList(): void {
  const others = [...profiles.values()].filter((p) => p.id !== uid);
  const rank = (p: Profile) => STATE_ORDER.indexOf(statuses.get(p.id)?.state ?? 'offline');
  others.sort((a, b) => rank(a) - rank(b) || fullName(a).localeCompare(fullName(b), 'fr'));
  $('#count').textContent = others.length ? `· ${others.length}` : '';
  $('#list').innerHTML = others.length
    ? others
        .map((p) => {
          const st = statuses.get(p.id);
          const state: State = st?.state ?? 'offline';
          return `<li class="person">
            <div class="av">${avatarHtml(p, state)}</div>
            <div class="meta">
              <b>${esc(fullName(p))}</b>
              <span class="st" style="color:${STATES[state].color}">${STATES[state].label}${st ? ` <em>· ${timeAgo(st.updated_at)}</em>` : ''}</span>
              ${st?.message ? `<p class="msg">${esc(st.message)}</p>` : ''}
            </div>
            <button type="button" class="icon x" data-rm="${esc(p.id)}" aria-label="Retirer ${esc(fullName(p))}">✕</button>
          </li>`;
        })
        .join('')
    : `<li class="empty"><p>Ton cercle est vide.</p><button type="button" class="primary" data-empty-add>Ajouter mon premier contact</button></li>`;
}

function paintMeDialog(): void {
  const me = profiles.get(uid);
  if (!me) return;
  $('#meAv').innerHTML = avatarHtml(me);
  $<HTMLInputElement>('#fn').value = me.first_name;
  $<HTMLInputElement>('#ln').value = me.last_name;
  $('#delPhoto').hidden = !me.avatar_path;
}

function openMe(): void {
  paintMeDialog();
  $<HTMLDialogElement>('#dlgMe').showModal();
}

const inviteLink = (): string => `${location.origin}${location.pathname}#/add/${myCode}`;

async function paintCode(): Promise<void> {
  $('#myCode').textContent = myCode ? `${myCode.slice(0, 5)} ${myCode.slice(5)}` : '…';
  if (myCode) $<HTMLImageElement>('#qr').src = await QRCode.toDataURL(inviteLink(), { margin: 1, width: 360 });
}

function openAdd(): void {
  $<HTMLDialogElement>('#dlgAdd').showModal();
  void paintCode();
}

async function copy(text: string, ok: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast('Copie impossible, sélectionne le texte à la main.', 'err');
  }
}
