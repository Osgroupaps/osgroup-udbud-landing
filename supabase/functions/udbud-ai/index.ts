// Edge Function "udbud-ai" – AI-funktionerne på udbud.osgroup.dk (CV-udtræk, udbud, kravtjek m.m.).
// Kun medlemmer af udbudsplatformen. Svarer altid med JSON: {result: <objekt>} eller {error}.
// Secrets: ANTHROPIC_API_KEY (påkrævet), ANTHROPIC_MODEL (valgfri, standard claude-sonnet-5-5)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const ORIGIN = 'https://udbud.osgroup.dk'
const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

function parseJson(t: string) {
  const s = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(s) } catch { /* fortsæt */ }
  const a = s.search(/[\[{]/)
  if (a >= 0) {
    const open = s[a], close = open === '{' ? '}' : ']', b = s.lastIndexOf(close)
    if (b > a) return JSON.parse(s.slice(a, b + 1))
  }
  throw new Error('AI-svaret var ikke gyldig JSON.')
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const authed = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return json({ error: 'Ikke logget ind.' }, 401)
    const { data: ok } = await authed.rpc('udbud_is_member')
    if (!ok) return json({ error: 'Ingen adgang til udbudsplatformen.' }, 403)

    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) return json({ error: 'AI er ikke sat op endnu (ANTHROPIC_API_KEY mangler i Supabase).', code: 'no_key' }, 503)
    const model = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5'

    const b = await req.json().catch(() => ({}))
    const prompt = String(b.prompt || '')
    if (!prompt) return json({ error: 'Tom forespørgsel.' }, 400)
    const content: unknown[] = []
    for (const img of (Array.isArray(b.images) ? b.images.slice(0, 6) : [])) {
      if (typeof img === 'string' && img.length < 6_000_000) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } })
    }
    content.push({ type: 'text', text: prompt })

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 8000,
        system: 'Du er en hjælpsom assistent for OS Group. Svar udelukkende med gyldig JSON uden forklarende tekst eller kodeblokke.',
        messages: [{ role: 'user', content }],
      }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return json({ error: 'AI-fejl ' + r.status + ': ' + (j?.error?.message || 'ukendt fejl') }, 502)
    const text = (j.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('')
    return json({ result: parseJson(text), usage: j.usage })
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
