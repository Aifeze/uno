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
function fitHand() {
  const hand = $("#hand");
  if (!state?.game || !matchMedia("(min-width: 761px)").matches) return;
  const cards = hand.children;
  if (!cards.length || !hand.clientWidth) return;
  const style = getComputedStyle(hand);
  const available =
    hand.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  const cardWidth = cards[0].getBoundingClientRect().width;
  const gap =
    cards.length > 1
      ? Math.min(
          12,
          (available - cards.length * cardWidth) / (cards.length - 1),
        )
      : 0;
  hand.style.setProperty("--hand-gap", `${gap}px`);
}
new ResizeObserver(fitHand).observe($("#hand"));
function renderOpponents(game, players, self) {
  const order = game.order;
  const start = order.indexOf(self);
  const opponents = order.slice(start + 1).concat(order.slice(0, start));
  $("#opponents").innerHTML = opponents
    .map((id) => {
      const p = players.find((player) => player.id === id);
      const count = game.counts[id];
      return `<div class="opponent ${game.current === id && !game.winner ? "active" : ""}" data-player="${escapeHtml(id)}">
      <span class="player-avatar avatar-${players.indexOf(p) % 4}" aria-hidden="true">${escapeHtml(Array.from(p.name)[0].toUpperCase())}</span>
      <span class="opponent-name">${escapeHtml(p.name)}</span>
      <div class="opponent-cards" aria-hidden="true">${Array.from({ length: Math.min(count, 7) }, () => '<i class="opponent-card">u.</i>').join("")}</div>
      <span class="opponent-count">${count} carte${count === 1 ? "" : "s"}</span>
      ${game.uno.includes(id) ? '<span class="opponent-uno">UNO</span>' : ""}
      <div class="uno-window" data-uno-player="${escapeHtml(id)}"><button class="counter-uno" type="button" data-counter="${escapeHtml(id)}" title="Contre UNO : faire piocher 2 cartes">Contre UNO</button></div>
    </div>`;
    })
    .join("");
  $("#opponents")
    .querySelectorAll(".opponent")
    .forEach((seat, i) => {
      const angle = Math.PI / 2 + ((i + 1) * 2 * Math.PI) / order.length;
      seat.style.left = `${50 + Math.cos(angle) * 37}%`;
      seat.style.top = `${50 + Math.sin(angle) * 37}%`;
      const backs = seat.querySelectorAll(".opponent-card");
      backs.forEach((back, j) =>
        back.style.setProperty(
          "--fan-angle",
          `${(j - (backs.length - 1) / 2) * 7}deg`,
        ),
      );
    });
  const me = players.find((p) => p.id === self);
  $("#self-seat").textContent =
    `${me.name} · Vous${game.current === self && !game.winner ? " · À vous !" : ""}`;
  $("#self-seat").classList.toggle(
    "active",
    game.current === self && !game.winner,
  );
}
function updateUnoControls() {
  if (!state?.game) return;
  const { game, self, players } = state;
  const paused = !socket.connected || players.some((p) => !p.connected);
  $("#say-uno").disabled =
    Boolean(game.winner) || paused || game.uno.includes(self);
  $("#uno-feedback").textContent = game.uno.includes(self)
    ? "UNO annoncé."
    : "Annoncez avec 1 carte. Sinon : +2.";
  document.querySelectorAll("[data-uno-player]").forEach((slot) => {
    const id = slot.dataset.unoPlayer;
    const available = game.counterTargets.includes(id);
    slot.classList.toggle("hidden", !available || Boolean(game.winner));
    slot.querySelector("button").disabled = paused;
  });
}
function render() {
  $("#home").classList.toggle("hidden", Boolean(state));
  $("#room").classList.toggle("hidden", !state);
  $("#room").classList.toggle("playing", Boolean(state?.game));
  document.body.classList.toggle("in-game", Boolean(state?.game));
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
  renderOpponents(game, players, self);
  $("#discard-card").innerHTML = cardMarkup(game.top);
  $("#draw-card").disabled = !game.canDraw || paused;
  $("#draw-card").setAttribute(
    "aria-label",
    game.pendingDraw
      ? `Piocher ${game.pendingDraw} cartes et passer son tour`
      : "Piocher une carte",
  );
  $("#draw-card").classList.toggle("has-penalty", game.pendingDraw > 0);
  $("#draw-label").textContent = game.pendingDraw
    ? `PIOCHER +${game.pendingDraw}`
    : "PIOCHE";
  $("#penalty-banner").classList.toggle("hidden", !game.pendingDraw);
  $(".game-messages").classList.toggle(
    "has-penalty",
    Boolean(game.pendingDraw),
  );
  $("#penalty-total").textContent = `+${game.pendingDraw}`;
  const defense = game.top.value === "draw2" ? "un +2 ou un +4" : "un +4";
  $("#penalty-message").textContent = game.pendingDraw
    ? mine
      ? `Posez ${defense}, ou piochez ${game.pendingDraw} cartes et passez.`
      : `${playerName(game.current)} doit surenchérir ou piocher ${game.pendingDraw} cartes.`
    : "";
  $("#draw-count").textContent = game.drawCount;
  $("#current-color").className = `current-color ${game.color}`;
  $("#current-color").textContent = `Couleur : ${colorNames[game.color]}`;
  $("#game-notice").textContent = game.notice;
  $("#game-notice").title = game.notice;
  const disconnected = players.filter((p) => !p.connected).map((p) => p.name);
  $("#pause-message").textContent = disconnected.length
    ? `En attente de ${disconnected.join(", ")}… (60 s maximum)`
    : "Reconnexion au serveur…";
  $("#hand-count").textContent =
    `${game.hand.length} carte${game.hand.length === 1 ? "" : "s"}`;
  $("#hand-hint").textContent = game.winner
    ? "La prochaine sera peut-être pour vous."
    : paused
      ? "On attend le retour de tout le monde."
      : !mine
        ? "Préparez votre prochain coup."
        : game.pendingDraw
          ? `Empilez ${defense}, ou cliquez sur la pioche pour prendre +${game.pendingDraw}.`
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
  fitHand();
  $("#pass-turn").classList.toggle("hidden", !game.canPass || paused);
  updateUnoControls();
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
  gameEffects.reset();
  setConnection(false);
  render();
  if ($("#color-dialog").open) $("#color-dialog").close();
});
socket.on("connect_error", () => {
  setConnection(false);
});
socket.on("state", (next) => {
  const previous = state;
  state = next;
  render();
  const game = next.game;
  // Initial snapshots, new rounds and resumes must not replay an old effect.
  if (!game || game.roundId !== previous?.game?.roundId) gameEffects.reset();
  else if (
    game.lastAction &&
    game.lastAction.id !== previous.game.lastAction?.id &&
    next.players.every((p) => p.connected) &&
    previous.players.every((p) => p.connected)
  ) {
    const name = (id) =>
      next.players.find((p) => p.id === id)?.name || "Un joueur";
    gameEffects.play(game.lastAction, {
      actorName: name(game.lastAction.actor),
      targetName: name(game.lastAction.target),
      self: next.self,
    });
  }
});
socket.on("notice", (message) => notify(message));
socket.on("left", () => {
  gameEffects.reset();
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
$("#opponents").addEventListener("click", (event) => {
  const button = event.target.closest("[data-counter]");
  if (!button || button.disabled) return;
  const targetId = button.dataset.counter;
  const window = state?.game?.unoWindows[targetId];
  if (window) send("game:counter-uno", { targetId, windowId: window.id });
});
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
