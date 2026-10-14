# UNO / together

Un UNO multijoueur **2 à 8 joueurs**, directement dans le navigateur. Interface française en glassmorphisme, sans inscription ni service externe : **Node.js, Express, Socket.io et JavaScript vanilla**. Le serveur est la seule autorité sur les règles, les tours et les mains.

## Lancement local

Prérequis : **Node.js 22 ou supérieur** et npm.

```bash
cd uno
npm ci
npm start
```

Ouvrez `http://localhost:3000`. Choisissez un pseudo, créez un salon et partagez son code. Un deuxième onglet permet d’essayer le multijoueur ; chaque onglet garde sa propre session. L’hôte peut lancer la partie dès que deux joueurs sont présents.

Pour jouer entre appareils sur votre réseau local, ouvrez `http://IP_LOCALE_DU_SERVEUR:3000` sur chaque appareil. Un code de salon rejoint uniquement des joueurs connectés au **même serveur**.

```bash
npm run dev         # Redémarrage automatique du serveur lors des modifications
npm test            # Moteur + intégration avec de vrais clients Socket.io
PORT=8080 npm start # Port personnalisé (syntaxe Bash)
```

Le frontend est servi directement par Express : aucun build, aucune clé API, aucune base de données requise. Le client Socket.io est servi localement ; aucune police ni ressource CDN n’est nécessaire.

## Structure

```text
uno/
├── .gitignore
├── package.json
├── package-lock.json
├── server.js            # HTTP, salons, sessions, événements et vues privées
├── src/
│   └── game.js          # Deck, mélange, règles, tours, pioche, UNO et victoire
├── public/
│   ├── index.html      # Accueil, lobby, table et modales
│   ├── styles.css      # Glassmorphisme, cartes CSS et responsive
│   ├── app.js          # Client Socket.io, interactions et reconnexion
│   └── favicon.svg
└── test/
    ├── game.test.js    # Règles et simulations complètes (2, 3 et 8 joueurs)
    └── server.test.js  # HTTP, 8 clients, confidentialité et reconnexion
```

## Ce qui fonctionne

- Salons privés `UNO-1234`, pseudos de 1 à 20 caractères, liste et présence en temps réel, hôte et revanche.
- 108 cartes, 7 cartes par joueur, défausse et recyclage de la pioche en conservant la carte du dessus.
- Validation des coups et des tours côté serveur. Chaque connexion reçoit uniquement sa propre main ; les autres mains sont représentées par leur taille.
- +2, +4, Passe, Inversion, Joker et choix de couleur. À deux, Inversion fait rejouer le même joueur.
- Pioche volontaire possible : seule la carte piochée peut être jouée immédiatement, sinon le joueur peut passer. Une carte injouable fait passer automatiquement.
- UNO : annonce avec deux cartes avant de jouer, ou avec une carte avant la prochaine action adverse. Un oubli entraîne deux cartes à la prochaine pioche ou carte jouée par un adversaire.
- Victoire dès qu’une main est vide, avec application de la dernière pénalité éventuelle. L’hôte peut relancer une manche.
- Reconnexion pendant 60 secondes après coupure ou rechargement de l’onglet. La partie est mise en pause. Après expiration ou départ explicite d’un joueur, retour au lobby et réattribution de l’hôte si nécessaire.
- Cartes jouables mises en valeur, fenêtre de choix de couleur, boutons désactivés hors tour, navigation clavier et disposition mobile.

### Conventions de cette version

La première carte est toujours un chiffre, et l’hôte commence. Les pénalités ne se cumulent pas : +2/+4 font piocher **et passer**. Le +4 est interdit si la main contient la couleur active ; le serveur applique cette règle, sans mécanisme de contestation. Une manche se joue sans score cumulé. Le bouton UNO peut être anticipé à deux cartes.

## Protocole Socket.io

Chaque requête utilise `socket.emit(event, payload, callback)` ; le callback reçoit `{ ok: true, ... }` ou `{ ok: false, error }`. Même les actions sans paramètre envoient `{}`.

| Événement client → serveur | Payload                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `room:enter`               | `{ name, create: true }` ou `{ name, code }` ; renvoie un `token` privé |
| `session:resume`           | `{ token }`                                                             |
| `room:leave`               | `{}`                                                                    |
| `game:start`               | `{}` ; hôte uniquement, 2–8 joueurs connectés                           |
| `game:play`                | `{ cardId, color? }` ; couleur requise pour Joker/+4                    |
| `game:draw`                | `{}`                                                                    |
| `game:pass`                | `{}` ; uniquement après une pioche jouable                              |
| `game:uno`                 | `{}`                                                                    |

Couleurs : `red`, `blue`, `green`, `yellow`. Valeurs : `0`–`9`, `draw2`, `reverse`, `skip`, `wild`, `wild4`.

Le serveur émet `state` (salon et vue de jeu privée, avec `revision` croissante), `notice` (message ponctuel), et `left` (départ confirmé). Aucun token n’est diffusé aux autres joueurs. Le token de reprise reste dans le `sessionStorage` de l’onglet ; traitez-le comme un identifiant privé. Les noms sont affichés comme texte échappé, et les actions sont limitées à 60 requêtes par connexion sur 10 secondes.

## Hébergement ultérieur

Déployez sur un hébergeur qui exécute un **processus Node.js persistant**, avec `npm ci --omit=dev` puis `npm start`. Le serveur écoute sur `0.0.0.0` et respecte `PORT`. Le contrôle de santé est `GET /health` → `{ "status": "ok" }`. Servez le site et Socket.io sur le même domaine, en HTTPS, avec un proxy qui prend en charge les WebSockets et `/socket.io/`.

Cette version conserve les salons et les parties **en mémoire, sur une seule instance** : un redémarrage les efface. Pour plusieurs instances ou une reprise après redémarrage, il faudra ajouter une persistance des parties et un mécanisme de coordination ; un adaptateur Socket.io seul ne partage pas le moteur de jeu. Les pseudos ne sont pas des comptes authentifiés. La protection contre les abus reste à dimensionner pour une ouverture au grand public.

## Vérification

`npm test` exécute 15 tests : composition du deck, distribution pour chaque effectif, coups interdits sans mutation, cartes spéciales, pioche et passe, recyclage, UNO, victoire, conservation des 108 cartes durant des parties simulées, ressources HTTP et parties avec huit vrais clients Socket.io, capacité des salons, contrôle de l’hôte, confidentialité, reconnexion, expiration et limitation des actions.
