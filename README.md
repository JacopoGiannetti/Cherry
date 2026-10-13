# Vego

Plant-based eating for the US market. Shop smarter, scan anywhere, veganize anything.

Monorepo: app iOS (SwiftUI) + backend (Node.js/Express, deploy su Render).

## Architettura

L'app **non aspetta mai dati dal backend**:

1. L'app chiede al backend di **avviare un lavoro** (`POST /...` → risposta immediata `202 { jobId }`).
2. Il backend esegue (Gemini, fal.ai, RapidAPI, Open Food Facts) e **scrive i risultati su Firestore** man mano che sono pronti.
3. L'app **legge sempre e solo da Firestore** con listener realtime. Se cade la rete, il risultato è comunque lì al riconnettersi.

Le foto (menu, screenshot di ricette) salgono su Firebase Storage direttamente dall'app; al backend passa solo il percorso.

```
app iOS ──POST avvia job──▶ backend (Render) ──scrive──▶ Firestore ──listener──▶ app iOS
```

## Struttura repo

```
app/        Progetto iOS (generato con XcodeGen da project.yml)
  Vego/          app principale
  CherryShare/    share extension (TikTok/IG → Cherry)
  CherryActivity/  Live Activity (lock screen + Dynamic Island)
  Shared/        codice condiviso tra target
backend/    Node.js + Express
  config/keys.js   unico punto che legge le chiavi (da .env)
  .env.example     modello del file chiavi da compilare
  dashboard/       sito analytics interno (non montato dal server)
legal/      privacy policy e termini di servizio
```

## Setup — cosa devi creare tu (account nuovi, mai quelli GutSense)

| Servizio | Cosa serve | Dove va |
|---|---|---|
| **Firebase** (nuovo progetto) | 1) `GoogleService-Info.plist` (app iOS) 2) service account JSON (backend) | plist in `app/Cherry/Supporting/`; JSON incollato in `.env` |
| **Google AI Studio** | API key Gemini | `.env` → `GEMINI_API_KEY` |
| **fal.ai** | API key (foto ricette, FLUX.1 schnell) | `.env` → `FAL_KEY` |
| **RapidAPI** | key + subscription a "Social Download All In One" (import TikTok/IG) | `.env` → `RAPIDAPI_KEY` |
| **Superwall** | public API key (app) + webhook secret (backend) | key in `app/Cherry/Config/Secrets.swift`; secret in `.env` |
| **Apple Developer** | App Group `group.com.vego.jacopogiannetti.app`, Sign in with Apple, Live Activities, prodotti IAP | Xcode Signing & Capabilities |

Nel progetto Firebase attiva: **Authentication** (Anonymous + Apple), **Firestore**, **Storage**.

### Backend in locale

```bash
cd backend
cp .env.example .env    # poi compila le chiavi
npm install
npm run dev
```

Senza chiavi il server parte comunque in modalità degradata e ti dice cosa manca su ogni endpoint.

### App iOS

```bash
cd app
xcodegen generate   # rigenera Cherry.xcodeproj dopo modifiche a project.yml
open Cherry.xcodeproj
```

Poi in Xcode: imposta il tuo Team in Signing & Capabilities per i 3 target. Senza `GoogleService-Info.plist` l'app compila e mostra la UI in modalità demo (nessun dato persistito).

### Dashboard analytics

```bash
cd backend
npm run dashboard      # → http://localhost:4000
```

Legge Firestore con lo stesso service account del backend e mostra costi AI, uso delle feature, unit economics e la tabella utenti. Non serve nessuna chiave in più.

In locale ascolta solo su `127.0.0.1`. Non fa parte del servizio: `server.js` non la monta, quindi su Render non esiste.

I numeri vengono dai contatori che scrive `lib/usage.js` — il backend non conserva eventi grezzi, quindi la dashboard somma contatori, non interroga un log.

#### Deploy su Cloud Run

La dashboard mostra uid, nomi, provenienza e costi di ogni utente, quindi non va mai esposta senza autenticazione. Si mette online **privata** e ci si mette IAP davanti: l'accesso è legato al tuo account Google e non serve scrivere una riga di login.

Conviene usare lo stesso progetto GCP di Firebase, così Firestore è già lì.

