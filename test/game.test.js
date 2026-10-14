import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, Game } from "../src/game.js";

let nextId = 0;
const card = (color, value) => ({ id: `test${nextId++}`, color, value });
function fixture(ids = ["a", "b", "c"]) {
  const game = new Game(ids);
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

test("skip, reverse, draw2 and wild4 apply penalties and skip turns", () => {
  for (const [value, next, direction, penalty] of [
    ["skip", "c", 1, 0],
    ["reverse", "c", -1, 0],
    ["draw2", "c", 1, 2],
    ["wild4", "c", 1, 4],
  ]) {
    const game = fixture();
    const action = give(game, "a", value === "wild4" ? "wild" : "red", value);
    const before = game.hands.b.length;
    game.play("a", action.id, "green");
    assert.equal(game.current, next);
    assert.equal(game.direction, direction);
    assert.equal(game.hands.b.length, before + penalty);
    if (value === "wild4") assert.equal(game.color, "green");
  }
  const game = fixture(["a", "b"]);
  game.play("a", give(game, "a", "red", "reverse").id);
  assert.equal(game.current, "a");
});

test("matching action symbol is playable across colors", () => {
  const game = fixture();
  game.discard = [card("red", "skip")];
  const match = give(game, "a", "blue", "skip");
  assert.equal(game.canPlay("a", match), true);
  game.play("a", match.id);
  assert.equal(game.color, "blue");
});

test("wild requires a color; +4 is forbidden with an active-color card", () => {
  const game = fixture();
  const four = give(game, "a", "wild", "wild4");
  const red = give(game, "a", "red", "8");
  assert.throws(() => game.play("a", four.id, "blue"));
  game.hands.a = [four, card("blue", "2")];
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

test("UNO announcement prevents penalty; late announcement is allowed until next action", () => {
  for (const timing of ["before", "after", "missing"]) {
    const game = fixture();
    const red = card("red", "9");
    game.hands.a = [red, card("yellow", "3")];
    if (timing === "before") game.announceUno("a");
    game.play("a", red.id);
    if (timing === "after") game.announceUno("a");
    game.play("b", give(game, "b", "red", "7").id);
    assert.equal(game.hands.a.length, timing === "missing" ? 3 : 1);
  }
  assert.throws(() => fixture().announceUno("a"));
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
        if (game.hands[id].length <= 2) game.announceUno(id);
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
