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
│   ├── effects.js      # Animations des actions publiques validées par le serveur
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
- Cumul des pénalités : +2 sur +2, +4 sur +2, +4 sur +4. Le total reste visible et le joueur suivant peut surenchérir ou tout piocher en passant son tour.
- Animations synchronisées des +2/+4, changement de couleur, Inversion et Passe, avec envol des cartes piochées. Elles ne bloquent pas les interactions et respectent la préférence système de réduction des animations.
- Pioche volontaire possible : seule la carte piochée peut être jouée immédiatement, sinon le joueur peut passer. Une carte injouable fait passer automatiquement.
- UNO : annonce avec **exactement une carte**, dans les **2 secondes** après avoir posé l’avant-dernière carte. Cliquer avec plusieurs cartes inflige immédiatement **+2**. Après le délai, les adversaires peuvent infliger **+2** via « Contre UNO » ; il n’y a plus de pénalité automatique.
- Victoire dès qu’une main est vide, avec application de la dernière pénalité éventuelle. L’hôte peut relancer une manche.
- Reconnexion pendant 60 secondes après coupure ou rechargement de l’onglet. La partie est mise en pause. Après expiration ou départ explicite d’un joueur, retour au lobby et réattribution de l’hôte si nécessaire.
- Table circulaire : places attribuées dans l’ordre de jeu, votre place en bas, éventails de cartes adverses face cachée et nombre exact de cartes. Les éventails affichent au plus 7 dos pour rester lisibles, sans révéler les valeurs.
- Cartes jouables mises en valeur, fenêtre de choix de couleur, compte à rebours UNO et boutons de contre-UNO, navigation clavier et disposition mobile.

### Conventions de cette version

La première carte est toujours un chiffre. **L’ordre complet des joueurs est mélangé à chaque manche**, y compris lors d’une revanche ; le premier joueur de cet ordre commence. L’hôte garde uniquement le contrôle du lancement. L’ordre reste identique après une reconnexion.

Cette version utilise la variante de **cumul des +** :

- Sur un **+2** : un **+2 de n’importe quelle couleur** ou un **+4**.
- Sur un **+4** : uniquement un **+4** ; un +2 reste interdit.
- Le total s’additionne : `+2 → +2 → +4 → +4 = 12 cartes`. Tant qu’une pénalité est en attente, les autres cartes et l’action « passer » sont interdites.
- Cliquer sur la pioche accepte tout le total et termine le tour, même si le joueur possède une carte pour surenchérir. Les cartes ainsi piochées ne sont pas jouables immédiatement.
- Le **+4 n’a aucune restriction de couleur** : il est jouable même si la main contient la couleur actuelle, pour ouvrir une chaîne ou surenchérir. Les tours restent obligatoires et, après une pioche ordinaire, seule la carte piochée est jouable immédiatement.
- Si un joueur termine sa main avec un +, la victoire est immédiate : le joueur suivant pioche le total et la chaîne prend fin. Si les cartes disponibles ne suffisent pas, il pioche toutes celles qui restent après recyclage.

Une manche se joue sans score cumulé ni contestation du +4.

### UNO et contre-UNO

- La fenêtre de 2 secondes commence dès que le serveur accepte la carte qui réduit la main à une carte. Une annonce avec plusieurs cartes fait piocher 2 cartes, sans changer le tour ni annuler une chaîne de + en cours.
- Le délai est contrôlé par le serveur. Avant son expiration, une annonce UNO protège le joueur et personne ne peut le contrer. À partir de l’expiration, l’annonce tardive est refusée et le bouton « Contre UNO » apparaît chez les adversaires, même sans nouveau coup joué.
- Un adversaire peut contrer **hors de son tour**. Le joueur ciblé doit encore avoir une carte et ne pas avoir annoncé UNO. Une fenêtre ne peut être sanctionnée qu’une fois ; les requêtes anciennes ou doublonnées sont refusées.
- L’occasion de contre-UNO disparaît si la main grandit ou si la manche se termine. Il n’y a aucune pénalité automatique pour un oubli. Les pénalités piochent les cartes disponibles, avec recyclage si nécessaire.