```bash
PROJECT=<id-progetto-firebase>
REGION=europe-west1

gcloud config set project $PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com iap.googleapis.com

# Identità dedicata in sola lettura: la dashboard non deve poter scrivere.
gcloud iam service-accounts create vego-analytics --display-name "Vego analytics"
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:vego-analytics@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/datastore.viewer"

cd backend
gcloud run deploy vego-analytics \
  --source . \
  --region $REGION \
  --command node --args dashboard/server.js \
  --service-account vego-analytics@$PROJECT.iam.gserviceaccount.com \
  --set-env-vars FIREBASE_DATABASE_ID=vego \
  --no-allow-unauthenticated
```

`FIREBASE_DATABASE_ID` non è opzionale: senza, l'SDK cercherebbe `(default)` e la dashboard mostrerebbe zeri invece di un errore. Il server rifiuta di partire se manca.

Poi accendi IAP dalla **console**: Cloud Run → `vego-analytics` → Security → Identity-Aware Proxy. Falla da lì e non da `gcloud`, perché in un progetto senza organizzazione — cioè un normale progetto Firebase personale — il client OAuth non si può creare da riga di comando, mentre la console lo genera da sola. Infine, in IAM del servizio, dai al tuo account il ruolo **IAP-secured Web App User**.

Se IAP dà problemi, l'alternativa senza alcuna configurazione è lasciare il servizio privato e aprirlo con un tunnel locale:

```bash
gcloud run services proxy vego-analytics --region $REGION --port 4000
```

