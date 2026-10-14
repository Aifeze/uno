import express from "express";
import { createServer as createHttpServer } from "node:http";
import { Server } from "socket.io";
import { randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Game, RuleError } from "./src/game.js";

export function createApp({ disconnectGrace = 60_000, actionLimit = 60 } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));
  const http = createHttpServer(app);
  const io = new Server(http, { maxHttpBufferSize: 16_384 });
  const rooms = new Map();
  const sessions = new Map();
  const timers = new Set();
  let closing = false;
  function publish(room) {
    room.revision = (room.revision || 0) + 1;
    for (const player of room.players) {
      if (!player.socketId) continue;
      io.to(player.socketId).emit("state", {
        code: room.code,
        host: room.host,
        self: player.id,
        revision: room.revision,
        players: room.players.map(({ id, name, socketId }) => ({
          id,
          name,
          connected: Boolean(socketId),
        })),
        game: room.game?.view(player.id) ?? null,
      });
    }
  }
  function remove(session) {
    const room = rooms.get(session.code);
    clearTimeout(session.timer);
    timers.delete(session.timer);
    sessions.delete(session.token);
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== session.id);
    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }
    if (room.host === session.id) room.host = room.players[0].id;
    if (room.game) {
      room.game = null;
      for (const p of room.players)
        if (p.socketId)
          io.to(p.socketId).emit(
            "notice",
            "Un joueur a quitté. Vous pouvez lancer une nouvelle partie.",
          );
    }
    publish(room);
  }
  io.on("connection", (socket) => {
    let session = null;
    let rateStart = Date.now(),
      events = 0;
    function action(event, fn) {
      socket.on(event, (data, ack) => {
        const reply = typeof ack === "function" ? ack : () => {};
        try {
          if (Date.now() - rateStart > 10_000) {
            rateStart = Date.now();
            events = 0;
          }
          if (++events > actionLimit)
            throw new RuleError(
              "Trop de demandes. Patientez quelques secondes.",
            );
          const result = fn(data && typeof data === "object" ? data : {});
          reply({ ok: true, ...result });
        } catch (error) {
          if (!(error instanceof RuleError)) console.error(error);
          reply({
            ok: false,
            error:
              error instanceof RuleError
                ? error.message
                : "Erreur interne du serveur.",
          });
        }
      });
    }
    const needRoom = () => {
      const room = session && rooms.get(session.code);
      if (!room || session.socketId !== socket.id)
        throw new RuleError("Rejoignez un salon.");
      return room;
    };
    const needGame = () => {
      const room = needRoom();
      if (!room.game) throw new RuleError("La partie n’a pas commencé.");
      if (room.players.some((p) => !p.socketId))
        throw new RuleError("Partie en pause : un joueur se reconnecte.");
      return room;
    };
    action("room:enter", ({ name, code, create }) => {
      if (session) throw new RuleError("Vous êtes déjà dans un salon.");
      if (typeof name !== "string" || !name.trim() || name.trim().length > 20)
        throw new RuleError("Choisissez un pseudo de 1 à 20 caractères.");
      let room;
      if (create === true) {
        if (rooms.size >= 500)
          throw new RuleError("Le serveur est complet. Réessayez plus tard.");
        let newCode;
        do {
          newCode = `UNO-${randomInt(1000, 10000)}`;
        } while (rooms.has(newCode));
        room = { code: newCode, host: null, players: [], game: null };
      } else {
        room = typeof code === "string" && rooms.get(code.trim().toUpperCase());
        if (!room)
          throw new RuleError("Ce salon est introuvable. Vérifiez le code.");
        if (room.game && !room.game.winner)
          throw new RuleError("Cette partie a déjà commencé.");
        if (room.players.length >= 8)
          throw new RuleError("Ce salon est complet (8 joueurs).");
        // Finished hands cannot be viewed by a newly joined player.
        if (room.game?.winner) room.game = null;
      }
      session = {
        id: randomUUID(),
        token: randomUUID(),
        name: name.trim(),
        code: room.code,
        socketId: socket.id,
        timer: null,
      };
      sessions.set(session.token, session);
      rooms.set(room.code, room);
      room.players.push(session);
      room.host ??= session.id;
      publish(room);
      return { token: session.token };
    });
    action("session:resume", ({ token }) => {
      if (session) throw new RuleError("Session déjà active.");
      const previous = typeof token === "string" && sessions.get(token);
      if (!previous)
        throw new RuleError("La session a expiré. Rejoignez un salon.");
      if (previous.socketId)
        throw new RuleError("Cette session est déjà ouverte.");
      session = previous;
      clearTimeout(session.timer);
      timers.delete(session.timer);
      session.socketId = socket.id;
      publish(needRoom());
    });
    action("room:leave", () => {
      needRoom();
      remove(session);
      session = null;
      socket.emit("left");
    });
    action("game:start", () => {
      const room = needRoom();
      if (room.host !== session.id)
        throw new RuleError("Seul l’hôte peut lancer la partie.");
      if (room.game && !room.game.winner)
        throw new RuleError("Une partie est déjà en cours.");
      if (room.players.some((p) => !p.socketId))
        throw new RuleError("Attendez la reconnexion des joueurs.");
      room.game = new Game(room.players.map((p) => p.id));
      publish(room);
    });
    for (const [event, run] of Object.entries({
      "game:play": (game, data) =>
        game.play(session.id, data.cardId, data.color),
      "game:draw": (game) => game.draw(session.id),
      "game:pass": (game) => game.pass(session.id),
      "game:uno": (game) => game.announceUno(session.id),
    }))
      action(event, (data) => {
        const room = needGame();
        run(room.game, data);
        publish(room);
      });
    socket.on("disconnect", () => {
      if (closing) return;
      if (!session || session.socketId !== socket.id) return;
      session.socketId = null;
      session.timer = setTimeout(() => remove(session), disconnectGrace);
      timers.add(session.timer);
      publish(rooms.get(session.code));
    });
  });
  return {
    http,
    io,
    close: () =>
      new Promise((resolve) => {
        closing = true;
        for (const timer of timers) clearTimeout(timer);
        io.close(resolve);
      }),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { http } = createApp();
  const port = Number(process.env.PORT || 3000);
  http.listen(port, "0.0.0.0", () =>
    console.log(`UNO prêt sur le port ${port}`),
  );
}
