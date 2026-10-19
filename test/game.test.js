import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, Game } from "../src/game.js";

let nextId = 0;
const card = (color, value) => ({ id: `test${nextId++}`, color, value });
function fixture(ids = ["a", "b", "c"], options = {}) {
  const game = new Game(ids, { pickIndex: (max) => max - 1, ...options });
  for (const id of ids)
    game.hands[id] = [
      card("blue", "2"),
      card("green", "3"),
      card("yellow", "8"),
    ];
  game.discard = [card("red", "5")];
  game.color = "red";
  return game;
}
function give(game, id, color, value) {
  const c = card(color, value);
  game.hands[id].push(c);
  return c;
}

test("108 unique cards, correct composition and seven-card deals for 2–8 players", () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((c) => c.id)).size, 108);
  assert.equal(deck.filter((c) => c.color === "wild").length, 8);
  for (let count = 2; count <= 8; count++) {
    const game = new Game(Array.from({ length: count }, (_, i) => String(i)));
    assert.ok(Object.values(game.hands).every((hand) => hand.length === 7));
    assert.equal(game.drawPile.length, 108 - count * 7 - 1);
    assert.match(game.top.value, /^\d$/);
  }
  assert.throws(() => new Game(["a"]));
  assert.throws(() => new Game(["a", "a"]));
});

test("turn ownership, matching values and illegal cards are validated without mutation", () => {
  const game = fixture();
  const sameValue = give(game, "a", "yellow", "5");
  const before = JSON.stringify(game.view("a"));
  assert.throws(() => game.play("b", game.hands.b[0].id));
  assert.throws(() => game.play("a", "invented"));
  assert.throws(() => game.play("a", game.hands.a[0].id));
  assert.equal(JSON.stringify(game.view("a")), before);
  game.play("a", sameValue.id);
  assert.equal(game.color, "yellow");
  assert.equal(game.current, "b");
});

test("skip and reverse skip turns, while + cards open a penalty chain", () => {
  for (const [value, next, direction, penalty] of [
    ["skip", "c", 1, 0],
    ["reverse", "c", -1, 0],
    ["draw2", "b", 1, 2],
    ["wild4", "b", 1, 4],
  ]) {
    const game = fixture();
    const action = give(game, "a", value === "wild4" ? "wild" : "red", value);
    const before = game.hands.b.length;
    game.play("a", action.id, "green");
    assert.equal(game.current, next);
    assert.equal(game.direction, direction);
    assert.equal(game.hands.b.length, before);
    assert.equal(game.pendingDraw, penalty);
    if (value === "wild4") assert.equal(game.color, "green");
  }
  const game = fixture(["a", "b"]);
  game.play("a", give(game, "a", "red", "reverse").id);
  assert.equal(game.current, "a");
});

test("+2 → +2 → +4 → +4 accumulates 12; +2 cannot be played on +4", () => {
  const game = fixture(["a", "b", "c", "d"]);
  game.play("a", give(game, "a", "red", "draw2").id);
  assert.equal(game.pendingDraw, 2);
  game.play("b", give(game, "b", "blue", "draw2").id);
  assert.equal(game.pendingDraw, 4);
  // C has blue cards: +4 may still be used to defend against a penalty.
  game.play("c", give(game, "c", "wild", "wild4").id, "green");
  assert.equal(game.pendingDraw, 8);
  const two = give(game, "d", "green", "draw2");
  assert.equal(game.canPlay("d", two), false);
  const before = JSON.stringify(game.view("d"));
  assert.throws(() => game.play("d", two.id));
  assert.equal(JSON.stringify(game.view("d")), before);
  game.play("d", give(game, "d", "wild", "wild4").id, "yellow");
  assert.equal(game.pendingDraw, 12);
  assert.equal(game.current, "a");
  const size = game.hands.a.length;
  game.draw("a");
  assert.equal(game.hands.a.length, size + 12);
  assert.equal(game.current, "b");
  assert.equal(game.pendingDraw, 0);
  assert.equal(game.color, "yellow");
  assert.equal(game.lastAction.type, "penalty");
  assert.equal(game.lastAction.amount, 12);
});

test("pending penalty forbids ordinary cards, jokers, passing, invalid colors and out-of-turn play", () => {
  const game = fixture();
  game.play("a", give(game, "a", "red", "draw2").id);
  for (const value of ["9", "skip", "reverse", "wild"]) {
    const c = give(game, "b", value === "wild" ? "wild" : "red", value);
    assert.equal(game.canPlay("b", c), false);
    assert.throws(() => game.play("b", c.id, "red"));
  }
  const four = give(game, "b", "wild", "wild4");
  const before = JSON.stringify(game.view("b"));
  assert.throws(() => game.play("b", four.id, "purple"));
  assert.throws(() => game.pass("b"));
  assert.throws(() => game.draw("c"));
  assert.equal(JSON.stringify(game.view("b")), before);
  assert.equal(game.view("b").canPass, false);
  assert.equal(game.view("b").canDraw, true);
});

