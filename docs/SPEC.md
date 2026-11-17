# MoneyX – spesifikasjon v0.4

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
| Innlogging | Magisk lenke på e-post (ingen passord). Kode i e-posten krev eigen SMTP, sjå §9 |
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
loans               id, owner_id, name, counterparty_name, direction (borrowed | lent),
                    currency, start_date, capitalization (monthly | yearly | none),
                    archived_at
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
- **Deling:** lag invitasjonslenke til motparten, vel lese- eller skrivetilgang (sjå 3.4).
- **Import frå Excel:** lim inn eller last opp eksisterande reknark, map kolonnar (dato, beløp,
  tekst), førehandsvis saldo før lagring.

### 3.4 Deling med motparten (bygd i M3)

```
loan_invites        id, loan_id, role (viewer | editor), token_hash, created_by, created_at,
                    expires_at, accepted_by, accepted_at
loan_views          loan_id, user_id, last_seen_at
```

- **Invitasjonslenke, ikkje e-post:** eigaren lagar ei lenke og sender ho sjølv. Lenka verkar éin
  gong og i 14 dagar, og kan trekkjast tilbake. Berre ein hash av lenka blir lagra, så ho blir vist
  éin gong. Appen sender ingen e-post, så deling fungerer utan eigen SMTP.
- **Roller:** `editor` kan føre og endre transaksjonar, renter og faste betalingar. `viewer` kan
  berre sjå. Berre eigaren kan endre lånet, slette det, invitere og fjerne folk.
- **Kvar si side:** lånet er lagra frå eigaren si side. Motparten ser det spegelvendt: «du skuldar»
  hos den eine er «skuldar deg» hos den andre.
- **Ny aktivitet:** kvar brukar har eit «sist sett»-merke per lån. Låneoversikta viser kor mange
  transaksjonar den andre har ført sidan sist, og tidslinja merkjer dei med «Ny» og «Ført av …».
- **Namn:** på kontosida kan ein setje namnet den andre ser i staden for e-postadressa.
- **Forlat lånet:** ein medlem kan sjølv gje frå seg tilgangen.
- Varsel på e-post og push høyrer til påminningane under og er ikkje bygd (M4b).

### 3.5 Påminningar og låg friksjon

Bygd i M4, inne i appen:

- **Planlagd betaling:** når ei betaling i planen du følgjer har forfalle utan å vere ført, spør
  appen «Betalte du 4 000 kr 15. nov.?» øvst på framsida og på lånet. Motparten får det same
  spørsmålet spegelvendt («Fekk du …?»).
  - *Ja* fører innbetalinga på forfallsdatoen med eitt trykk.
  - *Anna beløp* opnar vanleg registrering.
  - *Ikkje enno* spør att om 3 dagar.
  - *Hopp over* stryk den betalinga frå planen.
- Betalingar blir rekna mot planen som løpande sum, ikkje éin til éin: betaler du dobbelt éin
  månad, dekkjer det neste, og det speler inga rolle kven som førte betalinga.
- **Planlagt framover:** framsida viser kva som er planlagt dei neste fire månadene, ut og inn.

Ikkje bygd, fordi det krev ein utsendingskanal som ikkje er sett opp:

```
notification_prefs  user_id, loan_id, channel (push | email), planned_payment, new_activity,
                    monthly_summary
```

- Varsel utanfor appen (web-push der PWA-en er installert, e-post som reserve) for planlagd
  betaling og ny aktivitet.
- **Månadsoppsummering** på e-post den 1.
- **Stille for lenge:** eitt dytt etter 45 dagar utan transaksjonar og utan plan.

### 3.6 Faste betalingar (bygd)

```
loan_recurring_payments  id, loan_id, kind (repayment | disbursement), amount_ore,
                         day_of_month, start_date, end_date, note, next_due
loan_transactions        + recurring_id
```

- Ein regel per fast månadleg beløp. Dag 29–31 fell på siste dag i kortare månader.
- Ein dagleg jobb i databasen (`pg_cron`, 03:15 UTC) fører kvar forfalne betaling som ein vanleg
  transaksjon, merka «Fast». Reknemotoren kjenner ikkje til reglane.
- Startdato tilbake i tid fører alle forfalne betalingar med ein gong.
- Kvar regel fører maksimalt éin transaksjon per dato, og ei betaling som blir sletta manuelt kjem
  ikkje tilbake. Å stoppe ein regel fjernar ikkje det som alt er ført.
