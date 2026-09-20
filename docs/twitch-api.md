# Chronos ↔ Twitch: tutte le chiamate, una per una

Questo documento elenca **ogni** richiesta che Chronos fa ai server di Twitch, con quale
token la fa, che cosa riceve indietro e che cosa di quel dato finisce nel database.

Il punto di partenza è semplice: **Chronos non vede mai la password di nessuno.**
L'accesso passa da Twitch (OAuth 2.0). La password si digita su una pagina di Twitch,
sui server di Twitch, e Chronos riceve soltanto un codice temporaneo con cui chiedere
"chi è questa persona?".

---

## 1. Accesso di un utente

### 1.1 Il giro dell'OAuth

1. L'utente clicca **Accedi con Twitch** e viene mandato su `https://id.twitch.tv/oauth2/authorize`.
2. Twitch mostra la schermata di consenso e, se l'utente accetta, rimanda a Chronos un `code`
   monouso.
3. Chronos scambia quel `code` con un **access token** chiamando `POST https://id.twitch.tv/oauth2/token`.
4. Con quel token Chronos fa **una sola** chiamata: `GET https://api.twitch.tv/helix/users`.
5. Il token viene buttato via. Da lì in poi la sessione è un cookie firmato di Chronos.

L'orchestrazione è di [Auth.js](https://authjs.dev) (`next-auth`), configurata in `src/auth.ts`.

### 1.2 Permessi richiesti

```
scope = openid
```

Nient'altro. Non `user:read:email`, non `chat:read`, non `user:read:follows`.
Con `openid` Twitch dice soltanto *chi* è l'utente.

Conseguenze pratiche: Chronos **non può** leggere l'email, scrivere in chat al posto
dell'utente, seguire o abbonare canali per lui, leggere messaggi privati o modificare
il suo account. Non ha i permessi per farlo, quindi non è una promessa: è un fatto
verificabile nella schermata di consenso di Twitch e nelle connessioni del proprio account.

### 1.3 `GET /helix/users`

| | |
|---|---|
| **Token** | user access token appena ottenuto (scope `openid`) |
| **Quando** | una volta per login |
| **Codice** | `getUserWithUserToken()` in `src/lib/twitch/helix.ts` |

Risposta usata:

| Campo Twitch | Salvato come | Perché |
|---|---|---|
| `id` | `users.twitch_id` | chiave stabile: regge il cambio di username |
| `login` | `users.login` | ricerca e link al profilo Twitch |
| `display_name` | `users.display_name` | nome mostrato nel sito |
| `profile_image_url` | `users.avatar_url` | **solo l'URL**: l'immagine resta sui server di Twitch |

Tutto il resto della risposta (email, descrizione, view count, tipo di account…) viene
ignorato e non viene mai scritto da nessuna parte.

---

## 2. Collegamento dell'account del canale (una volta sola)

Lo streamer collega il proprio account dal pannello Manager. Serve a leggere lo stato del
proprio pubblico e a gestire i premi a punti canale.

| Endpoint | Metodo | Scopo |
|---|---|---|
| `https://id.twitch.tv/oauth2/token` | POST | scambio del codice e refresh |
| `https://id.twitch.tv/oauth2/validate` | GET | verifica a chi appartiene il token |

Permessi richiesti al canale (`BROADCASTER_SCOPES`):

- `channel:read:subscriptions` — chi è abbonato, con che livello
- `channel:manage:redemptions` — creare i premi a punti canale e confermarli o rimborsarli
- `moderation:read` — chi sono i moderatori
- `moderator:read:followers` — chi segue il canale
- `user:write:chat` — scrivere in chat quando non è collegato un account bot dedicato

I token del canale sono **cifrati** (AES-256-GCM, `src/lib/crypto.ts`) prima di essere
scritti in `broadcaster_auth`. La chiave sta in `TOKEN_ENCRYPTION_KEY`, fuori dal database.

Un secondo account, facoltativo, fa da bot in chat con i soli permessi
`user:write:chat` e `user:bot` (`bot_auth`).

---

## 3. Chiamate Helix con il token del canale

