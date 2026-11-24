/* OS Group udbudsplatform – login, brugere og forbindelse til Supabase.
   Erstatter Claude-portalens claude.use("db" | "assets" | "sample" | "downloads"),
   så selve platformen (index.html) kører uændret på udbud.osgroup.dk. */
(function () {
  'use strict';
  const CFG = window.UB_CONFIG || {};
  const NEED_PW = /type=(invite|recovery)/.test(location.hash);
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const T = 'udbud_docs', BUCKET = 'udbud';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rid = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');
  const UB = window.UB = { sb, user: null, member: null, isAdmin: false };

  let readyResolve; const ready = new Promise(r => (readyResolve = r));

  /* ---------------- dokumenter (samme API som claude.use("db")) ---------------- */
  const cols = {}; // collection -> {map: Map(id->data), subs: Set(cb)}
  const col = c => (cols[c] = cols[c] || { map: new Map(), subs: new Set(), loaded: false, t: 0 });
  const snap = c => ({ docs: [...col(c).map.entries()].map(([id, d]) => ({ id, exists: true, data: () => d })) });
  const emit = c => { const C = col(c); clearTimeout(C.t); C.t = setTimeout(() => C.subs.forEach(cb => { try { cb(snap(c)) } catch (e) { console.error(e) } }), 30); };
  async function loadCol(c) {
    const C = col(c), map = new Map(); let from = 0;
    for (;;) {
      const { data, error } = await sb.from(T).select('id,data').eq('collection', c).range(from, from + 999);
      if (error) throw error;
      data.forEach(r => map.set(r.id, r.data));
      if (data.length < 1000) break; from += 1000;
    }
    C.map = map; C.loaded = true; emit(c);
  }
  let channel = null;
  function live() {
    if (channel) return;
    channel = sb.channel('udbud-docs').on('postgres_changes', { event: '*', schema: 'public', table: T }, p => {
      const r = p.new && p.new.collection ? p.new : p.old; if (!r || !r.collection) return;
      const C = col(r.collection);
      if (p.eventType === 'DELETE') C.map.delete(r.id); else C.map.set(r.id, p.new.data);
      emit(r.collection);
    }).subscribe();
  }
  const fail = e => { const err = new Error(e.message || String(e)); err.code = e.code; throw err; };
  const db = {
    collection(c) {
      return {
        onSnapshot(cb, onErr) {
          const C = col(c); C.subs.add(cb); live();
          if (C.loaded) cb(snap(c)); else loadCol(c).catch(e => onErr && onErr(e));
          return () => C.subs.delete(cb);
        },
        async add(o) {
          const id = rid(20); col(c).map.set(id, o); emit(c);
          const { error } = await sb.from(T).insert({ collection: c, id, data: o }); if (error) fail(error);
          return { id };
        },
        async get() { await loadCol(c); return snap(c); }
      };
    },
    doc(path) {
      const i = path.indexOf('/'), c = path.slice(0, i), id = path.slice(i + 1);
      return {
        id,
        async set(o, opt) {
          const C = col(c); const v = opt && opt.merge ? { ...(C.map.get(id) || {}), ...o } : o; C.map.set(id, v); emit(c);
          if (opt && opt.merge) { const { error } = await sb.rpc('udbud_merge', { p_collection: c, p_id: id, p_patch: o }); if (error) fail(error); }
          else { const { error } = await sb.from(T).upsert({ collection: c, id, data: o }); if (error) fail(error); }
        },
        async update(o) {
          const C = col(c); C.map.set(id, { ...(C.map.get(id) || {}), ...o }); emit(c);
          const { error } = await sb.rpc('udbud_merge', { p_collection: c, p_id: id, p_patch: o }); if (error) fail(error);
        },
        async delete() {
          col(c).map.delete(id); emit(c);
          const { error } = await sb.from(T).delete().eq('collection', c).eq('id', id); if (error) fail(error);
        },
        async get() {
          const { data, error } = await sb.from(T).select('data').eq('collection', c).eq('id', id).maybeSingle(); if (error) fail(error);
          return { id, exists: !!data, data: () => data ? data.data : undefined };
        }
      };
    }
  };

  /* ---------------- filer ---------------- */
  const assets = {
    async upload(file) {
      const id = rid(32);
      const { error } = await sb.storage.from(BUCKET).upload('blobs/' + id, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (error) fail(error);
      return { id, url: '/_blob/' + id };
    }
  };
  async function blobUrl(id, name) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl('blobs/' + id, 3600, name ? { download: false } : undefined);
    if (error) throw error; return data.signedUrl;
  }
  UB.blobUrl = blobUrl;
  async function openBlob(href) {
    const id = String(href).split('/_blob/')[1].split(/[?#]/)[0];
    const w = window.open('', '_blank');
    try { const u = await blobUrl(id); if (w) w.location.href = u; else location.href = u; }
    catch (e) { if (w) w.close(); alert('Filen kunne ikke åbnes: ' + (e.message || e)); }
  }
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href*="/_blob/"]'); if (!a) return;
    e.preventDefault(); openBlob(a.getAttribute('href'));
  }, true);
  const _open = window.open.bind(window);
  window.open = function (u, ...rest) { if (typeof u === 'string' && u.includes('/_blob/')) { openBlob(u); return null } return _open(u, ...rest) };

  /* ---------------- AI ---------------- */
  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob) });
  async function fnErr(error, data) {
    let msg = (data && data.error) || (error && error.message) || 'Ukendt fejl';
    try { if (error && error.context && error.context.json) { const j = await error.context.json(); if (j && j.error) msg = j.error } } catch (_) {}
    return new Error(msg);
  }
  const sample = {
    async limits() { return { images: true } },
    async json(prompt, o = {}) {
      const images = [];
      for (const im of (o.images || [])) images.push(typeof im === 'string' ? im.replace(/^data:[^,]+,/, '') : await b64(im));
      const { data, error } = await sb.functions.invoke('udbud-ai', { body: { prompt, images, tier: o.modelTier || 'default' } });
      if (error || !data || data.error) throw await fnErr(error, data);
      return data.result;
    }
  };

  /* ---------------- download ---------------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = filename || 'fil'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    }
  };

  window.claude = { use: async name => { await ready; return { db, assets, sample, downloads }[name] } };

  /* ---------------- login ---------------- */
  function authCard(mode, msg, kind) {
    document.body.classList.add('ub-noauth');
    const m = msg ? `<div class="ub-msg ${kind || 'bad'}">${esc(msg)}</div>` : '';
    const logo = `<img class="ub-logo" alt="OS Group" src="logo.png"><div class="ub-sub">Udbudsplatform</div>`;
    let body;
    if (mode === 'setpw') body = `<h1>Vælg adgangskode</h1><p class="ub-p">Vælg en adgangskode på mindst 10 tegn. Den bruger du fremover til at logge ind.</p>${m}
      <label>Ny adgangskode</label><input id="ub-p1" type="password" autocomplete="new-password">
      <label>Gentag adgangskode</label><input id="ub-p2" type="password" autocomplete="new-password">
      <button class="btn ub-full" data-ub="setpw">Gem og log ind</button>`;
    else if (mode === 'noaccess') body = `<h1>Ingen adgang</h1>${m}<p class="ub-p">Du er logget ind som <b>${esc(UB.user && UB.user.email)}</b>, men har ikke adgang til udbudsplatformen. Bed en administrator om at tilføje dig.</p>
      <button class="btn g ub-full" data-ub="logout">Log ud</button>`;
    else body = `<h1>Log ind</h1>${m}
      <label>E-mail</label><input id="ub-e" type="email" autocomplete="username" inputmode="email">
      <label>Adgangskode</label><input id="ub-pw" type="password" autocomplete="current-password">
      <button class="btn ub-full" data-ub="login">Log ind</button>
      <button class="ub-link" data-ub="forgot">Glemt adgangskode?</button>`;
    $('#ub-auth').innerHTML = `<div class="ub-card">${logo}${body}</div><div class="ub-foot">OS Group ApS · <a href="https://www.osgroup.dk">osgroup.dk</a></div>`;
    const f = $('#ub-auth input'); if (f) setTimeout(() => f.focus(), 50);
  }
  async function enter(session) {
    UB.user = session.user;
    const { data, error } = await sb.from('udbud_members').select('*').eq('user_id', session.user.id).maybeSingle();
    if (error) return authCard('login', 'Kunne ikke hente din adgang: ' + error.message);
    if (!data) return authCard('noaccess');
    UB.member = data; UB.isAdmin = data.role === 'admin';
    if (!data.name && session.user.user_metadata && session.user.user_metadata.name) UB.member.name = session.user.user_metadata.name;
    document.body.classList.remove('ub-noauth');
    $('#ub-auth').innerHTML = '';
    renderUserBar();
    readyResolve();
  }
  function renderUserBar() {
    const hp = document.querySelector('.hd .hp'); if (!hp) return;
    hp.className = 'hp ub-bar';
    hp.innerHTML = `<span class="ub-who">${esc(UB.member.name || UB.user.email)}</span>${UB.isAdmin ? '<button class="btn g s" data-ub="users">Brugere</button>' : ''}<button class="btn g s" data-ub="logout">Log ud</button>`;
  }
  const val = id => ((document.getElementById(id) || {}).value || '');
  document.addEventListener('click', async e => {
    const t = e.target.closest && e.target.closest('[data-ub]'); if (!t) return;
    const a = t.dataset.ub; e.preventDefault();
    try {
      if (a === 'login') {
        const { data, error } = await sb.auth.signInWithPassword({ email: val('ub-e').trim(), password: val('ub-pw') });
        if (error) return authCard('login', 'Forkert e-mail eller adgangskode.');
        await enter(data.session);
      } else if (a === 'forgot') {
        const em = val('ub-e').trim(); if (!em) return authCard('login', 'Skriv din e-mail først, og tryk så "Glemt adgangskode?".');
        await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + '/' });
        authCard('login', 'Hvis e-mailen findes, har vi sendt et link til at vælge en ny adgangskode.', 'ok');
      } else if (a === 'setpw') {
        const p = val('ub-p1'); if (p.length < 10) return authCard('setpw', 'Adgangskoden skal være mindst 10 tegn.');
        if (p !== val('ub-p2')) return authCard('setpw', 'De to adgangskoder er ikke ens.');
        const { error } = await sb.auth.updateUser({ password: p }); if (error) return authCard('setpw', error.message);
        history.replaceState(null, '', location.pathname);
        const { data } = await sb.auth.getSession(); await enter(data.session);
      } else if (a === 'logout') { await sb.auth.signOut(); location.replace(location.pathname); }
      else if (a === 'users') openUsers();
      else if (a === 'uinvite') inviteUser();
      else if (a === 'urole') userAction('role', t.dataset.id, { role: t.dataset.role });
      else if (a === 'uresend') userAction('resend', t.dataset.id);
      else if (a === 'uremove') { if (confirm('Fjern adgangen til udbudsplatformen for ' + t.dataset.name + '?')) userAction('remove', t.dataset.id) }
      else if (a === 'uclose') $('#ub-users').close();
      else if (a === 'import') runImport();
    } catch (err) { alert(err.message || err) }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !document.body.classList.contains('ub-noauth')) return;
    const b = $('#ub-auth [data-ub="login"], #ub-auth [data-ub="setpw"]'); if (b) { e.preventDefault(); b.click() }
  });

  /* ---------------- brugere (kun admin) ---------------- */
  let uMsg = '';
  async function openUsers() {
    const d = $('#ub-users'); if (!d.open) d.showModal();
    d.querySelector('.ub-ulist').innerHTML = '<div class="ub-p">Henter …</div>';
    const { data, error } = await sb.from('udbud_members').select('*').order('created_at');
    if (error) { d.querySelector('.ub-ulist').innerHTML = `<div class="ub-msg bad">${esc(error.message)}</div>`; return }
    d.querySelector('.ub-umsg').innerHTML = uMsg ? `<div class="ub-msg ok">${esc(uMsg)}</div>` : ''; uMsg = '';
    d.querySelector('.ub-ulist').innerHTML = data.map(m => `<div class="ub-urow"><div class="ub-uinfo"><b>${esc(m.name || m.email)}</b><small>${esc(m.email)}</small></div>
      <span class="tag ${m.role === 'admin' ? 'pri' : ''}">${m.role === 'admin' ? 'Administrator' : 'Bruger'}</span>
      ${m.user_id === UB.user.id ? '<small class="ub-me">Dig</small>' : `<div class="ub-uact">
        <button class="btn g s" data-ub="urole" data-id="${m.user_id}" data-role="${m.role === 'admin' ? 'member' : 'admin'}">${m.role === 'admin' ? 'Gør til bruger' : 'Gør til admin'}</button>
        <button class="btn g s" data-ub="uresend" data-id="${m.user_id}">Send link igen</button>
        <button class="btn g s d" data-ub="uremove" data-id="${m.user_id}" data-name="${esc(m.name || m.email)}">Fjern</button></div>`}</div>`).join('');
  }
  async function callUsers(body) {
    const { data, error } = await sb.functions.invoke('udbud-invite', { body });
    if (error || !data || data.error) throw await fnErr(error, data);
    return data;
  }
  async function inviteUser() {
    const email = val('ub-ie').trim(), name = val('ub-in').trim(), role = val('ub-ir');
    if (!/^\S+@\S+\.\S+$/.test(email)) return alert('Skriv en gyldig e-mail.');
    const b = $('[data-ub="uinvite"]'); b.disabled = true; b.textContent = 'Sender …';
    try {
      const r = await callUsers({ action: 'invite', email, name, role });
      uMsg = r.existed ? `${email} havde allerede en konto (fx fra tidsregistreringen) og har nu adgang. Personen logger ind med sin nuværende adgangskode.` : `Invitation sendt til ${email}. Personen får en mail med et link til at vælge adgangskode.`;
      $('#ub-ie').value = ''; $('#ub-in').value = '';
    } finally { b.disabled = false; b.textContent = 'Invitér'; }
    openUsers();
  }
  async function userAction(action, user_id, extra) {
    const r = await callUsers({ action, user_id, ...(extra || {}) });
    uMsg = action === 'resend' ? (r.reset ? 'Der er sendt et link til at vælge ny adgangskode.' : 'Invitationen er sendt igen.') : action === 'remove' ? 'Adgangen er fjernet.' : 'Rollen er ændret.';
    openUsers();
  }

  /* ---------------- dataflytning fra Claude-portalen (kun admin) ---------------- */
  async function runImport() {
    const f = $('#ub-ifile').files[0]; if (!f) return alert('Vælg først ZIP-filen fra den gamle portal.');
    const out = $('#ub-iout'), say = t => (out.textContent = t);
    const btn = $('[data-ub="import"]'); btn.disabled = true;
    try {
      say('Læser ZIP-filen …');
      const zip = await JSZip.loadAsync(f);
      const dj = zip.file('data.json'); if (!dj) throw new Error('data.json mangler i ZIP-filen.');
      const data = JSON.parse(await dj.async('string'));
      const map = {}; const files = data.files || []; let n = 0, bad = [];
      for (const x of files) {
        n++; say(`Flytter fil ${n} af ${files.length}: ${x.name}`);
        try {
          const ent = zip.file(x.path); if (!ent) throw new Error('mangler i ZIP');
          const blob = await ent.async('blob');
          const r = await assets.upload(new File([blob], x.name || 'fil', { type: x.type || '' }));
          map[x.key] = r.id;
        } catch (e) { bad.push(x.name + ' (' + (e.message || e) + ')') }
      }
      const ref = o => o.fileId ? '/_blob/' + o.fileId : o.fileUrl;
      const fix = o => { const k = ref(o); if (k && map[k]) { const r = { ...o, fileId: map[k] }; delete r.fileUrl; return r } return o };
      const fixCv = o => { const k = ref(o); if (k && map[k]) { const r = { ...o, fileUrl: '/_blob/' + map[k] }; delete r.fileId; return r } return o };
      const rows = [];
      for (const c of ['udbud', 'cvs', 'meta', 'events']) {
        for (const d of (data[c] || [])) {
          let { id, ...o } = d; if (!id) continue;
          if (c === 'udbud') { if (Array.isArray(o.files)) o.files = o.files.map(fix); o = fix(o) }
          if (c === 'cvs') o = fixCv(o);
          rows.push({ collection: c, id: String(id), data: o });
        }
      }
      for (let i = 0; i < rows.length; i += 50) {
        say(`Gemmer data ${Math.min(i + 50, rows.length)} af ${rows.length} …`);
        const { error } = await sb.from(T).upsert(rows.slice(i, i + 50)); if (error) throw error;
      }
      say(`Færdig: ${rows.length} poster og ${files.length - bad.length} af ${files.length} filer er flyttet.` + (bad.length ? '\nFejlede filer:\n' + bad.join('\n') : ''));
      for (const c of ['udbud', 'cvs', 'meta', 'events']) if (col(c).subs.size) loadCol(c);
    } catch (e) { say('Fejl: ' + (e.message || e)) } finally { btn.disabled = false }
  }

  /* ---------------- start ---------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') authCard('setpw') });
    const { data: { session } } = await sb.auth.getSession();
    if (session && NEED_PW) return authCard('setpw');
    if (session) return enter(session);
    authCard('login');
  });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