- Betalingane blir førte utan stadfesting. Påminninga i 3.5 («Betalte du … i dag?») er alternativet
  for betalingar som ikkje alltid går som planlagt.
- Ikkje bygd: endring av ein eksisterande regel (stopp og lag ny), andre intervall enn månadleg, og
  automatisk stopp når lånet er nedbetalt.

## 4. Nedbetalingsplan (bygd i M4)

```
loan_plans             id, loan_id, name, monthly_amount_ore, day_of_month, start_date,
                       assumed_rate_bp (null = lånet si eiga rente), extra_payments (jsonb),
                       is_active
loan_plan_occurrences  plan_id, loan_id, due_date, status (skipped | snoozed), snoozed_until
```

- Ein plan er eit fast beløp per månad frå ein startdato, og/eller eingongsbetalingar på gitte
  datoar. Ein plan fører aldri noko sjølv; det gjer berre faste betalingar (3.6).
- Motoren simulerer framover **frå faktisk saldo i dag**, så planen flyttar seg automatisk når ein
  verkeleg transaksjon avvik frå det planlagde.
- Resultat: nedbetalt-dato, tal på betalingar, totalt å betale, rentekostnad og graf med planen som
  stipla linje etter den faktiske saldoen.
- Omvendt utrekning: «ferdig innan dato X» gir beløpet per månad.
- Fleire planar per lån blir viste side om side. Éin kan følgjast om gongen.
- Avvik: lånet viser kor mykje du ligg føre eller bak planen du følgjer.
- I simuleringa erstattar planen dei faste innbetalingane på lånet. Framtidsdaterte transaksjonar
  og faste uttak tel framleis med.
- Ikkje bygd: endring av ein lagra plan (slett og lag ny) og månadleg tabell.

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
- Eigen skjerm («Spør») i hovudmenyen, og snarveg frå kvart lån som tek med lånet som kontekst.
  Sidepanel på desktop kan kome seinare.
- Samtalen ligg i nettlesarfana (per lån) og blir ikkje lagra i databasen.
- Verktøy (dei fire første er bygde i M2):

| Verktøy | Type | Gjer |
|---|---|---|
| `list_loans` | les | Alle lån med saldo, kven som skuldar kven og sats |
| `get_loan` | les | Saldo delt i hovudstol og rente, totalar, satsar, faste betalingar |
| `list_loan_transactions` | les | Tidslinje med filter på dato og type, med summar |
| `simulate_repayment` | les | Køyrer motoren framover: fast månadsbeløp, måldato, anna rente, ekstra innbetalingar |
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
| M1 ✅ | Skjelett, innlogging, låneskjema, reknemotor m/testar, oversikt, tidslinje, ny transaksjon, rentesatsar, Excel-import av lånehistorikk | **Lånet er ute av Excel** |
| M2 | Chat med leseverktøy (lån) | Spør Claude om lånet |
| M3 | Invitasjonslenke, roller, spegelvend visning, merking av ny aktivitet i appen | Delt lån |
| M4 | Planar, simulering, samanlikning, avvik, påminning i appen med eitt-trykks stadfesting, planlagt framover | Dynamisk plan som spør deg |
| M4b | Varsel på push/e-post, månadsoppsummering, dytt ved stille (krev utsendingskanal) | Appen minner deg på utanfor appen |
| M5 | Kontoar, CSV/XLSX-import, kategoriar, reglar, analyse | Forbruksanalyse |
| M6 | Chat: forbruksverktøy og skriveverktøy med stadfesting | Claude jobbar på dataa |

## 9. Opne spørsmål

1. Skal lånet ha rente framover, eller held det fram rentefritt? (Kan avgjerast når som helst.)
2. E-post: Supabase sin innebygde utsending leverer berre til medlemmer av organisasjonen, har
   streng rategrense og tillèt ikkje eigne malar. Før motparten kan inviterast (M3) trengst eigen
   SMTP (t.d. Resend). Då kan òg malen i `supabase/templates/sign-in.html` takast i bruk, slik at
   e-posten har ein kode som fungerer i ein installert app på iPhone.
3. Hosting: Vercel-prosjekt og produksjons-URL (må leggjast inn som Site URL i Supabase Auth).

## 10. Avvik frå planen i M1

- UI-komponentane er handskrivne med Tailwind og Material 3-tokens i staden for shadcn/ui, og
  overgangar er rein CSS i staden for Motion. Recharts er brukt til grafen.
- Dagteljing er alltid faktiske dagar / 365, så `day_count`-kolonnen er ikkje med.