## Protocole Socket.io

Chaque requête utilise `socket.emit(event, payload, callback)` ; le callback reçoit `{ ok: true, ... }` ou `{ ok: false, error }`. Même les actions sans paramètre envoient `{}`.

| Événement client → serveur | Payload                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `room:enter`               | `{ name, create: true }` ou `{ name, code }` ; renvoie un `token` privé   |
| `session:resume`           | `{ token }`                                                               |
| `room:leave`               | `{}`                                                                      |
| `game:start`               | `{}` ; hôte uniquement, 2–8 joueurs connectés                             |
| `game:play`                | `{ cardId, color? }` ; couleur requise pour Joker/+4                      |
| `game:draw`                | `{}`                                                                      |
| `game:pass`                | `{}` ; uniquement après une pioche jouable                                |
| `game:uno`                 | `{}`                                                                      |
| `game:counter-uno`         | `{ targetId, windowId }` ; adversaire avec un UNO oublié après 2 secondes |

Couleurs : `red`, `blue`, `green`, `yellow`. Valeurs : `0`–`9`, `draw2`, `reverse`, `skip`, `wild`, `wild4`.

Le serveur émet `state` (salon et vue de jeu privée, avec `revision` croissante), `notice` (message ponctuel), et `left` (départ confirmé). Aucun token n’est diffusé aux autres joueurs. Le token de reprise reste dans le `sessionStorage` de l’onglet ; traitez-le comme un identifiant privé. Les noms sont affichés comme texte échappé, et les actions sont limitées à 60 requêtes par connexion sur 10 secondes.

La vue de jeu expose `pendingDraw` (total à piocher), `roundId` (identifiant de manche), `order` (ordre des places), `unoWindows` (identifiants et échéances des fenêtres de 2 secondes), `counterTargets` (cibles que le destinataire peut contrer) et `lastAction` (dernière action publique avec un identifiant croissant par manche). L’enveloppe `state.serverNow` permet au client d’afficher le compte à rebours selon l’heure du serveur. Une action de pioche ou de pénalité UNO contient sa quantité, jamais les cartes reçues. Le client anime les nouvelles actions d’une manche déjà affichée ; un rechargement, une reconnexion, un changement de manche ou une annonce UNO valide ne rejouent pas un ancien effet. Les effets sont annulés au départ du salon et lorsque l’onglet passe en arrière-plan.

## Hébergement ultérieur

Déployez sur un hébergeur qui exécute un **processus Node.js persistant**, avec `npm ci --omit=dev` puis `npm start`. Le serveur écoute sur `0.0.0.0` et respecte `PORT`. Le contrôle de santé est `GET /health` → `{ "status": "ok" }`. Servez le site et Socket.io sur le même domaine, en HTTPS, avec un proxy qui prend en charge les WebSockets et `/socket.io/`.

Cette version conserve les salons et les parties **en mémoire, sur une seule instance** : un redémarrage les efface. Pour plusieurs instances ou une reprise après redémarrage, il faudra ajouter une persistance des parties et un mécanisme de coordination ; un adaptateur Socket.io seul ne partage pas le moteur de jeu. Les pseudos ne sont pas des comptes authentifiés. La protection contre les abus reste à dimensionner pour une ouverture au grand public.

## Vérification

`npm test` exécute 30 tests : composition du deck, distribution pour chaque effectif, coups interdits sans mutation, cartes spéciales et chaînes de pénalités (jusqu’à +12), +4 libre, pioche et passe, recyclage, fausses annonces UNO, délai de 2 secondes (dont les bornes 1999/2000 ms), contre-UNO hors tour, requêtes anciennes et doublonnées, ordre aléatoire, victoire, confidentialité des actions publiques, conservation des 108 cartes durant des parties simulées, ressources HTTP et parties avec huit vrais clients Socket.io, capacité des salons, contrôle de l’hôte, reconnexion et limitation des actions. Un test d’intégration attend le délai réel et vérifie que le serveur diffuse la disponibilité du contre-UNO sans nouvelle action.
