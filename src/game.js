import { randomInt, randomUUID } from "node:crypto";

export const COLORS = ["red", "blue", "green", "yellow"];
export class RuleError extends Error {}
const requireRule = (condition, message) => {
  if (!condition) throw new RuleError(message);
};

export function createDeck() {
  const cards = [];
  const add = (color, value) =>
    cards.push({ id: `c${cards.length}`, color, value });
  for (const color of COLORS) {
    add(color, "0");
    for (const value of [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "draw2",
      "reverse",
      "skip",
    ]) {
      add(color, value);
      add(color, value);
    }
  }
  for (let i = 0; i < 4; i++) {
    add("wild", "wild");
    add("wild", "wild4");
  }
  return cards;
}

export function shuffle(cards, pickIndex = randomInt) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export class Game {
  constructor(playerIds, { now = Date.now, pickIndex = randomInt } = {}) {
    requireRule(
      playerIds.length >= 2 &&
        playerIds.length <= 8 &&
        new Set(playerIds).size === playerIds.length,
      "Il faut entre 2 et 8 joueurs.",
    );
    this.players = shuffle([...playerIds], pickIndex);
    this.now = now;
    this.hands = Object.fromEntries(playerIds.map((id) => [id, []]));
    this.drawPile = shuffle(createDeck());
    this.discard = [];
    this.turn = 0;
    this.direction = 1;
    this.drawn = null;
    this.pendingDraw = 0;
    this.roundId = randomUUID();
    this.actionSequence = 0;
    this.lastAction = null;
    this.uno = new Set();
    this.unoWindows = new Map();
    this.winner = null;
    this.notice = "La partie commence !";
    for (let i = 0; i < 7; i++) for (const id of playerIds) this.take(id, 1);
    // An opening number card avoids ambiguous initial action effects.
    const openingIndex = this.drawPile.findIndex((card) =>
      /^\d$/.test(card.value),
    );
    this.discard.push(this.drawPile.splice(openingIndex, 1)[0]);
    this.color = this.top.color;
  }

  get top() {
    return this.discard.at(-1);
  }
  get current() {
    return this.players[this.turn];
  }
  nextIndex(steps = 1) {
    return (
      (this.turn + this.direction * steps + this.players.length * steps) %
      this.players.length
    );
  }
  assertTurn(id) {
    requireRule(!this.winner, "La partie est terminée.");
    requireRule(this.current === id, "Ce n’est pas votre tour.");
  }
  canPlay(id, card) {
    if (
      !card ||
      this.winner ||
      this.current !== id ||
      (this.drawn && this.drawn !== card.id)
    )
      return false;
    // House rule: +2 can receive +2 (any color) or +4; +4 only receives +4.
    if (this.pendingDraw)
      return (
        card.value === "wild4" ||
        (this.top.value === "draw2" && card.value === "draw2")
      );
    return (
      card.color === "wild" ||
      card.color === this.color ||
      card.value === this.top.value
    );
  }
  take(id, count) {
    let taken = null;
    for (let i = 0; i < count; i++) {
      if (!this.drawPile.length && this.discard.length > 1) {
        const top = this.discard.pop();
        this.drawPile = shuffle(this.discard);
        this.discard = [top];
      }
      if (!this.drawPile.length) break;
      taken = this.drawPile.pop();
      this.hands[id].push(taken);
    }
    if (this.hands[id].length !== 1) {
      this.uno.delete(id);
      this.unoWindows.delete(id);
    }
    return taken;
  }
  nextUnoDeadline() {
    if (this.winner) return null;
    const deadlines = [...this.unoWindows.values()]
      .map((w) => w.expiresAt)
      .filter((t) => t > this.now());
    return deadlines.length ? Math.min(...deadlines) : null;
  }
  advance(steps = 1) {
    this.turn = this.nextIndex(steps);
    this.drawn = null;
  }
  recordAction(action) {
    this.lastAction = { id: ++this.actionSequence, ...action };
  }

  play(id, cardId, color) {
    this.assertTurn(id);
    const index = this.hands[id].findIndex((card) => card.id === cardId);
    const card = this.hands[id][index];
    requireRule(this.canPlay(id, card), "Cette carte ne peut pas être jouée.");
    if (card.color === "wild")
      requireRule(COLORS.includes(color), "Choisissez une couleur.");
    const previousColor = this.color;
    this.hands[id].splice(index, 1);
    this.discard.push(card);
    this.color = card.color === "wild" ? color : card.color;
    if (this.hands[id].length === 1) {
      this.uno.delete(id);
      this.unoWindows.set(id, {
        id: randomUUID(),
        expiresAt: this.now() + 2000,
      });
    } else {
      this.uno.delete(id);
      this.unoWindows.delete(id);
    }
    let steps = 1;
    if (card.value === "reverse") {
      this.direction *= -1;
      if (this.players.length === 2) steps = 2;
    }
    if (card.value === "skip") steps = 2;
    const target = this.players[this.nextIndex()];
    if (card.value === "draw2" || card.value === "wild4") {
      this.pendingDraw += card.value === "draw2" ? 2 : 4;
    }
    const total = this.pendingDraw;
    this.notice = total
      ? `+${total} à piocher : surenchérissez avec ${card.value === "draw2" ? "un +2 ou un +4" : "un +4"}, ou piochez le total.`
      : card.value === "reverse"
        ? "Le sens du jeu est inversé."
        : card.value === "skip"
          ? "Le joueur suivant passe son tour."
          : "Une carte a été jouée.";
    if (!this.hands[id].length) {
      // A last-card win ends the chain: no player can play after victory.
      if (this.pendingDraw) {
        this.take(target, this.pendingDraw);
        this.pendingDraw = 0;
      }
      this.winner = id;
      this.unoWindows.clear();
      this.notice = "La partie est terminée !";
    }
    this.advance(steps);
    this.recordAction({
      type: "play",
      actor: id,
      target,
      card,
      color: this.color,
      previousColor,
      direction: this.direction,
      total,
      settled: Boolean(this.winner),
    });
  }

  draw(id) {
    this.assertTurn(id);
    requireRule(
      !this.drawn,
      "Vous avez déjà pioché. Jouez la carte piochée ou passez.",
    );
    if (this.pendingDraw) {
      const total = this.pendingDraw;
      const before = this.hands[id].length;
      this.take(id, total);
      const amount = this.hands[id].length - before;
      this.pendingDraw = 0;
      this.advance();
      this.notice = `${amount} carte${amount === 1 ? "" : "s"} piochée${amount === 1 ? "" : "s"}. La chaîne est terminée, le joueur passe son tour.`;
      this.recordAction({ type: "penalty", actor: id, amount, total });
      return;
    }
    const card = this.take(id, 1);
    this.notice = "Une carte a été piochée.";
    if (card && this.canPlay(id, card)) this.drawn = card.id;
    else this.advance();
    this.recordAction({ type: "draw", actor: id, amount: card ? 1 : 0 });
  }
  pass(id) {
    this.assertTurn(id);
    requireRule(Boolean(this.drawn), "Piochez avant de passer votre tour.");
    this.advance();
    this.notice = "Le joueur passe son tour.";
  }
  announceUno(id) {
    requireRule(
      !this.winner && Boolean(this.hands[id]),
      "Aucune partie en cours pour ce joueur.",
    );
    if (this.hands[id].length > 1) {
      this.unoPenalty(id, "falseUno");
      return;
    }
    requireRule(
      this.hands[id].length === 1,
      "Il faut une carte pour annoncer UNO.",
    );
    if (this.uno.has(id)) return;
    const window = this.unoWindows.get(id);
    requireRule(
      !window || this.now() < window.expiresAt,
      "Les 2 secondes sont écoulées : vous pouvez être contre-UNO.",
    );
    this.uno.add(id);
    this.unoWindows.delete(id);
    this.notice = "UNO !";
  }
  unoPenalty(id, reason, by = id) {
    const before = this.hands[id].length;
    this.take(id, 2);
    this.unoWindows.delete(id);
    this.uno.delete(id);
    this.notice =
      reason === "falseUno"
        ? "Fausse annonce UNO : +2 cartes !"
        : "Contre-UNO : +2 cartes pour le joueur pris en faute !";
    this.recordAction({
      type: "unoPenalty",
      reason,
      actor: id,
      by,
      amount: this.hands[id].length - before,
    });
  }
  counterUno(id, targetId, windowId) {
    requireRule(
      !this.winner && Boolean(this.hands[id]),
      "Aucune partie en cours pour ce joueur.",
    );
    const window = this.unoWindows.get(targetId);
    requireRule(
      id !== targetId &&
        Boolean(window) &&
        window.id === windowId &&
        this.hands[targetId]?.length === 1 &&
        !this.uno.has(targetId),
      "Ce joueur ne peut pas être contre-UNO.",
    );
    requireRule(
      this.now() >= window.expiresAt,
      "Le joueur dispose encore de ses 2 secondes pour annoncer UNO.",
    );
    this.unoPenalty(targetId, "counterUno", id);
  }

  view(id) {
    return {
      hand: this.hands[id],
      top: this.top,
      color: this.color,
      current: this.current,
      direction: this.direction,
      winner: this.winner,
      drawCount: this.drawPile.length,
      discardCount: this.discard.length,
      playable: this.hands[id]
        .filter((card) => this.canPlay(id, card))
        .map((card) => card.id),
      canPass: this.current === id && Boolean(this.drawn) && !this.winner,
      canDraw: this.current === id && !this.drawn && !this.winner,
      counts: Object.fromEntries(
        this.players.map((p) => [p, this.hands[p].length]),
      ),
      uno: [...this.uno],
      notice: this.notice,
      pendingDraw: this.pendingDraw,
      roundId: this.roundId,
      lastAction: this.lastAction,
      order: this.players,
      unoWindows: Object.fromEntries(this.unoWindows),
      counterTargets: this.winner
        ? []
        : [...this.unoWindows]
            .filter(
              ([target, w]) =>
                target !== id &&
                this.hands[target].length === 1 &&
                this.now() >= w.expiresAt,
            )
            .map(([target]) => target),
    };
  }
}
