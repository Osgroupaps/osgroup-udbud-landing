/* OS Group – Word-oplæg til kandidater.
   Læser udbudsmaterialet, trækker opgave, krav, arbejdssted m.m. ud (kun det, der står i udbuddet)
   og laver et Word-dokument i OS Groups layout, som potentielle konsulenter kan læse. */
(function () {
  'use strict';
  const SKIP = /espd|tro-? ?og-? ?love|st(ø|o)tteerkl|tilbudsbrev|tilbudsliste|persondata|\bcsr\b|konsortie|fortrolighed|tidligere opl|vejledning|bilag [a-e] -|abr forenklet|sbr forenklet/i;
  const PRIO = /opgavebeskrivelse|funktionsbeskrivelse|kompetence|udbudsbetingelser|udbudsbrev|kravspec|kontrakt|aftale/i;
  /* Felter, som AI udfylder pr. rolle */
  const FIELDS = ['opgaver', 'arbejdssted', 'periode', 'forlaengelse', 'omfang', 'erfaring', 'sprog', 'fordel', 'uddannelse', 'certificering', 'dokumentation', 'profil'];
  /* Afsnit i oplægget – samme rækkefølge og overskrifter som OS Groups oplæg (fx "Jord-Fagtilsyn") */
  const SECTIONS = [
    ['Opgavebeskrivelse', ['opgaver']], ['Arbejdssted', ['arbejdssted']], ['Ansættelsesperioder', ['periode']],
    ['Mulighed for forlængelse', ['forlaengelse']], ['Belastningsgrad', ['omfang']],
    ['Krav til erfaring og kvalifikationer', ['erfaring', 'sprog', 'fordel']], ['Krav til uddannelse og kurser', ['uddannelse', 'certificering']],
    ['Dokumentation (ift. kandidater)', ['dokumentation']], ['Profil', ['profil']]
  ];
  const SUB = /^\s*(↳|[-–o»]\s)\s*/;
  const items = (r, keys) => keys.flatMap(k => r[k] || []).map(x => SUB.test(x) ? { t: x.replace(SUB, ''), lvl: 1 } : { t: x, lvl: 0 });
  const antal = r => Math.max(1, parseInt(r.antal, 10) || 1);
  const total = W => (W.roles || []).reduce((n, r) => n + antal(r), 0);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const arr = v => (Array.isArray(v) ? v : v ? [v] : []).flatMap(x => x && typeof x === 'object' ? [String(x.punkt || x.t || ''), ...arr(x.under || x.sub).map(y => '↳ ' + y.replace(SUB, ''))] : [String(x)]).map(x => x.replace(/^\s*[•*]\s*/, '').trim()).map(x => /^[-–o»]\s/.test(x) ? '↳ ' + x.replace(SUB, '') : x).filter(x => x && x !== '↳' && !/^(↳ )?ikke angivet\.?$/i.test(x));
  let CUR = null, BUSY = false;

  /* ---------- dialog ---------- */
  function dlg() {
    let d = document.getElementById('dW');
    if (d) return d;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="dW"><div class="mh" id="wTitle">Word-oplæg</div><div class="mb" style="display:block">
      <p class="sub" style="margin:0 0 10px">Udbuddet præsenteret som et jobopslag til mulige kandidater: opgaven, arbejdssted, periode, belastningsgrad, krav til erfaring og uddannelse, dokumentation og profil. Kun oplysninger, der står i udbuddet, kommer med. Søger udbuddet flere personer, står det tydeligt øverst i oplægget.</p>
      <div id="wMsg" class="note" hidden></div><div id="wBody"></div></div>
      <div class="mf"><button class="btn g" data-wclose>Luk</button><button class="btn g" id="wGen">Generér oplæg</button><button class="btn" id="wDl" disabled>Download Word-oplæg</button></div></dialog>`);
    d = document.getElementById('dW');
    d.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-wclose')) d.close();
      else if (t.id === 'wGen') generate();
      else if (t.id === 'wDl') download();
    });
    return d;
  }
  const msg = (t, kind) => { const m = document.getElementById('wMsg'); m.hidden = !t; m.textContent = t || ''; m.style.color = kind === 'bad' ? 'var(--bad)' : '' };
  const parsed = u => { try { return u.wo ? JSON.parse(u.wo) : null } catch (e) { return null } };
  function show() {
    const u = S.udbud.find(x => x.id === CUR); if (!u) return;
    document.getElementById('wTitle').textContent = 'Word-oplæg: ' + u.title;
    const W = parsed(u), body = document.getElementById('wBody'), gen = document.getElementById('wGen');
    const ok = W && W.roles && W.roles.length;
    gen.textContent = W ? 'Generér igen' : 'Generér oplæg'; gen.disabled = BUSY;
    document.getElementById('wDl').disabled = BUSY || !ok;
    if (!ok) { body.innerHTML = BUSY ? '' : '<div class="empty">Der er ikke lavet et oplæg endnu. Tryk “Generér oplæg”.</div>'; return }
    const N = total(W), many = W.roles.length > 1 || N > 1;
    body.innerHTML = (many ? `<div class="card" style="margin-bottom:12px;border-left:4px solid var(--pri)"><b>Udbuddet søger ${N} personer</b><ul style="margin:4px 0 0 18px;padding:0">${W.roles.map(r => `<li>${antal(r)} × ${esc(r.titel)}</li>`).join('')}</ul></div>` : '') +
      W.roles.map((r, i) => `<div class="card" style="margin-bottom:12px">
      <b style="font-size:16px">${many ? `Stilling ${i + 1} af ${W.roles.length}: ` : ''}${esc(r.titel || u.title)}${antal(r) > 1 ? ` (${antal(r)} personer)` : ''}</b>
      ${SECTIONS.map(([h, keys]) => { const L = items(r, keys); return L.length ? `<div style="margin-top:8px"><div style="font-weight:600;font-size:13px;color:var(--mut)">${esc(h)}</div><ul style="margin:2px 0 0 18px;padding:0">${L.map(x => `<li style="${x.lvl ? 'margin-left:18px;list-style:circle' : ''}">${esc(x.t)}</li>`).join('')}</ul></div>` : '' }).join('')}
    </div>`).join('') + (W.at ? `<small style="color:var(--mut)">Lavet ${new Date(W.at).toLocaleString('da-DK')}</small>` : '');
  }
  function open(id) { CUR = id; const d = dlg(); msg(''); show(); if (!d.open) d.showModal(); const W = parsed(S.udbud.find(x => x.id === id)); if (!W || W.v !== 2) generate() }

  /* ---------- udbudstekst ---------- */
  async function tenderText(u, say) {
    say = say || (() => {});
    if (u.docText && String(u.docText).length > 800) return String(u.docText);
    const files = (u.files || []).filter(f => f.fileId && /\.(pdf|docx)$/i.test(f.fileName || '') && !SKIP.test(f.fileName || ''));
    files.sort((a, b) => (PRIO.test(b.fileName) ? 1 : 0) - (PRIO.test(a.fileName) ? 1 : 0));
    let out = '', n = 0;
    for (const f of files.slice(0, 8)) {
      n++; say(`Læser udbudsmaterialet (${n} af ${Math.min(files.length, 8)}): ${f.fileName}`);
      try {
        const url = await UB.blobUrl(f.fileId), blob = await (await fetch(url)).blob();
        const { text } = await fileText(new File([blob], f.fileName, { type: blob.type }), true);
        if (text && text.trim()) out += `\n\n=== ${f.fileName} ===\n` + text.slice(0, 25000);
      } catch (e) { console.warn('kunne ikke læse', f.fileName, e) }
      if (out.length > 90000) break;
    }
    out = out.slice(0, 90000);
    if (out.length > 800) { try { await upd('udbud', u.id, { docText: out }) } catch (e) { } }
    return out;
  }

  /* ---------- AI ---------- */
  async function generate() {
    const u = S.udbud.find(x => x.id === CUR); if (!u || BUSY) return;
    if (!SAMPLE) return msg('AI er ikke tilgængelig.', 'bad');
    BUSY = true; show();
    try { const W = await genFor(u, msg); const N = total(W); msg(W.roles.length > 1 || N > 1 ? `Udbuddet søger ${N} personer fordelt på ${W.roles.length} ${W.roles.length > 1 ? 'roller' : 'rolle'} – det står tydeligt i oplægget.` : '') }
    catch (e) { msg('Kunne ikke lave oplægget: ' + (e.message || e), 'bad') }
    BUSY = false; show();
  }
  async function genFor(u, say) {
    say = say || (() => {});
    {
      const text = await tenderText(u, say);
      if (text.length < 300 && !u.desc && !u.must) throw new Error('Der er ikke noget udbudsmateriale at læse. Upload udbuddets dokumenter (PDF eller Word) først.');
      say('Skriver oplægget … (typisk 20-60 sekunder)');
      const prompt = `Du skriver OS Groups kandidatoplæg ud fra et udbud. Oplægget præsenterer udbuddet som et jobopslag til en mulig kandidat (konsulent), så kandidaten kan læse, hvad opgaven går ud på, hvor og hvornår den udføres, hvilke krav der stilles til erfaring, uddannelse og kurser, hvilken dokumentation kandidaten skal levere, og hvilken profil der søges.

REGLER
- Brug KUN oplysninger, der står i udbudsmaterialet nedenfor. Opfind intet, og gæt ikke.
- Findes en oplysning ikke i materialet, skal feltet være en tom liste. Skriv aldrig "Ikke angivet" eller lignende.
- Udelad ordregiverens/kundens navn, priser og timepriser, tilbudsfrister, evalueringskriterier, udbudsprocedure og juridiske kontraktvilkår. Arbejdsstedets adresse må gerne med.
- Søger udbuddet flere personer, skal det fremgå tydeligt: lav én post i "roles" pr. forskellig rolle, og sæt "antal" til hvor mange personer udbuddet søger til netop den rolle (fx 2, hvis der søges to tilsynsførende). Søges én person, er antal 1. Fælles oplysninger (arbejdssted, periode, omfang osv.) gentages i hver rolle. Krav, der kun gælder én rolle, kommer kun med under den rolle.
- Skriv på dansk i korte, klare punkter, som i dette eksempel fra et af OS Groups oplæg:
  Opgavebeskrivelse: "In-house konsulent til jord- og afvandingsfagtilsyn på Kalundborgmotorvejens 3. etape.", "Gennemføre materiale- og mængdekontrol.", "- Opgøre udført arbejde til aconto-begæringer og ekstraarbejder."
  Ansættelsesperioder: "Medio oktober 2026 til oktober 2028."
  Belastningsgrad: "Fuldtid, 37 timer ugentligt ekskl. frokost og transport til og fra tilsynskontoret."
  Erfaring: "5–10 års relevant erfaring med fagtilsyn på større vej- eller anlægsprojekter.", "- Erfaringen skal omfatte jord- og afvandingsarbejder."
  Uddannelse: "Vejen som Arbejdsplads, trin 2.", "- Hvis kurset ikke er gennemført, skal det gennemføres hurtigst muligt efter opstart."
  Dokumentation: "CV på maksimalt 2 sider med kandidatens uddannelse, uddannelsesår, relevante kurser og gennemførelsesår."
- Et underpunkt til punktet lige før skrives som en streng, der starter med "- ".
- Feltbetydning:
  titel: rollens titel, kort, fx "Jord-Fagtilsyn" eller "Projekteringsleder – Føringsveje".
  antal: antal personer, der søges til rollen (heltal).
  intro: 1-2 sætninger, der præsenterer rollen for en kandidat (uden kundens navn).
  opgaver: hvad konsulenten skal lave.
  arbejdssted: adresse/by/område og krav til fysisk tilstedeværelse.
  periode: ansættelses-/kontraktperiode(r) og opstart.
  forlaengelse: optioner/mulighed for forlængelse.
  omfang: belastningsgrad – timer pr. uge, fuld tid/deltid, dage på stedet.
  erfaring: krav til erfaring og kvalifikationer (antal år, typer og størrelse af projekter, personlige kompetencer).
  sprog: krav til sprog.
  fordel: kompetencer der er en fordel/bør-krav – skriv dem som hele punkter, der slutter med "er en fordel".
  uddannelse: krav til uddannelse.
  certificering: krav til kurser, certifikater, godkendelser eller sikkerhedsgodkendelse.
  dokumentation: hvad kandidaten skal dokumentere/levere (CV-krav, referencer, beskrivelse af opgaver, ansættelsesdokumentation osv.).
  profil: 3-5 punkter, der opsummerer den søgte profil, udelukkende ud fra materialet.

Returnér KUN JSON: {"roles":[{"titel":"","antal":1,"intro":"","opgaver":[],"arbejdssted":[],"periode":[],"forlaengelse":[],"omfang":[],"erfaring":[],"sprog":[],"fordel":[],"uddannelse":[],"certificering":[],"dokumentation":[],"profil":[]}]}

UDBUD: ${u.title}${u.period ? '\nPeriode (fra platformen): ' + u.period : ''}${u.location ? '\nSted (fra platformen): ' + u.location : ''}${u.desc ? '\nBeskrivelse: ' + u.desc : ''}

UDBUDSMATERIALE:
${text || '(ingen dokumenttekst)'}`;
      const j = await SAMPLE.json(prompt, { modelTier: 'default' });
      const roles = (j && Array.isArray(j.roles) ? j.roles : []).map(r => { const o = { titel: String(r.titel || '').trim(), antal: antal(r), intro: String(r.intro || '').trim() }; FIELDS.forEach(k => (o[k] = arr(r[k]))); return o }).filter(r => r.titel || r.opgaver.length);
      if (!roles.length) throw new Error('AI fandt ingen roller i udbuddet.');
      const W = { v: 2, roles, at: Date.now() }, wo = JSON.stringify(W);
      await upd('udbud', u.id, { wo }); u.wo = wo;
      return W;
    }
  }

  /* ---------- Word ---------- */
  let libP = null;
  const lib = () => libP || (libP = new Promise((res, rej) => { if (window.docx) return res(window.docx); const s = document.createElement('script'); s.src = 'vendor/docx.iife.js'; s.onload = () => res(window.docx); s.onerror = () => rej(new Error('Word-modulet kunne ikke hentes')); document.head.appendChild(s) }));
  const bin = async p => new Uint8Array(await (await fetch(p)).arrayBuffer());

  async function download() {
    const u = S.udbud.find(x => x.id === CUR), W = parsed(u); if (!W || !W.roles || !W.roles.length) return;
    try {
      msg('Laver Word-dokumentet …');
      const D = await lib(), [cover, logo] = await Promise.all([bin('wo-cover.jpg'), bin('wo-logo.png')]);
      const F = 'Times New Roman', INK = '1F2A33', LINE = 'B4B4CC';
      const run = (t, o = {}) => new D.TextRun({ text: t, font: F, ...o });
      const head = t => new D.Paragraph({ keepNext: true, spacing: { before: 260, after: 60 }, border: { top: { style: D.BorderStyle.SINGLE, size: 6, color: LINE, space: 8 } }, children: [run(t, { bold: true, size: 30, color: INK })] });
      const li = (t, lvl = 0) => new D.Paragraph({ numbering: { reference: 'pkt', level: lvl }, spacing: { after: 30 }, children: [run(t, { size: 21 })] });
      const N = total(W), many = W.roles.length > 1 || N > 1, body = [];
      if (many) {
        body.push(new D.Paragraph({ spacing: { after: 80 }, shading: { type: D.ShadingType.CLEAR, fill: 'EEF1F6' }, children: [run(`Udbuddet søger ${N} personer`, { bold: true, size: 32, color: INK })] }));
        W.roles.forEach((r, i) => body.push(li(`${antal(r)} × ${r.titel || u.title}${W.roles.length > 1 ? ` (se stilling ${i + 1})` : ''}`)));
        body.push(new D.Paragraph({ spacing: { after: 120 }, children: [run('Du kan søge en eller flere af stillingerne. Krav og opgaver for hver stilling er beskrevet nedenfor.', { size: 21, italics: true })] }));
      }
      W.roles.forEach((r, i) => {
        if (W.roles.length > 1) {
          body.push(new D.Paragraph({ pageBreakBefore: i > 0, keepNext: true, spacing: { before: 120, after: 120 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: INK, space: 4 } }, children: [
            run(`Stilling ${i + 1} af ${W.roles.length}: `, { bold: true, size: 26, color: '4A4F57' }), run(r.titel || u.title, { bold: true, size: 34, color: INK }),
            ...(antal(r) > 1 ? [run(`  (${antal(r)} personer)`, { bold: true, size: 26, color: '4A4F57' })] : [])] }));
        } else if (antal(r) > 1) {
          body.push(new D.Paragraph({ spacing: { before: 200 }, children: [] }));
        }
        for (const [h, keys] of SECTIONS) {
          const L = items(r, keys); if (!L.length) continue;
          body.push(head(h)); L.forEach(x => body.push(li(x.t, x.lvl)));
        }
      });
      const footer = new D.Footer({ children: [
        new D.Paragraph({ border: { top: { style: D.BorderStyle.SINGLE, size: 8, color: '444444', space: 4 } }, children: [run('OS Group Aps', { bold: true, size: 18 })] }),
        new D.Paragraph({ children: [run('Søstrupvej 14| 4300 Holbæk | CVR 46161556|', { size: 16 })] }),
        new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES], font: F, size: 18 })] })
      ] });
      const page = { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1300, right: 1300, footer: 500 } };
      const title = W.roles.length === 1 ? (r0 => r0.titel || u.title)(W.roles[0]) : u.title;
      const doc = new D.Document({
        creator: 'OS Group', title: 'OS Group Oplæg - ' + u.title,
        styles: { default: { document: { run: { font: F, size: 21 } } } },
        numbering: { config: [{ reference: 'pkt', levels: [
          { level: 0, format: D.LevelFormat.BULLET, text: '•', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 200 } } } },
          { level: 1, format: D.LevelFormat.BULLET, text: 'o', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 900, hanging: 220 } } } }] }] },
        sections: [
          { properties: { page: { ...page, margin: { top: 0, bottom: 0, left: 1300, right: 1300 } } }, children: [
            new D.Paragraph({ children: [
              new D.ImageRun({ type: 'jpg', data: cover, transformation: { width: 794, height: 1123 }, floating: { horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: D.VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true } }),
              new D.ImageRun({ type: 'png', data: logo, transformation: { width: 150, height: 50 }, floating: { horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.PAGE, offset: 5650000 }, verticalPosition: { relative: D.VerticalPositionRelativeFrom.PAGE, offset: 800000 }, allowOverlap: true } })
            ] }),
            new D.Paragraph({ spacing: { before: 4000 }, children: [run('UDBUD', { bold: true, size: 26, color: '4A4F57', characterSpacing: 120 })] }),
            new D.Paragraph({ spacing: { before: 60 }, children: [run('Titel', { size: 22, color: '4A4F57' })] }),
            new D.Paragraph({ spacing: { before: 20 }, children: [run(title, { bold: true, size: 36, color: '2B3138' })] }),
            ...(many ? [new D.Paragraph({ spacing: { before: 200 }, children: [run(`Søger ${N} personer`, { bold: true, size: 26, color: '2B3138' })] }),
              ...W.roles.map(r => new D.Paragraph({ spacing: { before: 20 }, children: [run(`${antal(r)} × ${r.titel || u.title}`, { size: 22, color: '2B3138' })] }))] : [])
          ] },
          { properties: { page }, footers: { default: footer }, children: body.length ? body : [new D.Paragraph('')] }
        ]
      });
      const blob = await D.Packer.toBlob(doc);
      const name = ('OS Group Oplæg - ' + u.title).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.docx';
      const dl = await claude.use('downloads'); await dl.save({ filename: name, data: blob });
      msg('');
    } catch (e) { msg('Kunne ikke lave Word-filen: ' + (e.message || e), 'bad') }
  }
  /* Knappen "Word-oplæg": lav oplægget, hvis det mangler, og hent det som Word med det samme */
  async function quick(id) {
    open(id);
    const u = S.udbud.find(x => x.id === id), W = parsed(u);
    if (W && W.v === 2) return download();
    for (let i = 0; i < 240 && (BUSY || !(parsed(S.udbud.find(x => x.id === id)) || {}).v); i++) await new Promise(r => setTimeout(r, 500));
    if ((parsed(S.udbud.find(x => x.id === id)) || {}).v === 2) download();
  }

  /* Baggrund: lav oplæg til aktive udbud, der mangler et (bruges også til hjemmesidens jobopslag) */
  const ACTIVE = ['NYT', 'VALGT', 'MATCHET', 'OPLÆG_GENERERET', 'Ny', 'Under udarbejdelse'];
  const tried = new Set();
  async function autoTick() {
    if (BUSY || !window.UB || !UB.isAdmin || !SAMPLE || typeof S === 'undefined') return;
    const today = new Date().toISOString().slice(0, 10);
    const u = S.udbud.find(x => (!x.wo || (parsed(x) || {}).v !== 2) && !tried.has(x.id) && ACTIVE.includes(x.status) && (!x.deadline || x.deadline >= today) && ((x.files || []).length || x.docText));
    if (!u) return;
    tried.add(u.id); BUSY = true;
    try { await genFor(u); console.info('Word-oplæg lavet automatisk:', u.title) } catch (e) { console.warn('Automatisk oplæg fejlede for', u.title, e) }
    BUSY = false; if (CUR === u.id && document.getElementById('dW')?.open) show();
  }
  setInterval(autoTick, 45000); setTimeout(autoTick, 15000);

  /* Overtag knappen "Word-oplæg" på hvert udbud */
  window.owf = () => true;
  window.owDl = quick;
  window.openOffer = open;   /* "Lav oplæg" = kandidatoplæg (ikke tilbudstekst) */
  window.WO = { open, generate, download, quick };
})();