Tutte in `src/lib/twitch/helix.ts`, tutte paginate a 100 elementi per pagina.

| Endpoint | Quando | Cosa viene salvato |
|---|---|---|
| `GET /subscriptions?broadcaster_id=…` | sincronizzazione giornaliera | `subscriptions`: id Twitch, login, tier, se regalata, stato |
| `GET /channels/followers?broadcaster_id=…` | sincronizzazione giornaliera | `channel_followers`: id Twitch, login, data del follow |
| `GET /moderation/moderators?broadcaster_id=…` | sincronizzazione giornaliera | `channel_moderators`: id Twitch, login |
| `POST /channel_points/custom_rewards` | creazione di un premio dal pannello | id del premio su Twitch |
| `PATCH /channel_points/custom_rewards` | modifica di un premio | — |
| `DELETE /channel_points/custom_rewards` | eliminazione di un premio | — |
| `PATCH /channel_points/custom_rewards/redemptions` | dopo ogni riscatto | esito: `FULFILLED` (assegnata) o `CANCELED` (rimborsata) |
| `POST /chat/messages` | annuncio di una medaglia in chat | — (nessuna risposta conservata) |

Di ogni persona si tiene lo stretto necessario per assegnare le medaglie giuste: **se sei
abbonato, se segui, se sei moderatore**. Nessuna cronologia di visione, nessun messaggio di
chat, nessun dato di pagamento — Twitch non li espone e Chronos non li chiede.

## 4. Chiamate Helix con l'app access token

L'app token (`client_credentials`) non è legato a nessun utente.

| Endpoint | Scopo |
|---|---|
| `GET /users?login=…` / `?id=…` | risolvere uno username in id Twitch |
| `GET /streams?user_id=…` | sapere se il canale è in diretta, per il banner in home |
| `GET /eventsub/subscriptions` | elenco dei webhook attivi |
| `POST /eventsub/subscriptions` | creare un webhook mancante |
| `DELETE /eventsub/subscriptions` | rimuovere un webhook obsoleto |

---

## 5. EventSub: quello che Twitch manda a noi

Oltre alle chiamate in uscita, Twitch invia notifiche a
`https://<dominio>/api/webhooks/twitch`. Ogni messaggio è firmato in HMAC-SHA256 con un
segreto condiviso; Chronos verifica la firma e scarta i messaggi più vecchi di 10 minuti e
quelli già visti (`src/lib/twitch/eventsub.ts`).

| Evento | Versione | A cosa serve |
|---|---|---|
| `channel.subscribe` | 1 | assegnare le medaglie riservate agli abbonati |
| `channel.subscription.end` | 1 | segnare l'abbonamento come concluso |
| `channel.subscription.gift` | 1 | riconoscere gli abbonamenti regalati |
| `channel.subscription.message` | 1 | mesi cumulativi, per l'overlay OBS |
| `channel.channel_points_custom_reward_redemption.add` | 1 | assegnare la medaglia riscattata con i punti |
| `channel.moderator.add` / `.remove` | 1 | tenere aggiornato l'elenco dei moderatori |
| `channel.follow` | 2 | assegnare le medaglie riservate ai follower |

---

## 6. Cosa Chronos produce da sé

Questi dati nascono su Chronos e non esistono su Twitch:

- le medaglie possedute e come sono state ottenute, con la data;
- i punti esperienza e il livello che ne derivano;
- le medaglie messe in evidenza;
- la data dell'ultimo accesso;
- le segnalazioni inviate dal sito;
- il registro delle azioni dello staff.

---

## 7. Come verificarlo da soli

- Cercare `fetch(` in `src/lib/twitch/helix.ts`: ci sono tutte le chiamate uscenti, non ce ne sono altrove.
- Cercare `scope` in `src/auth.ts`: è l'unico punto dove si chiedono permessi all'utente.
- Cercare `password` nel repository: non compare, perché non c'è niente da cercare.
- Aprire le impostazioni di sicurezza del proprio account Twitch, sezione connessioni:
  lì Twitch elenca i permessi davvero concessi a Chronos, e da lì si revocano.
