# MoneyX – spesifikasjon v0.2

Personleg økonomi-app for mobil og nettlesar. Første mål: få eit privat lån ut av Excel og inn i noko
som held saldo, rente og nedbetalingsplan oppdatert av seg sjølv. Deretter: import av banktransaksjonar
for forbruksanalyse, og ein Claude-chat som kan lese og jobbe på dei same dataa.

## 1. Avklarte val

| Tema | Val |
|---|---|
| Lånetype | Privat lån med uregelmessige uttak og innbetalingar |
| Rente | Variabel sats med gyldig-frå-dato (dekker òg fast rente og 0 %) |
| Brukarar | Eigar + motparten i lånet (delt tilgang per lån) |
| Stack | Next.js (App Router) + Supabase (Postgres, Auth, RLS) + Vercel |
| Form | Responsiv, installerbar PWA – ingen app-butikk |
| Rente i dag | 0 % – nye lån startar rentefritt, sats kan leggjast til seinare utan ombygging |
| Motparten | Skrivetilgang: kan registrere transaksjonar sjølv |
| Innlogging | Magisk lenke på e-post (ingen passord) |
| Rekkjefølgje | Chat med leseverktøy kjem rett etter M1 |

## 2. Prinsipp

1. **Transaksjonane er sanninga.** Saldo, påløpt rente og plan blir alltid rekna ut frå transaksjonar
   og rentesatsar – aldri lagra som eigne tal som kan kome i utakt.
2. **Éin reknemotor.** All lånelogikk ligg i ein rein TypeScript-modul (`lib/loan-engine`) utan
   avhengigheiter. UI, API-ruter og Claude-verktøya kallar den same koden.
3. **Pengar er heiltal.** Beløp blir lagra i øre (`bigint`), aldri flyttal.
4. **Chatten reknar ikkje sjølv.** Claude hentar tal via verktøy som kallar reknemotoren, og
   endringar i data krev stadfesting i UI.
5. **Appen skal ikkje bli gløymd.** Excel-arket fall ut av bruk fordi ingenting minte om det.
   Appen tek initiativet: påminningar, eitt-trykks stadfesting og varsel til begge partar.

## 3. Lån

### 3.1 Datamodell

```
loans               id, owner_id, name, direction (borrowed | lent), currency,
                    start_date, capitalization (monthly | yearly | none),
                    day_count (act_365), archived_at
loan_rates          id, loan_id, valid_from, annual_rate_bp        -- basispunkt, 550 = 5,50 %
loan_transactions   id, loan_id, date, amount_ore, kind, note, created_by
                    kind: disbursement | repayment | fee | adjustment
loan_members        loan_id, user_id, role (viewer | editor)       -- motparten
loan_invites        id, loan_id, email, role, token, accepted_at
```

- `direction` avgjer berre forteikn og ordlyd i UI («du skuldar» / «du har til gode»).
- Rente blir **ikkje** lagra som transaksjon. Kapitalisering blir rekna ut av motoren og vist som
  eigne linjer i tidslinja, merka som utrekna.
- Radnivå-tilgang (RLS): eigar har full tilgang, medlemmer etter rolle, ingen andre ser noko.

### 3.2 Reknemotor

Inndata: transaksjonar + rentesatsar + ein «til dato». Utdata: dag-for-dag-hovudbok aggregert til
hendingar.

- Dagleg rente: `saldo × årssats / 365`, akkumulert med full presisjon og avrunda til øre ved
  kapitalisering.
- Kapitalisering etter innstillinga på lånet (månadleg, årleg eller aldri – då står renta som eigen
  post ved sida av hovudstolen). Standard er `none` og 0 %, så eit rentefritt lån er rein saldo
  inn og ut. Innstillinga kan endrast seinare og gjeld frå ein vald dato.
- Innbetalingar dekker påløpt rente først, deretter hovudstol.
- Tilbakedaterte transaksjonar eller renteendringar reknar heile historikken på nytt.
- Dekka av einingstestar, inkludert ein test som køyrer Excel-historikken og samanliknar saldoen.

### 3.3 Skjermar

- **Oversikt:** saldo no, påløpt rente, sats, betalt hittil (hovudstol/rente), neste planlagde
  betaling, saldograf over tid (faktisk + plan).
- **Tidslinje:** alle transaksjonar og rentehendingar med løpande saldo. Filtrer på type.
- **Ny transaksjon:** FAB → botnark med beløp, dato, type, notat. Tre trykk frå opna app.
- **Rente:** liste over satsar med gyldig-frå-dato, legg til ny.
- **Deling:** inviter motparten på e-post, vel lese- eller skrivetilgang.
- **Import frå Excel:** lim inn eller last opp eksisterande reknark, map kolonnar (dato, beløp,
  tekst), førehandsvis saldo før lagring.

### 3.4 Påminningar og låg friksjon

```
notification_prefs  user_id, loan_id, channel (push | email), planned_payment, new_activity,
                    monthly_summary
```

- **Planlagd betaling:** på forfallsdagen kjem eit varsel – «Betalte du 4 000 kr i dag?» – med
  *Ja* (registrerer transaksjonen med eitt trykk), *Anna beløp* og *Ikkje enno* (spør att om 3 dagar).
- **Ny aktivitet:** når éin part registrerer noko, får den andre varsel. Begge held dermed lånet
  oppdatert, og ingen blir overraska over saldoen.
