# MacroTracking – installazione sul Galaxy S24 Ultra

L'app è una PWA: si pubblica come sito web (gratis) e poi si installa dal telefono con Chrome,
come una vera app (icona nella Home, schermo intero, funziona offline).
Serve pubblicarla su un indirizzo HTTPS perché la fotocamera funzioni.

## Opzione A – Netlify Drop (la più veloce, dal PC)
1. Decomprimi lo zip: ottieni la cartella `macrotracking`.
2. Vai su https://app.netlify.com/drop e trascina dentro la cartella.
3. Crea/accedi a un account Netlify gratuito per tenere il sito online in modo permanente.
4. Copia l'indirizzo (es. https://nome-casuale.netlify.app).

## Opzione B – GitHub Pages
1. Crea un repository pubblico e carica tutti i file della cartella (index.html deve stare nella radice).
2. Settings → Pages → Branch `main` / cartella `/ (root)` → Save.
3. L'indirizzo sarà https://TUO-NOME.github.io/NOME-REPO/

## Installazione sul telefono
1. Apri l'indirizzo con **Chrome** sul Galaxy S24 Ultra.
2. Menu ⋮ → **Installa app** (o "Aggiungi a schermata Home").
3. Alla prima scansione consenti l'accesso alla fotocamera.

## Aggiornamenti
Sostituisci i file sul sito: l'app si aggiorna da sola alla riapertura successiva.
I dati (pasti, obiettivi) restano nel telefono e non vengono toccati.

## Dati e backup
Tutto è salvato solo sul telefono. In Obiettivi → "I tuoi dati" puoi esportare/importare un backup.
Se cancelli i dati di Chrome o disinstalli l'app, i dati si perdono: fai ogni tanto un backup.

## Fonti
- Alimenti: CREA – Tabelle di composizione degli alimenti (alimentinutrizione.it), valori per 100 g di parte edibile,
  carboidrati "disponibili". Il file `foods.js` contiene una selezione di 300 alimenti comuni.
- Codici a barre: Open Food Facts (database collaborativo, richiede connessione). I prodotti trovati
  vengono salvati e poi funzionano anche offline.

## iPhone (versione 2.0.0)
- Apri l'indirizzo dell'app con **Safari**, tocca **Condividi** → **Aggiungi alla schermata Home**.
- La scansione del codice a barre usa un lettore integrato (barcode.js) perché Safari non ha il lettore nativo di Chrome. Legge EAN-13, EAN-8 e UPC-A; tieni il telefono fermo, ben illuminato, a 10–20 cm.
- Torcia e vibrazione di solito non sono disponibili su iPhone. In ogni caso puoi digitare il codice a mano.
- I dati dell'app installata sono separati da quelli di Safari: usa il backup in Obiettivi se cambi dispositivo.
