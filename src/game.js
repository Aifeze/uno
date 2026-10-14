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

export function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export class Game {
  constructor(playerIds) {
    requireRule(
      playerIds.length >= 2 &&
        playerIds.length <= 8 &&
        new Set(playerIds).size === playerIds.length,
      "Il faut entre 2 et 8 joueurs.",
    );
    this.players = [...playerIds];
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
    // During a chain the +4 color restriction is waived.
    if (this.pendingDraw)
      return (
        card.value === "wild4" ||
        (this.top.value === "draw2" && card.value === "draw2")
      );
    if (card.value === "wild4")
      return !this.hands[id].some((c) => c.color === this.color);
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
    if (this.hands[id].length > 2) this.uno.delete(id);
    return taken;
  }
  penalizeMissedUno(actor) {
    for (const id of this.players) {
      if (id !== actor && this.hands[id].length === 1 && !this.uno.has(id))
        this.take(id, 2);
    }
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
    this.penalizeMissedUno(id);
    const previousColor = this.color;
    this.hands[id].splice(index, 1);
    this.discard.push(card);
    this.color = card.color === "wild" ? color : card.color;
    if (this.hands[id].length !== 1) this.uno.delete(id);
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
    this.penalizeMissedUno(id);
    if (this.pendingDraw) {
      const total = this.pendingDraw;
      const before = this.hands[id].length;
      this.take(id, total);
      const amount = this.hands[id].length - before;
      this.pendingDraw = 0;
      this.uno.delete(id);
      this.advance();
      this.notice = `${amount} carte${amount === 1 ? "" : "s"} piochée${amount === 1 ? "" : "s"}. La chaîne est terminée, le joueur passe son tour.`;
      this.recordAction({ type: "penalty", actor: id, amount, total });
      return;
    }
    const card = this.take(id, 1);
    this.uno.delete(id);
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
      !this.winner && this.hands[id]?.length <= 2 && this.hands[id]?.length > 0,
      "Annoncez UNO avec une ou deux cartes.",
    );
    this.uno.add(id);
    this.notice = "UNO !";
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
    };
  }
}
