# MoneyX

Personleg økonomi-app for mobil og nettlesar. Første del er eit privat lån flytta ut av Excel:
transaksjonar inn og ut, rentesatsar over tid, og saldo som alltid blir rekna ut frå desse.

Plan og avgjerder står i [docs/SPEC.md](docs/SPEC.md).

## Stack

Next.js (App Router) · Supabase (Postgres, Auth, RLS) · Claude API · Tailwind CSS · Recharts · Vitest

## Kom i gang

```bash
npm install
cp .env.example .env.local   # Supabase-URL og publishable key, og API-nøkkel for chatten
npm run dev                  # http://localhost:3000
```

Databasen blir sett opp med migrasjonane i `supabase/migrations`:

```bash
supabase link --project-ref <ref>
supabase db push
```

## Kommandoar

| Kommando | Gjer |
|---|---|
| `npm run dev` | Utviklingsserver |
| `npm run build` | Produksjonsbygg |
| `npm test` | Einingstestar for reknemotor, parsing, import og chat-verktøy |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run db:types` | Genererer `lib/supabase/database.types.ts` frå det kopla prosjektet |

## Struktur

| Sti | Innhald |
|---|---|
| `lib/loan-engine` | Rein reknemotor: saldo, renter og hovudbok frå transaksjonar og satsar |
| `lib/import` | Parsing og kolonnemapping for innlimte rader, CSV og Excel |
| `lib/loans.ts` | Hentar lån frå Supabase og køyrer reknemotoren |
| `lib/chat` | Chat: leseverktøy for lån, simulering og samtale-løkka mot Claude |
| `app/api/chat` | Server-rute som strøymer svaret til chat-skjermen |
| `app/(app)` | Innlogga sider og server actions |
| `app/login`, `app/auth/confirm` | Innlogging med lenke på e-post |
| `components` | UI-komponentar med Material 3-tokens (`app/globals.css`) |
| `supabase/migrations` | Skjema og tilgangsreglar (RLS) |

## Chat

Skjermen «Spør» sender spørsmål til `/api/chat`, som kallar Claude med fire leseverktøy
(`lib/chat/tools.ts`). Verktøya hentar data med økta til den innlogga brukaren, så tilgangsreglane
i databasen gjeld, og alle tal kjem frå reknemotoren. Chatten kan ikkje endre noko.

Ruta treng `ANTHROPIC_API_KEY` på serveren (lokalt i `.env.local`, elles i miljøvariablane der
appen køyrer). Utan nøkkel viser skjermen at chatten ikkje er sett opp.

## Innlogging og e-post

Innlogging skjer med lenke på e-post. Supabase sin innebygde e-postutsending leverer berre til
medlemmer av Supabase-organisasjonen og er meint for utvikling. Før andre skal logge inn må
prosjektet få eigen SMTP, og `Site URL` i Supabase Auth må peike på adressa appen køyrer på.

`supabase config push` skriv heile `supabase/config.toml` til prosjektet utan å spørje når han
ikkje køyrer i ein interaktiv terminal. Sjå over diffen før du brukar han.