test("player may accept a penalty despite having a stacking card; no card from it can be played", () => {
  const game = fixture();
  game.play("a", give(game, "a", "red", "draw2").id);
  const defense = give(game, "b", "yellow", "draw2");
  assert.ok(game.view("b").playable.includes(defense.id));
  const size = game.hands.b.length;
  game.draw("b");
  assert.equal(game.hands.b.length, size + 2);
  assert.equal(game.drawn, null);
  assert.equal(game.current, "c");
  assert.equal(game.pendingDraw, 0);
  assert.throws(() => game.play("b", defense.id));
});

test("penalty chains follow reverse direction and work with two players", () => {
  for (const ids of [
    ["a", "b"],
    ["a", "b", "c"],
  ]) {
    const game = fixture(ids);
    game.direction = -1;
    game.play("a", give(game, "a", "red", "draw2").id);
    const next = ids.at(-1);
    assert.equal(game.current, next);
    game.play(next, give(game, next, "blue", "draw2").id);
    assert.equal(game.pendingDraw, 4);
    const recipient = game.current;
    const size = game.hands[recipient].length;
    game.draw(recipient);
    assert.equal(game.hands[recipient].length, size + 4);
    assert.equal(game.direction, -1);
  }
});

test("pending penalty recycles the deck and clears even if fewer cards remain available", () => {
  const game = fixture();
  game.play("a", give(game, "a", "red", "draw2").id);
  const top = game.top;
  game.drawPile = [card("green", "4")];
  game.discard.unshift(card("blue", "6"), card("yellow", "7"));
  const size = game.hands.b.length;
  game.draw("b");
  assert.equal(game.hands.b.length, size + 2);
  assert.equal(game.top, top);
  const empty = fixture();
  empty.play("a", give(empty, "a", "red", "draw2").id);
  empty.drawPile = [];
  empty.discard = [empty.top];
  empty.draw("b");
  assert.equal(empty.pendingDraw, 0);
  assert.equal(empty.current, "c");
  assert.equal(empty.lastAction.amount, 0);
});

test("finishing a chain settles its full total and forbids further stacking", () => {
  const game = fixture();
  game.play("a", give(game, "a", "red", "draw2").id);
  const last = card("wild", "wild4");
  game.hands.b = [last];
  const size = game.hands.c.length;
  game.play("b", last.id, "blue");
  assert.equal(game.winner, "b");
  assert.equal(game.hands.c.length, size + 6);
  assert.equal(game.pendingDraw, 0);
  assert.equal(game.lastAction.total, 6);
  assert.equal(game.lastAction.settled, true);
  assert.throws(() => game.draw("c"));
});

test("public action IDs advance only for played/drawn cards and never reveal drawn cards", () => {
  const game = fixture();
  game.hands.a = [card("red", "draw2"), card("yellow", "9")];
  assert.equal(game.lastAction, null);
  game.play("a", game.hands.a[0].id);
  const effect = game.view("c").lastAction;
  assert.equal(effect.id, 1);
  assert.equal(effect.card.value, "draw2");
  assert.equal(effect.target, "b");
  assert.equal(effect.previousColor, "red");
  game.announceUno("a");
  assert.equal(game.lastAction.id, 1);
  game.draw("b");
  assert.equal(game.lastAction.id, 2);
  assert.equal("card" in game.view("c").lastAction, false);
  assert.notEqual(game.roundId, fixture().roundId);
});

test("matching action symbol is playable across colors", () => {
  const game = fixture();
  game.discard = [card("red", "skip")];
  const match = give(game, "a", "blue", "skip");
  assert.equal(game.canPlay("a", match), true);
  game.play("a", match.id);
  assert.equal(game.color, "blue");
});

test("+4 is legal with an active-color card; wild cards still need a valid chosen color and turn", () => {
  const game = fixture();
  const four = give(game, "a", "wild", "wild4");
  const red = give(game, "a", "red", "8");
  assert.ok(game.canPlay("a", four));
  assert.throws(() => game.play("a", four.id, "purple"));
  game.play("a", four.id, "yellow");
  assert.equal(game.color, "yellow");
  const wildGame = fixture();
  const wild = give(wildGame, "a", "wild", "wild");
  assert.throws(() => wildGame.play("a", wild.id));
  wildGame.play("a", wild.id, "green");
  assert.equal(wildGame.color, "green");
  assert.ok(red);
});