Credenziali: su Cloud Run non c'è nessun `.env` e nessuna chiave nell'immagine (`backend/.gcloudignore` li esclude dall'upload) — si autentica con l'identità del servizio.

### Distribution

`/distribution` non è analytics: è lo strumento con cui si producono in serie i video verticali. Tela a nodi, cinque blocchi (Source, AI Wizard, Testo, Merge, Save) e uno storage a cartelle. Il codice sta tutto in `backend/dashboard/distribution/`.

Due cose da sapere prima di guardarlo:

- **Ogni collegamento trasporta una lista, non un file.** L'AI Wizard con otto varianti moltiplica per otto, il Testo moltiplica per hook × stili, il Merge fa il prodotto fra tutti i suoi ingressi. Il numero sul filo è quanto sta passando di lì, e la stima in alto è quanto costerà.
- **Il Testo contiene gli hook, non un testo.** Una riga un hook, e gli stili si accendono insieme: cinque hook con TikTok e Snapchat accesi fanno dieci uscite per ogni clip che entra. Il Merge ha quattro ingressi numerati e incrocia tutto con tutto, quindi cinque clip di hook × cinque hook × due stili × due demo sono cento video. Quando il tetto taglia, "distribuite" prende le combinazioni a passo costante invece che le prime: altrimenti la seconda demo non comparirebbe mai.
- **Lo "slight change" ha due motori.** Correzione colore, ritaglio, velocità e grana sono ffmpeg: esatti, istantanei e gratis, e bastano a rendere un file diverso da quello di partenza. Spostare un oggetto nella scena è contenuto, e per quello serve un modello. Il default è il motore esatto.
- **"Togli dal risultato" ripulisce le sovrimpressioni.** Sottotitoli bruciati, watermark, sticker e pezzi di interfaccia della sorgente non ricompaiono nelle varianti: al modello si chiede di ricostruire quello che c'era sotto, non di coprirlo. È una ricostruzione, quindi la fa l'AI: sceglierlo sposta anche lo slight change dal motore esatto a quello a pagamento, e il preventivo lo tiene già in conto. Sui video la richiesta viene ripetuta al modello video, perché l'ancora è un fotogramma solo e le scritte compaiono lungo tutta la clip.

Sui video il flusso è ad ancora: si modifica il primo fotogramma come immagine (qualche centesimo), lo si guarda, e solo le ancore approvate diventano video (mezzo dollaro l'uno). La run si ferma davvero in attesa della risposta.

Le immagini passano da **GPT Image 2.5 Flare** (Sunburst è l'alternativa più lenta e più ferma). Il prompt è un JSON con la stessa alberatura dei brief UGC ultra-realistici — canvas, volto, pelle, capelli, vestiti, luce, camera, palette, texture — riempito ogni volta dal pianificatore su *questa* variante, non su una persona fissa. Lo stile fotografico (selfie da telefono, HDR, pori, niente CGI) è inchiodato. Nano Banana e FLUX restano nelle tendine se serve un altro motore.

Quello che esce si trova sempre nello stesso posto: ogni run si crea la sua cartella sotto **Output**, e il nodo Save ci mette dentro **Video** e **Foto** separando i file per tipo. Sono cartelle di Firestore, cioè solo un modo di ordinare la vista: su Storage il file resta dov'era, non si sposta niente.

Le varianti partono tutte insieme, non una dopo l'altra: otto video in fila sono mezz'ora, in parallelo sono qualche minuto. Quante ne restano in volo lo decide `FAL_MAX_CONCURRENCY` (quattro di default, perché con clip da mezzo dollaro un tetto basso è una sicurezza). Se una fallisce le altre proseguono e il diario dice quale: non ha senso buttare sette video già pagati per l'ottavo andato male. Il diario è il riquadro che si apre quando parte la run — cosa sta girando, da quanto, quanto tempo ha preso finora ogni categoria di lavoro, e lo stop.

I font delle didascalie sono quelli veri: **TikTok Sans** è open source (OFL) e lo usa l'app stessa; per Snapchat, il cui font è proprietario, si usa **Public Sans**, il sostituto più vicino. Le misure — corpo, interlinea, contorno, zona sicura — stanno tutte nel blocco `CAL` di `distribution/text-style.js`, che è l'unico posto da toccare per tarare.

Rispetto alla dashboard servono tre cose in più sul servizio:

```bash
gcloud run services update vego-analytics --region $REGION \
  --set-env-vars FIREBASE_DATABASE_ID=vego,FIREBASE_STORAGE_BUCKET=<bucket>,FAL_KEY=<chiave>,GEMINI_API_KEY=<chiave> \
  --memory 2Gi --cpu 2 --no-cpu-throttling --timeout 900
```

`--no-cpu-throttling` non è un dettaglio: le run girano in background dopo che la risposta HTTP è già tornata, e senza CPU allocata fra una richiesta e l'altra si fermerebbero a metà. Il service account ha bisogno di `roles/storage.objectAdmin` sul bucket e di `roles/datastore.user` (non più solo `viewer`: Distribution scrive).

ffmpeg lo installa il `Dockerfile`, e deve installarlo lui: è l'unico modo perché stia nell'immagine invece che nella memoria dell'istanza. Perché venga usato, il deploy deve partire dalla cartella che contiene il Dockerfile (`gcloud run deploy vego-analytics --source backend/ --region $REGION`); se parte dalla radice della repo, Cloud Build sceglie i buildpack Node e ffmpeg non c'è.

In quel caso il server si arrangia: al primo avvio scarica i binari statici e li tiene in `/tmp`. Con un'avvertenza — la build leggera di `ffmpeg-static` è compilata senza freetype, cioè **senza `drawtext`**: tagli, concatenazioni e ritocchi esatti funzionano, il nodo Testo no. Per le scritte serve quindi una build completa, e la si prende dal registro npm (`@ffmpeg-installer/<piattaforma>`): 23 MB di scaricamento, 68 MB di eseguibile. La fonte è npm non perché sia una dipendenza — non lo è, `package.json` non la nomina — ma perché è l'unica che pubblica un ffmpeg con freetype in un formato che Node apre da solo, gzip più tar. Gli archivi `.tar.xz` di BtbN e johnvansickle sarebbero più aggiornati ma richiedono il comando `xz`, che su un'immagine di runtime magra può non esserci.

Resta comunque un ripiego: quei 68 MB stanno in `/tmp`, che su Cloud Run è RAM, e vanno riscaricati a ogni avvio a freddo. La strada giusta è il Dockerfile. Se la capacità manca, la tela lo dice in cima — col motivo del fallimento, non solo l'esito — e il nodo Testo compare fra i problemi **prima** di far partire la run, invece di lasciarla morire a metà con le varianti già pagate.

### Deploy su Render

Web Service dalla repo, root directory `backend/`, build `npm install`, start `npm start`. Le chiavi del `.env` vanno inserite come Environment Variables di Render (stessi nomi).

## Regole Firestore

Le security rules sono in `backend/firestore.rules`: l'utente legge/scrive solo il proprio albero `users/{uid}`, le cache globali sono scrivibili solo dal backend (Admin SDK bypassa le rules). Caricale dalla console Firebase o con la CLI.
