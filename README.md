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
| `npm test` | Einingstestar for reknemotor, planar, parsing, import, chat-verktøy og deling |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run db:types` | Genererer `lib/supabase/database.types.ts` frå det kopla prosjektet |

## Struktur

| Sti | Innhald |
|---|---|
| `lib/loan-engine` | Rein reknemotor: saldo, renter og hovudbok frå transaksjonar og satsar |
| `lib/import` | Parsing og kolonnemapping for innlimte rader, CSV og Excel |
| `lib/loans.ts` | Hentar lån frå Supabase og køyrer reknemotoren |
| `lib/projection.ts`, `lib/plan.ts` | Framskriving frå saldoen i dag, nedbetalingsplanar og status mot plan |
| `lib/sharing.ts` | Invitasjonslenker: token, hash og tolking av svar frå databasen |
| `lib/chat` | Chat: leseverktøy for lån, simulering og samtale-løkka mot Claude |
| `app/api/chat` | Server-rute som strøymer svaret til chat-skjermen |
| `app/(app)` | Innlogga sider og server actions |
| `app/login`, `app/auth/confirm` | Innlogging med lenke på e-post |
| `components` | UI-komponentar med Material 3-tokens (`app/globals.css`) |
| `supabase/migrations` | Skjema og tilgangsreglar (RLS) |

## Planar og påminningar

Ein plan er eit fast månadsbeløp (eller ein måldato som appen reknar om til eit beløp), eventuelt med
ekstra innbetalingar. Planar blir berre simulerte, frå den faktiske saldoen i dag. Planen du følgjer
gir spørsmålet «Betalte du … ?» når ei betaling har forfalle utan å vere ført, og viser om du ligg
føre eller bak. Varsel utanfor appen (push, e-post) er ikkje bygd.

## Deling

Eigaren lagar ei invitasjonslenke på «Deling» under lånet og sender ho sjølv. Den som opnar lenka og
loggar inn, blir medlem med rolla lenka har (`editor` eller `viewer`). Lenka verkar éin gong, og
berre ein hash av ho ligg i databasen. All tilgang blir handheva av RLS og funksjonane i
`supabase/migrations/20261117100000_sharing.sql`.

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