test("drawing allows only the drawn card and supports passing, with no second draw", () => {
  const game = fixture();
  const old = give(game, "a", "red", "1");
  const drawn = card("red", "9");
  game.drawPile.push(drawn);
  assert.throws(() => game.pass("a"));
  game.draw("a");
  assert.equal(game.current, "a");
  assert.equal(game.drawn, drawn.id);
  assert.deepEqual(game.view("a").playable, [drawn.id]);
  assert.throws(() => game.draw("a"));
  assert.throws(() => game.play("a", old.id));
  game.pass("a");
  assert.equal(game.current, "b");
  const second = fixture();
  second.drawPile.push(card("blue", "7"));
  second.draw("a");
  assert.equal(second.current, "b");
  const third = fixture();
  const playable = card("red", "9");
  third.drawPile.push(playable);
  third.draw("a");
  third.play("a", playable.id);
  assert.equal(third.top.id, playable.id);
});

test("recycle preserves the top discard and recovers gracefully when deck is empty", () => {
  const game = fixture();
  const top = game.top;
  game.drawPile = [];
  game.discard.unshift(card("blue", "7"), card("green", "1"));
  game.draw("a");
  assert.equal(game.top.id, top.id);
  assert.equal(game.drawPile.length, 1);
  const empty = fixture();
  empty.drawPile = [];
  empty.draw("a");
  assert.equal(empty.current, "b");
});

test("false UNO announcements with 2 or more cards incur +2 without changing the turn", () => {
  for (const count of [2, 3, 7]) {
    const game = fixture();
    game.hands.b = Array.from({ length: count }, () => card("blue", "8"));
    game.announceUno("b");
    assert.equal(game.hands.b.length, count + 2);
    assert.equal(game.current, "a");
    assert.equal(game.uno.has("b"), false);
    assert.equal(game.lastAction.reason, "falseUno");
    assert.equal(game.lastAction.amount, 2);
  }
});

test("UNO announced within 2 seconds protects the player; no pre-announcement is accepted", () => {
  let time = 1000;
  const game = fixture(undefined, { now: () => time });
  const red = card("red", "9");
  game.hands.a = [red, card("yellow", "3")];
  game.play("a", red.id);
  const window = game.unoWindows.get("a");
  assert.equal(window.expiresAt, 3000);
  time = 2999;
  game.announceUno("a");
  assert.ok(game.uno.has("a"));
  assert.equal(game.unoWindows.has("a"), false);
  const actionId = game.lastAction.id;
  game.announceUno("a");
  assert.equal(game.lastAction.id, actionId);
  time = 3000;
  assert.throws(() => game.counterUno("b", "a", window.id));
});

test("counter-UNO becomes valid exactly at 2000ms, once, with no automatic penalty", () => {
  let time = 0;
  const game = fixture(undefined, { now: () => time });
  const red = card("red", "9");
  game.hands.a = [red, card("yellow", "3")];
  game.play("a", red.id);
  const window = game.unoWindows.get("a");
  time = 1999;
  assert.deepEqual(game.view("c").counterTargets, []);
  assert.throws(() => game.counterUno("c", "a", window.id));
  time = 2000;
  game.play("b", give(game, "b", "red", "7").id);
  assert.equal(
    game.hands.a.length,
    1,
    "No automatic penalty on another action",
  );
  assert.deepEqual(game.view("b").counterTargets, ["a"]);
  const turn = game.current;
  game.counterUno("b", "a", window.id); // B is no longer the active player.
  assert.equal(game.hands.a.length, 3);
  assert.equal(game.current, turn);
  assert.equal(game.lastAction.reason, "counterUno");
  assert.equal(game.lastAction.by, "b");
  assert.throws(() => game.counterUno("c", "a", window.id));
});

test("late UNO remains valid at and after the grace period until a counter wins the race", () => {
  for (const delay of [2000, 2001, 60000]) {
    let time = 0;
    const game = fixture(undefined, { now: () => time });
    game.hands.a = [card("red", "9"), card("yellow", "3")];
    game.play("a", game.hands.a[0].id);
    const window = game.unoWindows.get("a");
    time = delay;
    assert.deepEqual(game.view("b").counterTargets, ["a"]);
    const turn = game.current;
    const actionId = game.lastAction.id;
    game.announceUno("a");
    assert.equal(game.hands.a.length, 1);
    assert.equal(game.current, turn);
    assert.equal(game.lastAction.id, actionId);
    assert.ok(game.uno.has("a"));
    assert.equal(game.unoWindows.has("a"), false);
    assert.deepEqual(game.view("b").counterTargets, []);
    assert.throws(() => game.counterUno("b", "a", window.id));
    assert.throws(() => game.counterUno("c", "a", window.id));
  }
});

