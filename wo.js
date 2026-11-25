/* OS Group – Word-oplæg til kandidater.
   Læser udbudsmaterialet, trækker opgave, krav, arbejdssted m.m. ud (kun det, der står i udbuddet)
   og laver et Word-dokument i OS Groups layout, som potentielle konsulenter kan læse. */
(function () {
  'use strict';
  const SKIP = /espd|tro-? ?og-? ?love|st(ø|o)tteerkl|tilbudsbrev|tilbudsliste|persondata|\bcsr\b|konsortie|fortrolighed|tidligere opl|vejledning|bilag [a-e] -|abr forenklet|sbr forenklet/i;
  const PRIO = /opgavebeskrivelse|funktionsbeskrivelse|kompetence|udbudsbetingelser|udbudsbrev|kravspec|kontrakt|aftale/i;
  const SECTIONS = [
    ['opgaver', 'Opgavebeskrivelse'], ['arbejdssted', 'Arbejdssted'], ['periode', 'Periode'],
    ['forlaengelse', 'Mulighed for forlængelse'], ['omfang', 'Belastningsgrad'], ['uddannelse', 'Krav til uddannelse'],
    ['erfaring', 'Krav til erfaring og kvalifikationer'], ['fordel', 'Det er en fordel, hvis du har disse kompetencer'],
    ['sprog', 'Sprog'], ['certificering', 'Certificeringer og godkendelser'], ['profil', 'Profil']
  ];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const arr = v => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x).trim()).filter(x => x && !/^ikke angivet\.?$/i.test(x));
  let CUR = null, BUSY = false;

  /* ---------- dialog ---------- */
  function dlg() {
    let d = document.getElementById('dW');
    if (d) return d;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="dW"><div class="mh" id="wTitle">Word-oplæg</div><div class="mb" style="display:block">
      <p class="sub" style="margin:0 0 10px">Oplægget skrives til potentielle konsulenter: hvad opgaven går ud på, krav til uddannelse og erfaring, arbejdssted, omfang m.m. Kun oplysninger, der står i udbuddet, kommer med. Ordregiverens navn, priser og frister udelades.</p>
      <div id="wMsg" class="note" hidden></div><div id="wBody"></div></div>
      <div class="mf"><button class="btn g" data-wclose>Luk</button><button class="btn g" id="wGen">Generér oplæg</button></div></dialog>`);
    d = document.getElementById('dW');
    d.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-wclose')) d.close();
      else if (t.id === 'wGen') generate();
      else if (t.dataset.wdl != null) download(+t.dataset.wdl);
    });
    return d;
  }
  const msg = (t, kind) => { const m = document.getElementById('wMsg'); m.hidden = !t; m.textContent = t || ''; m.style.color = kind === 'bad' ? 'var(--bad)' : '' };
  const parsed = u => { try { return u.wo ? JSON.parse(u.wo) : null } catch (e) { return null } };
  function show() {
    const u = S.udbud.find(x => x.id === CUR); if (!u) return;
    document.getElementById('wTitle').textContent = 'Word-oplæg: ' + u.title;
    const W = parsed(u), body = document.getElementById('wBody'), gen = document.getElementById('wGen');
    gen.textContent = W ? 'Generér igen' : 'Generér oplæg'; gen.disabled = BUSY;
    if (!W || !W.roles || !W.roles.length) { body.innerHTML = BUSY ? '' : '<div class="empty">Der er ikke lavet et oplæg endnu. Tryk “Generér oplæg”.</div>'; return }
    body.innerHTML = W.roles.map((r, i) => `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><b style="font-size:16px">${esc(r.titel || u.title)}</b><button class="btn s" data-wdl="${i}">Download Word</button></div>
      ${SECTIONS.map(([k, h]) => { const L = arr(r[k]); return L.length ? `<div style="margin-top:8px"><div style="font-weight:600;font-size:13px;color:var(--mut)">${esc(h)}</div><ul style="margin:2px 0 0 18px;padding:0">${L.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '' }).join('')}
    </div>`).join('') + (W.at ? `<small style="color:var(--mut)">Lavet ${new Date(W.at).toLocaleString('da-DK')}</small>` : '');
  }
  function open(id) { CUR = id; const d = dlg(); msg(''); show(); if (!d.open) d.showModal(); if (!parsed(S.udbud.find(x => x.id === id))) generate() }

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
    try { const n = await genFor(u, msg); msg(n > 1 ? `Udbuddet efterspørger ${n} roller – der er et oplæg til hver.` : '') }
    catch (e) { msg('Kunne ikke lave oplægget: ' + (e.message || e), 'bad') }
    BUSY = false; show();
  }
  async function genFor(u, say) {
    say = say || (() => {});
    {
      const text = await tenderText(u, say);
      if (text.length < 300 && !u.desc && !u.must) throw new Error('Der er ikke noget udbudsmateriale at læse. Upload udbuddets dokumenter (PDF eller Word) først.');
      say('Skriver oplægget … (typisk 20-60 sekunder)');
      const prompt = `Du skriver et oplæg til potentielle konsulenter/kandidater for den danske konsulentvirksomhed OS Group, ud fra et udbud. Kandidaten skal kunne læse, hvad opgaven går ud på, og hvilke krav der stilles til uddannelse, erfaring osv.

REGLER
- Brug KUN oplysninger, der står i udbudsmaterialet nedenfor. Opfind intet, og gæt ikke.
- Findes en oplysning ikke i materialet, skal feltet være en tom liste. Skriv aldrig "Ikke angivet" eller lignende.
- Udelad ordregiverens/kundens navn, priser og timepriser, tilbudsfrister, evalueringskriterier, udbudsprocedure og juridiske kontraktvilkår.
- Efterspørger udbuddet flere roller (fx projekteringsleder, specialist og teknisk tegner), så lav én post i "roles" pr. rolle. Fælles oplysninger (arbejdssted, periode, omfang osv.) gentages i hver rolle, men kun hvis de står i materialet. Krav, der kun gælder én rolle, kommer kun med under den rolle.
- Skriv på dansk i korte, klare punkter i stil med: "Samlet ansvar for ledelse og levering af …", "Varetage den daglige ledelse af …", "Dokumenteret erfaring med …".
- Feltbetydning:
  titel: rollens titel, evt. med kort kontekst efter tankestreg, fx "Project Director – Datacenter".
  opgaver: hvad konsulenten skal lave.
  arbejdssted: by/område/adresse og krav til fysisk tilstedeværelse.
  periode: kontraktperiode og opstart.
  forlaengelse: optioner/mulighed for forlængelse.
  omfang: timer pr. uge, dage på stedet, fuld tid/deltid (belastningsgrad).
  uddannelse: krav til uddannelse.
  erfaring: mindstekrav/skal-krav til erfaring og kvalifikationer (fx antal år, typer og størrelse af projekter).
  fordel: ønsker/bør-krav/forhold der vurderes positivt.
  sprog: krav til sprog.
  certificering: krav til certifikater, godkendelser, sikkerhedsgodkendelse eller kurser.
  profil: 2-4 punkter, der opsummerer den efterspurgte profil, udelukkende ud fra materialet.
  intro: 1-2 sætninger til et jobopslag, der fortæller, hvad rollen går ud på (uden kundens navn).

Returnér KUN JSON: {"roles":[{"titel":"","intro":"","opgaver":[],"arbejdssted":[],"periode":[],"forlaengelse":[],"omfang":[],"uddannelse":[],"erfaring":[],"fordel":[],"sprog":[],"certificering":[],"profil":[]}]}

UDBUD: ${u.title}${u.period ? '\nPeriode (fra platformen): ' + u.period : ''}${u.location ? '\nSted (fra platformen): ' + u.location : ''}${u.desc ? '\nBeskrivelse: ' + u.desc : ''}

UDBUDSMATERIALE:
${text || '(ingen dokumenttekst)'}`;
      const j = await SAMPLE.json(prompt, { modelTier: 'default' });
      const roles = (j && Array.isArray(j.roles) ? j.roles : []).map(r => { const o = { titel: String(r.titel || '').trim(), intro: String(r.intro || '').trim() }; SECTIONS.forEach(([k]) => (o[k] = arr(r[k]))); return o }).filter(r => r.titel || r.opgaver.length);
      if (!roles.length) throw new Error('AI fandt ingen roller i udbuddet.');
      const wo = JSON.stringify({ roles, at: Date.now() });
      await upd('udbud', u.id, { wo }); u.wo = wo;
      return roles.length;
    }
  }

  /* ---------- Word ---------- */
  let libP = null;
  const lib = () => libP || (libP = new Promise((res, rej) => { if (window.docx) return res(window.docx); const s = document.createElement('script'); s.src = 'vendor/docx.iife.js'; s.onload = () => res(window.docx); s.onerror = () => rej(new Error('Word-modulet kunne ikke hentes')); document.head.appendChild(s) }));
  const bin = async p => new Uint8Array(await (await fetch(p)).arrayBuffer());

  async function download(i) {
    const u = S.udbud.find(x => x.id === CUR), W = parsed(u), r = W && W.roles[i]; if (!r) return;
    try {
      msg('Laver Word-dokumentet …');
      const D = await lib(), [cover, logo] = await Promise.all([bin('wo-cover.jpg'), bin('wo-logo.png')]);
      const F = 'Times New Roman', INK = '1F2A33', LINE = 'B4B4CC';
      const run = (t, o = {}) => new D.TextRun({ text: t, font: F, ...o });
      const head = t => new D.Paragraph({ keepNext: true, spacing: { before: 260, after: 60 }, border: { top: { style: D.BorderStyle.SINGLE, size: 6, color: LINE, space: 8 } }, children: [run(t, { bold: true, size: 30, color: INK })] });
      const sub = t => new D.Paragraph({ keepNext: true, spacing: { before: 100, after: 20 }, children: [run(t, { bold: true, size: 22, color: INK })] });
      const li = (t, lvl = 0) => new D.Paragraph({ numbering: { reference: 'pkt', level: lvl }, spacing: { after: 30 }, children: [run(t, { size: 21 })] });
      const body = [];
      for (const [k, h] of SECTIONS) {
        const L = r[k] || []; if (!L.length) continue;
        if (k === 'fordel' && (r.erfaring || []).length) { body.push(sub(h)); L.forEach(x => body.push(li(x, 1))); continue }
        body.push(head(h)); L.forEach(x => body.push(li(x)));
      }
      const footer = new D.Footer({ children: [
        new D.Paragraph({ border: { top: { style: D.BorderStyle.SINGLE, size: 8, color: '444444', space: 4 } }, children: [run('OS Group Aps', { bold: true, size: 18 })] }),
        new D.Paragraph({ children: [run('Søstrupvej 14| 4300 Holbæk | CVR 46161556|', { size: 16 })] }),
        new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES], font: F, size: 18 })] })
      ] });
      const page = { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1300, right: 1300, footer: 500 } };
      const doc = new D.Document({
        creator: 'OS Group', title: r.titel || u.title,
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
            new D.Paragraph({ spacing: { before: 4300 }, children: [run('Titel', { bold: true, size: 22, color: '4A4F57' })] }),
            new D.Paragraph({ spacing: { before: 40 }, children: [run(r.titel || u.title, { bold: true, size: 40, color: '2B3138' })] })
          ] },
          { properties: { page }, footers: { default: footer }, children: body.length ? body : [new D.Paragraph('')] }
        ]
      });
      const blob = await D.Packer.toBlob(doc);
      const many = W.roles.length > 1;
      const name = ('OS Group Oplæg - ' + u.title + (many ? ' - ' + (r.titel || (i + 1)) : '')).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) + '.docx';
      const dl = await claude.use('downloads'); await dl.save({ filename: name, data: blob });
      msg('');
    } catch (e) { msg('Kunne ikke lave Word-filen: ' + (e.message || e), 'bad') }
  }

  /* Baggrund: lav oplæg til aktive udbud, der mangler et (bruges også til hjemmesidens jobopslag) */
  const ACTIVE = ['NYT', 'VALGT', 'MATCHET', 'OPLÆG_GENERERET', 'Ny', 'Under udarbejdelse'];
  const tried = new Set();
  async function autoTick() {
    if (BUSY || !window.UB || !UB.isAdmin || !SAMPLE || typeof S === 'undefined') return;
    const today = new Date().toISOString().slice(0, 10);
    const u = S.udbud.find(x => !x.wo && !tried.has(x.id) && ACTIVE.includes(x.status) && (!x.deadline || x.deadline >= today) && ((x.files || []).length || x.docText));
    if (!u) return;
    tried.add(u.id); BUSY = true;
    try { await genFor(u); console.info('Word-oplæg lavet automatisk:', u.title) } catch (e) { console.warn('Automatisk oplæg fejlede for', u.title, e) }
    BUSY = false; if (CUR === u.id && document.getElementById('dW')?.open) show();
  }
  setInterval(autoTick, 45000); setTimeout(autoTick, 15000);

  /* Overtag knappen "Word-oplæg" på hvert udbud */
  window.owf = () => true;
  window.owDl = open;
  window.WO = { open, generate, download };
})();
