// Edge Function "udbud-invite" – brugerstyring til udbud.osgroup.dk. Kun udbuds-administratorer.
// Handlinger (body.action): "invite" {email,name,role}, "role" {user_id,role}, "remove" {user_id}, "resend" {user_id}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const ORIGIN = 'https://udbud.osgroup.dk'
const SITE = 'https://udbud.osgroup.dk/'
const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authed = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return json({ error: 'Ikke logget ind.' }, 401)
    const admin = createClient(url, srv, { auth: { persistSession: false } })
    const { data: me } = await admin.from('udbud_members').select('role').eq('user_id', user.id).maybeSingle()
    if (!me || me.role !== 'admin') return json({ error: 'Kun administratorer.' }, 403)

    const b = await req.json().catch(() => ({}))
    const role = b.role === 'admin' ? 'admin' : 'member'

    if (b.action === 'invite') {
      const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Ugyldig e-mail.' }, 400)
      // Findes brugeren allerede (fx fra tidsregistreringen)?
      let uid: string | null = null, existed = false
      for (let page = 1; page <= 20 && !uid; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw error
        const f = data.users.find(u => (u.email || '').toLowerCase() === email)
        if (f) { uid = f.id; existed = true }
        if (data.users.length < 200) break
      }
      if (!uid) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: SITE, data: { name } })
        if (error) throw error
        uid = data.user.id
      }
      const { error: e2 } = await admin.from('udbud_members').upsert({ user_id: uid, email, name, role }, { onConflict: 'user_id' })
      if (e2) throw e2
      return json({ ok: true, existed })
    }

    if (b.action === 'resend') {
      const { data: m } = await admin.from('udbud_members').select('email').eq('user_id', b.user_id).maybeSingle()
      if (!m) return json({ error: 'Brugeren findes ikke.' }, 404)
      const { data: u } = await admin.auth.admin.getUserById(b.user_id)
      if (u?.user?.last_sign_in_at) {
        // Har allerede logget ind: send et link til at vælge ny adgangskode i stedet
        const { error } = await authed.auth.resetPasswordForEmail(m.email, { redirectTo: SITE })
        if (error) throw error
        return json({ ok: true, reset: true })
      }
      const { error } = await admin.auth.admin.inviteUserByEmail(m.email, { redirectTo: SITE })
      if (error) throw error
      return json({ ok: true })
    }

    if (b.action === 'role') {
      if (b.user_id === user.id && role !== 'admin') return json({ error: 'Du kan ikke fjerne din egen admin-rolle.' }, 400)
      const { error } = await admin.from('udbud_members').update({ role }).eq('user_id', b.user_id)
      if (error) throw error
      return json({ ok: true })
    }

    if (b.action === 'remove') {
      if (b.user_id === user.id) return json({ error: 'Du kan ikke fjerne dig selv.' }, 400)
      // Fjerner kun adgangen til udbudsplatformen – kontoen bevares (den kan bruges i tidsregistreringen)
      const { error } = await admin.from('udbud_members').delete().eq('user_id', b.user_id)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ error: 'Ukendt handling.' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
