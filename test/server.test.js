import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { io } from "socket.io-client";
import { createApp } from "../server.js";

async function setup(t, options) {
  const app = createApp(options);
  app.http.listen(0, "127.0.0.1");
  await once(app.http, "listening");
  const url = `http://127.0.0.1:${app.http.address().port}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.disconnect();
    await app.close();
  });
  const connect = async () => {
    const client = io(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    client.on("state", (state) => {
      client.state = state;
    });
    clients.push(client);
    await once(client, "connect");
    return client;
  };
  return { url, connect };
}
const send = (client, event, data = {}) =>
  client.timeout(3000).emitWithAck(event, data);
function waitState(client, predicate) {
  if (client.state && predicate(client.state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off("state", listener);
      reject(new Error("State not received"));
    }, 3000);
    const listener = (state) => {
      if (predicate(state)) {
        clearTimeout(timer);
        client.off("state", listener);
        resolve();
      }
    };
    client.on("state", listener);
  });
}
const sync = (players, revision) =>
  Promise.all(players.map((p) => waitState(p, (s) => s.revision >= revision)));

test("HTTP serves the application, styles, Socket.io client and health endpoint", async (t) => {
  const { url } = await setup(t);
  for (const path of [
    "/",
    "/styles.css",
    "/app.js",
    "/effects.js",
    "/socket.io/socket.io.js",
    "/favicon.svg",
  ]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 100);
  }
  assert.deepEqual(await (await fetch(url + "/health")).json(), {
    status: "ok",
  });
});

test("8 real clients: host authority, capacity, private hands, strict turns and complete game", async (t) => {
  const { connect } = await setup(t, { actionLimit: 20_000 });
  const host = await connect();
  assert.equal(
    (await send(host, "room:enter", { name: "Host", create: true })).ok,
    true,
  );
  const code = host.state.code;
  assert.match(code, /^UNO-\d{4}$/);
  assert.equal((await send(host, "game:start")).ok, false);
  const players = [host];
  for (let i = 1; i < 8; i++) {
    const client = await connect();
    players.push(client);
    assert.equal(
      (await send(client, "room:enter", { name: `Player ${i}`, code })).ok,
      true,
    );
  }
  assert.equal(host.state.players.length, 8);
  const extra = await connect();
  assert.equal(
    (await send(extra, "room:enter", { name: "Extra", code })).ok,
    false,
  );
  assert.equal((await send(players[1], "game:start")).ok, false);
  assert.equal((await send(host, "game:start")).ok, true);
  await sync(players, host.state.revision);
  const handIds = new Set();
  for (const player of players) {
    assert.equal(player.state.game.hand.length, 7);
    assert.equal("hands" in player.state.game, false);
    assert.ok(
      player.state.players.every((p) => !("token" in p) && !("hand" in p)),
    );
    for (const card of player.state.game.hand) {
      assert.ok(!handIds.has(card.id));
      handIds.add(card.id);
    }
  }
  assert.equal((await send(players[1], "game:draw")).ok, false);
  assert.equal((await send(host, "game:play", { cardId: "forged" })).ok, false);
  assert.equal(
    (await send(extra, "room:enter", { name: "Late", code })).ok,
    false,
  );
  let actions = 0;
  while (!host.state.game.winner && actions++ < 5000) {
    const actor = players.find((p) => p.state.self === host.state.game.current);
    const { game } = actor.state;
    if (game.pendingDraw) {
      assert.equal(game.canPass, false);
      assert.equal(game.canDraw, true);
      for (const id of game.playable) {
        const card = game.hand.find((c) => c.id === id);
        assert.ok(
          card.value === "wild4" ||
            (card.value === "draw2" && game.top.value === "draw2"),
        );
      }
    }
    if (game.hand.length <= 2) {
      assert.equal((await send(actor, "game:uno")).ok, true);
      await sync(players, actor.state.revision);
    }
    const reply = game.playable.length
      ? await send(actor, "game:play", {
          cardId: game.playable[0],
          color: ["red", "blue", "green", "yellow"][actions % 4],
        })
      : await send(actor, game.canPass ? "game:pass" : "game:draw");
    assert.equal(reply.ok, true, reply.error);
    await sync(players, actor.state.revision);
    for (const player of players) {
      assert.equal(player.state.game.pendingDraw, actor.state.game.pendingDraw);
      assert.deepEqual(
        player.state.game.lastAction,
        actor.state.game.lastAction,
      );
    }
  }
  assert.ok(host.state.game.winner);
  assert.equal((await send(host, "game:start")).ok, true);
  assert.equal(host.state.game.winner, null);
  assert.equal(host.state.game.hand.length, 7);
});

test("session resumes privately, disconnect pauses play, and leaving returns everyone to lobby", async (t) => {
  const { connect } = await setup(t);
  const a = await connect(),
    b = await connect();
  const { token } = await send(a, "room:enter", {
    name: "<script>alert(1)</script>",
    create: true,
  });
  // Overlong names are rejected, including this input.
  assert.equal(token, undefined);
  const entry = await send(a, "room:enter", { name: "Alice", create: true });
  await send(b, "room:enter", { name: "Bob", code: a.state.code });
  await send(a, "game:start");
  await sync([a, b], a.state.revision);
  const hand = a.state.game.hand;
  a.disconnect();
  await waitState(b, (s) => !s.players[0].connected);
  assert.equal(b.state.players[0].connected, false);
  assert.equal((await send(b, "game:draw")).ok, false);
  const resumed = await connect();
  assert.equal(
    (await send(resumed, "session:resume", { token: entry.token })).ok,
    true,
  );
  assert.deepEqual(resumed.state.game.hand, hand);
  assert.equal(resumed.state.self, a.state.self);
  const thief = await connect();
  assert.equal(
    (await send(thief, "session:resume", { token: entry.token })).ok,
    false,
  );
  await send(resumed, "room:leave");
  await waitState(b, (s) => s.game === null);
  assert.equal(b.state.game, null);
  assert.equal(b.state.host, b.state.self);
});

test("excessive action requests are rate limited", async (t) => {
  const { connect } = await setup(t);
  const client = await connect();
  for (let i = 0; i < 60; i++) await send(client, "game:draw");
  assert.match((await send(client, "game:draw")).error, /Trop de demandes/);
});

test("expired disconnected players are removed, their session is invalidated, and host is reassigned", async (t) => {
  const { connect } = await setup(t, { disconnectGrace: 30 });
  const a = await connect(),
    b = await connect();
  const { token } = await send(a, "room:enter", {
    name: "Alice",
    create: true,
  });
  await send(b, "room:enter", { name: "Bob", code: a.state.code });
  const removed = new Promise((resolve) =>
    b.on("state", (s) => {
      if (s.players.length === 1) resolve();
    }),
  );
  a.disconnect();
  await removed;
  assert.equal(b.state.host, b.state.self);
  const resume = await connect();
  assert.equal((await send(resume, "session:resume", { token })).ok, false);
});
