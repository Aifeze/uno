/* The server owns all rules and hands; the client only renders its private view. */
const $ = (selector) => document.querySelector(selector);
const socket = io({ autoConnect: false });
const colorNames = {
  red: "Rouge",
  blue: "Bleu",
  green: "Vert",
  yellow: "Jaune",
};
const symbols = {
  skip: "⊘",
  reverse: "↺",
  draw2: "+2",
  wild: "✦",
  wild4: "+4",
};
const cardNames = {
  skip: "Passe",
  reverse: "Inversion",
  draw2: "+2",
  wild: "Joker",
  wild4: "+4",
};
let state = null;
let pendingCard = null;
let busy = false;
let toastTimer;
let token = readStorage("uno-session");
function readStorage(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function saveStorage(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* Private browsing may disable storage. */
  }
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function notify(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.toggle("error", error);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 5000);
}
function setConnection(online) {
  $("#connection").classList.toggle("offline", !online);
  $("#connection").replaceChildren(
    Object.assign(document.createElement("i"), {}),
    document.createTextNode(online ? "En ligne" : "Reconnexion…"),
  );
}
async function send(event, data = {}) {
  if (!socket.connected) {
    notify("Connexion au serveur en cours. Patientez.", true);
    return null;
  }
  if (busy) return null;
  busy = true;
  try {
    const result = await socket.timeout(6000).emitWithAck(event, data);
    if (!result.ok) {
      notify(result.error, true);
      return null;
    }
    return result;
  } catch {
    notify("Le serveur ne répond pas. Vérifiez votre connexion.", true);
    return null;
  } finally {
    busy = false;
  }
}
function cardMarkup(card, playable = false, interactive = false) {
  const symbol = symbols[card.value] || card.value;
  const label = `${cardNames[card.value] || card.value}${card.color !== "wild" ? ` ${colorNames[card.color]}` : ""}`;
  const tag = interactive ? "button" : "div";
  return `<${tag} class="card card-${card.color}" ${interactive ? `type="button" data-card="${card.id}" ${playable ? "" : "disabled"}` : ""} aria-label="${escapeHtml(label)}"><span class="card-corner" aria-hidden="true">${symbol}</span><span class="card-value" aria-hidden="true">${symbol}</span><span class="card-corner bottom" aria-hidden="true">${symbol}</span></${tag}>`;
}
function render() {
  $("#home").classList.toggle("hidden", Boolean(state));
  $("#room").classList.toggle("hidden", !state);
  $("#room").classList.toggle("playing", Boolean(state?.game));
  if (!state) return;
  const { players, game, self, host, code } = state;
  const isHost = host === self;
  const paused = players.some((p) => !p.connected) || !socket.connected;
  const playerName = (id) =>
    players.find((p) => p.id === id)?.name || "Un joueur";
  $("#code-label").textContent = code;
  $("#room-title").textContent = game ? "À vous de jouer." : "Le salon.";
  $("#player-count").textContent = `${players.length}/8`;
  $("#player-list").innerHTML = players
    .map(
      (p, i) =>
        `<div class="player-row"><span class="player-avatar avatar-${i % 4}" aria-hidden="true">${escapeHtml(Array.from(p.name)[0].toUpperCase())}</span><div class="player-info"><span class="player-name">${escapeHtml(p.name)}${p.id === self ? ' <span class="muted">(vous)</span>' : ""}</span><span class="player-sub">${p.connected ? (p.id === host ? "Hôte du salon" : "Prêt à jouer") : "Reconnexion…"}</span></div><span class="player-status ${p.connected ? "" : "away"}" aria-label="${p.connected ? "Connecté" : "Déconnecté"}"></span></div>`,
    )
    .join("");
  $("#waiting").classList.toggle("hidden", Boolean(game));
  $("#game").classList.toggle("hidden", !game);
  $("#waiting-message").textContent =
    players.length < 2
      ? "Invitez au moins un ami pour commencer."
      : paused
        ? "Un joueur se reconnecte. Un instant…"
        : isHost
          ? "Tout le monde est là ? À vous de lancer la partie."
          : `${playerName(host)} lancera la partie dès que tout le monde sera prêt.`;
  $("#start-game").classList.toggle("hidden", !isHost);
  $("#start-game").disabled = players.length < 2 || paused;
  if (!game) {
    if ($("#color-dialog").open) $("#color-dialog").close();
    return;
  }
  const mine = game.current === self && !game.winner;
  $("#turn-label").textContent = game.winner
    ? "La manche est terminée"
    : paused
      ? "Partie en pause"
      : mine
        ? "✦ C’est votre tour !"
        : `Au tour de ${playerName(game.current)}`;
  $("#turn-label").classList.toggle("mine", mine);
  $("#direction-label").textContent =
    game.direction === 1 ? "↻ Sens horaire" : "↺ Sens inverse";
  $("#opponents").innerHTML = players
    .filter((p) => p.id !== self)
    .map(
      (p) =>
        `<div class="opponent ${game.current === p.id && !game.winner ? "active" : ""}"><span class="player-avatar avatar-${players.indexOf(p) % 4}" aria-hidden="true">${escapeHtml(Array.from(p.name)[0].toUpperCase())}</span><span class="opponent-name">${escapeHtml(p.name)}</span><span class="opponent-count">${game.counts[p.id]} carte${game.counts[p.id] === 1 ? "" : "s"}</span>${game.uno.includes(p.id) ? '<span class="opponent-uno">UNO</span>' : ""}</div>`,
    )
    .join("");
  $("#discard-card").innerHTML = cardMarkup(game.top);
  $("#draw-card").disabled = !game.canDraw || paused;
  $("#draw-count").textContent = game.drawCount;
  $("#current-color").className = `current-color ${game.color}`;
  $("#current-color").textContent = `Couleur : ${colorNames[game.color]}`;
  $("#game-notice").textContent = game.notice;
  $("#hand-count").textContent =
    `${game.hand.length} carte${game.hand.length === 1 ? "" : "s"}`;
  $("#hand-hint").textContent = game.winner
    ? "La prochaine sera peut-être pour vous."
    : paused
      ? "On attend le retour de tout le monde."
      : !mine
        ? "Préparez votre prochain coup."
        : game.canPass
          ? "Jouez la carte piochée ou passez votre tour."
          : game.playable.length
            ? "Les cartes lumineuses sont à vous de jouer."
            : "Pas de carte jouable ? Piochez au centre.";
  $("#hand").innerHTML = game.hand
    .map((card) =>
      cardMarkup(card, !paused && game.playable.includes(card.id), true),
    )
    .join("");
  $("#pass-turn").classList.toggle("hidden", !game.canPass || paused);
  $("#say-uno").disabled =
    game.hand.length > 2 ||
    Boolean(game.winner) ||
    paused ||
    game.uno.includes(self);
  $("#say-uno").classList.toggle("announced", game.uno.includes(self));
  $("#say-uno").textContent = game.uno.includes(self) ? "UNO ✓" : "UNO ! ✦";
  $("#pause-overlay").classList.toggle(
    "hidden",
    !paused || Boolean(game.winner),
  );
  $("#winner-panel").classList.toggle("hidden", !game.winner);
  $("#winner-label").textContent =
    game.winner === self
      ? "La victoire est à vous !"
      : `${playerName(game.winner)} remporte la partie !`;
  $("#replay").classList.toggle("hidden", !isHost);
  $("#replay").disabled = paused;
  if (
    $("#color-dialog").open &&
    (!mine || paused || !game.hand.some((c) => c.id === pendingCard))
  )
    $("#color-dialog").close();
}
socket.on("connect", async () => {
  setConnection(true);
  if (token) {
    // Resume independently from UI actions so reconnection cannot be swallowed by busy state.
    try {
      const reply = await socket
        .timeout(6000)
        .emitWithAck("session:resume", { token });
      if (!reply.ok) {
        token = null;
        saveStorage("uno-session", null);
        state = null;
        render();
        notify(reply.error, true);
      }
    } catch {
      notify("Reconnexion impossible pour le moment.", true);
    }
  } else render();
});
socket.on("disconnect", () => {
  setConnection(false);
  render();
  if ($("#color-dialog").open) $("#color-dialog").close();
});
socket.on("connect_error", () => {
  setConnection(false);
});
socket.on("state", (next) => {
  state = next;
  render();
});
socket.on("notice", (message) => notify(message));
socket.on("left", () => {
  state = null;
  token = null;
  saveStorage("uno-session", null);
  render();
});
$("#nickname").value = readStorage("uno-name") || "";
async function enter(create) {
  if (!$("#nickname").reportValidity()) return;
  const name = $("#nickname").value.trim();
  if (!name) {
    notify("Choisissez un pseudo.", true);
    $("#nickname").focus();
    return;
  }
  const reply = await send("room:enter", {
    name,
    create,
    code: $("#room-code").value,
  });
  if (reply) {
    token = reply.token;
    saveStorage("uno-session", token);
    saveStorage("uno-name", name);
  }
}
$("#entry-form").addEventListener("submit", (event) => {
  event.preventDefault();
  enter(true);
});
$("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  enter(false);
});
$("#start-game").addEventListener("click", () => send("game:start"));
$("#replay").addEventListener("click", () => send("game:start"));
$("#leave-room").addEventListener("click", () => {
  if (
    !state?.game ||
    state.game.winner ||
    confirm("Quitter la partie ? Tout le monde retournera au lobby.")
  )
    send("room:leave");
});
async function copyCode() {
  if (!state) return;
  try {
    await navigator.clipboard.writeText(state.code);
    notify("Code copié. Invitez vos amis !");
  } catch {
    notify(`Partagez ce code : ${state.code}`);
  }
}
$("#copy-code").addEventListener("click", copyCode);
$("#copy-invite").addEventListener("click", copyCode);
$("#draw-card").addEventListener("click", () => send("game:draw"));
$("#pass-turn").addEventListener("click", () => send("game:pass"));
$("#say-uno").addEventListener("click", () => send("game:uno"));
$("#hand").addEventListener("click", (event) => {
  const button = event.target.closest("[data-card]");
  if (!button || button.disabled || busy) return;
  const card = state.game.hand.find((card) => card.id === button.dataset.card);
  if (card.color === "wild") {
    pendingCard = card.id;
    $("#color-dialog").showModal();
  } else send("game:play", { cardId: card.id });
});
document.querySelectorAll("[data-color]").forEach((button) =>
  button.addEventListener("click", () => {
    const cardId = pendingCard;
    $("#color-dialog").close();
    if (cardId) send("game:play", { cardId, color: button.dataset.color });
  }),
);
$("#color-dialog").addEventListener("close", () => {
  pendingCard = null;
});
$("#cancel-color").addEventListener("click", () => $("#color-dialog").close());
document
  .querySelectorAll(".rules-button")
  .forEach((button) =>
    button.addEventListener("click", () => $("#rules-dialog").showModal()),
  );
$("#close-rules").addEventListener("click", () => $("#rules-dialog").close());
$("#understood").addEventListener("click", () => $("#rules-dialog").close());
socket.connect();
