# OS Group – udbudsplatform (udbud.osgroup.dk)

Selvstændig udgave af udbudsplatformen og CV-banken, der tidligere kørte i Claude.
Hostes på GitHub Pages. Login, data og filer ligger i OS Groups Supabase-projekt (samme projekt som tid.osgroup.dk), men i egne tabeller.

- `index.html` – selve platformen (uændret logik fra Claude-portalen)
- `ub.js` / `ub.css` – login med e-mail, brugere, forbindelse til Supabase (database, filer, AI, download)
- `supabase/schema.sql` – tabeller `udbud_docs`, `udbud_members`, bucket `udbud` og adgangsregler
- `supabase/functions/udbud-invite` – invitér/fjern brugere (kun admin)
- `supabase/functions/udbud-ai` – AI-funktionerne. Kræver secret `ANTHROPIC_API_KEY` i Supabase.

Ingen CV'er eller persondata ligger i dette repo.
