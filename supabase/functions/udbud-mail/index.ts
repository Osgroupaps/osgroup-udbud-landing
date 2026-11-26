// Edge Function "udbud-mail" – sender mails til kandidater fra udbud.osgroup.dk via Simply (smtp.simply.com).
// Kun medlemmer af udbudsplatformen. Body: { to, subject, text }
// Secrets:
//   MAIL_SMTP_USER  (påkrævet) fx noreply@osgroup.dk – senere kontakt@osgroup.dk
//   MAIL_SMTP_PASS  (påkrævet) adgangskoden til den postkasse
//   MAIL_SMTP_PORT  (valgfri, standard 2525 – Supabase tillader ikke port 25 og 587)
//   MAIL_FROM_NAME  (valgfri, standard "OS Group")
//   MAIL_REPLY_TO   (valgfri, standard kontakt@osgroup.dk)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'
const ORIGIN = 'https://udbud.osgroup.dk'
const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const authed = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return json({ error: 'Ikke logget ind.' }, 401)
    const { data: ok } = await authed.rpc('udbud_is_member')
    if (!ok) return json({ error: 'Ingen adgang til udbudsplatformen.' }, 403)

    const smtpUser = Deno.env.get('MAIL_SMTP_USER') || '', smtpPass = Deno.env.get('MAIL_SMTP_PASS') || ''
    if (!smtpUser || !smtpPass) return json({ error: 'Mail er ikke sat op endnu (MAIL_SMTP_USER / MAIL_SMTP_PASS mangler i Supabase).' }, 500)

    const b = await req.json().catch(() => ({}))
    const to = String(b.to || '').trim(), subject = String(b.subject || '').trim(), text = String(b.text || '')
    if (!EMAIL.test(to)) return json({ error: 'Ugyldig modtageradresse.' }, 400)
    if (!subject || subject.length > 200) return json({ error: 'Emnet mangler eller er for langt.' }, 400)
    if (text.trim().length < 10 || text.length > 20000) return json({ error: 'Teksten mangler eller er for lang.' }, 400)

    const port = Number(Deno.env.get('MAIL_SMTP_PORT') || 2525)
    const t = nodemailer.createTransport({
      host: 'smtp.simply.com', port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: smtpUser, pass: smtpPass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000
    })
    const fromName = Deno.env.get('MAIL_FROM_NAME') || 'OS Group'
    const replyTo = Deno.env.get('MAIL_REPLY_TO') || 'kontakt@osgroup.dk'
    const info = await t.sendMail({ from: { name: fromName, address: smtpUser }, to, replyTo, subject, text })
    return json({ ok: true, id: info.messageId, from: smtpUser, replyTo })
  } catch (e) {
    return json({ error: 'Mailen kunne ikke sendes: ' + ((e as Error).message || String(e)) }, 500)
  }
})