- **Månadsoppsummering:** saldo, betalt denne månaden og status mot plan, på e-post den 1.
- **Stille for lenge:** ingen transaksjonar på 45 dagar og ingen aktiv plan → eitt vennleg dytt.
- Kanalar: web-push der PWA-en er installert, e-post som reserve. Alt kan slåast av per lån.

## 4. Nedbetalingsplan

```
loan_plans          id, loan_id, name, is_active, assumed_rate_bp (null = gjeldande sats)
loan_plan_rules     id, plan_id, kind (recurring | one_off), amount_ore,
                    start_date, end_date, day_of_month
```

- Ein plan er eit sett reglar: fast beløp per månad, og/eller eingongsbetalingar på gitte datoar.
- Motoren simulerer framover **frå faktisk saldo i dag**, så planen flyttar seg automatisk når ein
  verkeleg transaksjon avvik frå det planlagde.
- Resultat: nedbetalt-dato, total rentekostnad, månadleg tabell, graf.
- Omvendt utrekning: «kva må eg betale per månad for å vere ferdig innan dato X?»
- Fleire planar per lån kan samanliknast side om side (t.d. 3 000 vs. 5 000 kr/md).
- Avvik: tidslinja viser om du ligg føre eller bak aktiv plan.
- Planlagde betalingar frå aktiv plan går inn i ei **framoverretta utgiftsoversikt** per månad.

## 5. Transaksjonsimport og forbruksanalyse

```
accounts            id, owner_id, name, kind
transactions        id, account_id, date, amount_ore, description, category_id,
                    import_id, dedupe_hash
categories          id, owner_id, name, parent_id, kind (expense | income | transfer)
category_rules      id, owner_id, match_text, category_id, priority
imports             id, account_id, filename, mapping_json, row_count, created_at
import_profiles     id, owner_id, name, mapping_json           -- gjenbruk per bank
```

- Parsing skjer i nettlesaren (CSV og XLSX). Støtte for norske format: semikolon, komma som
  desimalteikn, `dd.mm.åååå`, separate inn/ut-kolonnar.
- Kolonnemapping med førehandsvising; mappinga blir lagra som profil per bank.
- Duplikatvern via hash av konto + dato + beløp + tekst, slik at overlappande eksportar er trygge.
- Kategorisering: reglar først, deretter foreslår Claude kategori for resten – du godkjenner, og
  godkjende forslag kan bli nye reglar.
- Analyse: forbruk per kategori per månad, faste vs. variable utgifter, gjentakande trekk
  (abonnement), største endringar mot snittet, og framskriving kombinert med låneplanen.

## 6. Claude-chat

- Server-rute (`/api/chat`) med strøyming; API-nøkkelen ligg berre på serveren.
- Tilgjengeleg som sidepanel på desktop og fullskjerm-ark på mobil, med konteksten til skjermen du
  står på (t.d. gjeldande lån).
- Verktøy:

| Verktøy | Type | Gjer |
|---|---|---|
| `get_loan_summary` | les | Saldo, rente, sats, plan-status |
| `list_loan_transactions` | les | Tidslinje med filter |
| `simulate_plan` | les | Køyrer motoren med vilkårlege reglar/satsar |
| `query_spending` | les | Aggregert forbruk per kategori/periode |
| `search_transactions` | les | Søk i importerte transaksjonar |
| `propose_loan_transaction` | skriv | Lagar utkast – krev stadfesting |
| `propose_plan` | skriv | Lagar planutkast – krev stadfesting |
| `propose_categorization` | skriv | Kategoriforslag/reglar – krev stadfesting |

- Skriveverktøy lagar aldri endringar direkte; dei returnerer eit kort i chatten med «Godkjenn».
- Alle verktøy køyrer med brukaren si økt, så RLS gjeld òg for chatten.

## 7. Design

- Material 3-inspirert: tonale flater, store avrunda kort, tydeleg typografisk hierarki, lys/mørk.
- Navigasjon: botnlinje på mobil, navigasjonsskinne på nettbrett, sidemeny på desktop.
- Mjuke overgangar mellom skjermar, botnark for inndata, optimistiske oppdateringar.
- Tailwind + shadcn/ui med M3-tokens, Recharts for grafar, Motion for animasjon.
- Tal i tabellform med `tabular-nums`, norsk formatering (`1 234,50 kr`).
- PWA: manifest, ikon, installerbar på heimskjerm. Offline er ikkje eit mål i v1.

## 8. Milepælar

| # | Leveranse | Resultat |
|---|---|---|
| M1 | Skjelett, innlogging, låneskjema, reknemotor m/testar, oversikt, tidslinje, ny transaksjon, rentesatsar, Excel-import av lånehistorikk | **Lånet er ute av Excel** |
| M2 | Chat med leseverktøy (lån) | Spør Claude om lånet |
| M3 | Invitasjon av motparten med skrivetilgang, varsel om ny aktivitet | Delt lån |
| M4 | Planar, simulering, samanlikning, avvik, påminning med eitt-trykks stadfesting, månadsoppsummering | Dynamisk plan som minner deg på |
| M5 | Kontoar, CSV/XLSX-import, kategoriar, reglar, analyse | Forbruksanalyse |
| M6 | Chat: forbruksverktøy og skriveverktøy med stadfesting | Claude jobbar på dataa |

## 9. Opne spørsmål

1. Skal lånet ha rente framover, eller held det fram rentefritt? (Kan avgjerast når som helst.)