test("counter-UNO rejects self, unknown players and stale windows without mutating the game", () => {
  let time = 0;
  const game = fixture(undefined, { now: () => time });
  game.hands.a = [card("red", "9"), card("yellow", "3")];
  game.play("a", game.hands.a[0].id);
  const oldWindow = game.unoWindows.get("a");
  time = 2000;
  const before = JSON.stringify(game.view("b"));
  for (const [actor, target, window] of [
    ["a", "a", oldWindow.id],
    ["stranger", "a", oldWindow.id],
    ["b", "stranger", oldWindow.id],
    ["b", "a", "forged"],
  ]) {
    assert.throws(() => game.counterUno(actor, target, window));
  }
  assert.equal(JSON.stringify(game.view("b")), before);
  game.counterUno("b", "a", oldWindow.id);
  game.hands.a = [card("red", "7"), card("yellow", "1")];
  game.turn = 0;
  game.play("a", game.hands.a[0].id);
  time = 4000;
  assert.notEqual(game.unoWindows.get("a").id, oldWindow.id);
  assert.throws(() => game.counterUno("b", "a", oldWindow.id));
});

test("UNO penalties preserve pending + chains and close windows when a hand grows", () => {
  let time = 0;
  const game = fixture(undefined, { now: () => time });
  game.hands.a = [card("red", "draw2"), card("yellow", "3")];
  game.play("a", game.hands.a[0].id);
  const window = game.unoWindows.get("a");
  time = 2000;
  game.counterUno("c", "a", window.id);
  assert.equal(game.pendingDraw, 2);
  assert.equal(game.current, "b");
  assert.equal(game.unoWindows.has("a"), false);
  const before = game.hands.b.length;
  game.announceUno("b");
  assert.equal(game.hands.b.length, before + 2);
  assert.equal(game.pendingDraw, 2);
  game.draw("b");
  assert.equal(game.hands.b.length, before + 4);
  assert.equal(game.pendingDraw, 0);
});

test("counter-UNO cannot be repeated on an empty deck and is disabled after a victory", () => {
  let time = 0;
  const game = fixture(undefined, { now: () => time });
  game.hands.a = [card("red", "9"), card("yellow", "3")];
  game.play("a", game.hands.a[0].id);
  const window = game.unoWindows.get("a");
  game.drawPile = [];
  game.discard = [game.top];
  time = 2000;
  game.counterUno("b", "a", window.id);
  assert.equal(game.lastAction.amount, 0);
  assert.throws(() => game.counterUno("b", "a", window.id));
  game.hands.b = [card("red", "7")];
  game.play("b", game.hands.b[0].id);
  assert.deepEqual(game.view("a").counterTargets, []);
  assert.throws(() => game.counterUno("c", "a", window.id));
});

test("seating and first player are shuffled together on each new round without mutating input", () => {
  const ids = ["a", "b", "c", "d"];
  const first = new Game(ids, { pickIndex: () => 0 });
  const second = new Game(ids, { pickIndex: (max) => max - 1 });
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
  assert.deepEqual(first.players, ["b", "c", "d", "a"]);
  assert.equal(first.current, "b");
  assert.deepEqual(second.players, ids);
  assert.equal(second.current, "a");
  assert.deepEqual(first.view("d").order, first.players);
});

test("last action card applies its effect and ends game; subsequent actions are rejected", () => {
  const game = fixture();
  const last = card("red", "draw2");
  game.hands.a = [last];
  const before = game.hands.b.length;
  game.play("a", last.id);
  assert.equal(game.winner, "a");
  assert.equal(game.hands.b.length, before + 2);
  assert.deepEqual(game.view("b").playable, []);
  assert.throws(() => game.draw("c"));
  assert.throws(() => game.announceUno("a"));
});

test("complete simulated matches conserve all 108 cards and expose only the viewer’s hand", () => {
  for (const count of [2, 3, 8]) {
    for (let match = 0; match < 5; match++) {
      const game = new Game(Array.from({ length: count }, (_, i) => `p${i}`));
      let actions = 0;
      while (!game.winner && actions++ < 5000) {
        const id = game.current;
        if (game.hands[id].length === 1 && !game.uno.has(id))
          game.announceUno(id);
        const view = game.view(id);
        const playable = game.hands[id].find((c) =>
          view.playable.includes(c.id),
        );
        if (playable)
          game.play(
            id,
            playable.id,
            ["red", "blue", "green", "yellow"][actions % 4],
          );
        else if (view.canPass) game.pass(id);
        else game.draw(id);
        const all = [
          ...Object.values(game.hands).flat(),
          ...game.drawPile,
          ...game.discard,
        ];
        assert.equal(all.length, 108);
        assert.equal(new Set(all.map((c) => c.id)).size, 108);
        assert.equal("hands" in view, false);
        assert.equal("drawPile" in view, false);
      }
      assert.ok(game.winner, "The simulated match should finish");
    }
  }
});
