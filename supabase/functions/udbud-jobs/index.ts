// Edge Function "udbud-jobs" – offentlig liste over jobopslag til osgroup.dk/aabne-stillinger.
// Bygges ud fra aktive udbud på udbud.osgroup.dk, der har et Word-oplæg (feltet "wo").
// Indeholder kun det, der også vises offentligt på hjemmesiden (ingen kundenavne, priser eller filer).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const ACTIVE = ['NYT', 'VALGT', 'MATCHET', 'OPLÆG_GENERERET', 'Ny', 'Under udarbejdelse']
const MDR = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december']
const arr = (v: unknown) => (Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(x => x && !/^ikke angivet\.?$/i.test(x))
const slug = (s: string) => s.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const dkDate = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[3]}. ${MDR[+m[2] - 1]} ${m[1]}` : '' }
const short = (s: string) => { const t = s.split(/(?<=[a-zæøå])\.\s|;/i)[0].replace(/\.$/, '').trim(); return t.length > 70 ? t.slice(0, 67).trim() + '…' : t }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    let srv = ''
    try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); srv = k.default || Object.values(k)[0] as string || '' } catch { /* ingen */ }
    if (!srv) srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const db = createClient(url, srv, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await db.from('udbud_docs').select('id,data').eq('collection', 'udbud')
    if (error) throw error
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' })
    const jobs: unknown[] = []
    for (const row of data || []) {
      const u = row.data || {}
      if (!ACTIVE.includes(u.status)) continue
      if (u.deadline && String(u.deadline).slice(0, 10) < today) continue
      let W: { roles?: Record<string, unknown>[] } | null = null
      try { W = u.wo ? JSON.parse(u.wo) : null } catch { W = null }
      if (!W || !Array.isArray(W.roles)) continue
      W.roles.forEach((r, i) => {
        const titel = String(r.titel || u.title || '').trim(); if (!titel) return
        const opg = arr(r.opgaver), sted = arr(r.arbejdssted)
        const rammer = [...sted, ...arr(r.periode), ...arr(r.forlaengelse), ...arr(r.omfang)]
        const krav = [...arr(r.uddannelse), ...arr(r.erfaring), ...arr(r.sprog), ...arr(r.certificering)]
        const sections = [
          opg.length && { heading: 'Opgaven', items: opg, paras: [] },
          rammer.length && { heading: 'Rammer', items: rammer, paras: [] },
          krav.length && { heading: 'Vi søger', items: krav, paras: [] },
          arr(r.fordel).length && { heading: 'Det er en fordel, hvis du har erfaring med', items: arr(r.fordel), paras: [] },
          arr(r.profil).length && { heading: 'Profil', items: arr(r.profil), paras: [] },
        ].filter(Boolean)
        jobs.push({
          id: slug(titel) + '-' + slug(row.id).slice(0, 8) + (W!.roles!.length > 1 ? '-' + (i + 1) : ''),
          source: 'udbud:' + row.id,
          title: titel,
          location: sted.length ? short(sted[0]) : (u.location ? short(String(u.location)) : 'Efter aftale'),
          deadline: dkDate(String(u.deadline || '')),
          intro: String(r.intro || '').trim() || opg[0] || '',
          sections,
          status: 'aktiv',
        })
      })
    }
    return json({ updated: new Date().toISOString(), count: jobs.length, jobs })
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
