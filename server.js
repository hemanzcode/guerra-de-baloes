"use strict";
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const express = require("express");
const compression = require("compression");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e5,
  perMessageDeflate: false,          // menos latência em mensagens pequenas
  pingInterval: 8000,
  pingTimeout: 12000,
  transports: ["websocket", "polling"],
});
const PORT = process.env.PORT || 3000;

/* ---------- HTTP ---------- */
app.disable("x-powered-by");
app.use(compression());
const send = (name) => (_req, res) => res.sendFile(path.join(__dirname, name));
app.get("/", (_req, res) => { res.set("Cache-Control", "no-cache"); res.sendFile(path.join(__dirname, "index.html")); });
app.get("/index.html", (_req, res) => { res.set("Cache-Control", "no-cache"); res.sendFile(path.join(__dirname, "index.html")); });
app.get("/vendor/three.min.js", (_req, res) => { res.set("Cache-Control", "public, max-age=2592000, immutable"); res.sendFile(path.join(__dirname, "vendor", "three.min.js")); });
app.get("/icon.svg", (_req, res) => { res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400"); res.sendFile(path.join(__dirname, "icon.svg")); });
app.get("/manifest.json", (_req, res) => res.type("application/manifest+json").json({
  name: "Guerra de Balões", short_name: "Balões", start_url: "/", display: "fullscreen", orientation: "landscape",
  background_color: "#87b7e0", theme_color: "#87b7e0",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
}));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

/* ---------- Salas ---------- */
const TEAM_SIZE = 5, MAX_PLAYERS = 10, MAXR = 5;
const FREEZE = 3, LIVE = 100, END = 3.5;
const GRACE_MS = 25000;          // tempo para reconectar sem perder a vaga
const rooms = new Map();

const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f<>&"]/g, "").trim().slice(0, n);
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function genCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let tries = 0; tries < 200; tries++) {
    const c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
    if (!rooms.has(c)) return c;
  }
  return null;
}
function newRoom(code) {
  return {
    code, players: new Map(), order: [], phase: "lobby", round: 0, score: [0, 0], bots: true,
    matchId: 0, seed: 1, roster: [], cubes: new Set(), alive: new Map(), endsAt: 0, lastWinner: -2,
    botHost: null, emptyTimer: null,
  };
}
const connected = (room) => room.order.map((p) => room.players.get(p)).filter((p) => p && p.conn);
const hostOf = (room) => connected(room)[0]?.pid || null;
const left = (room) => Math.max(0, (room.endsAt - Date.now()) / 1000);
const inMatch = (room) => room.phase !== "lobby";

function lobbyMsg(room) {
  return {
    code: room.code, phase: room.phase, bots: room.bots, host: hostOf(room), matchId: room.matchId,
    players: room.order.map((pid) => room.players.get(pid)).filter(Boolean)
      .map((p) => ({ pid: p.pid, name: p.name, team: p.team, conn: p.conn, slot: p.slot })),
  };
}
function phaseMsg(room) {
  return {
    phase: room.phase, round: room.round, score: room.score, left: left(room), lastWinner: room.lastWinner,
    matchId: room.matchId, seed: room.seed, roster: room.roster, botHost: room.botHost,
    cubes: [...room.cubes],
  };
}
const emitLobby = (room) => io.to(room.code).emit("lobby", lobbyMsg(room));
const emitPhase = (room) => io.to(room.code).emit("phase", phaseMsg(room));

function pickBotHost(room) {
  const cand = connected(room).find((p) => p.slot >= 0);
  const next = cand ? cand.pid : null;
  if (next !== room.botHost) { room.botHost = next; io.to(room.code).emit("bothost", next); }
}

/* Monta os times: humanos escolhem lado (ou são balanceados) e bots completam até 5 */
function buildRoster(room) {
  const humans = connected(room);
  const teams = [[], []], spare = [];
  for (const p of humans) { if ((p.team === 0 || p.team === 1) && teams[p.team].length < TEAM_SIZE) teams[p.team].push(p); else spare.push(p); }
  for (const p of spare) {
    const t = teams[0].length <= teams[1].length ? 0 : 1;
    if (teams[t].length < TEAM_SIZE) teams[t].push(p); else if (teams[1 - t].length < TEAM_SIZE) teams[1 - t].push(p);
    else p.slot = -1;
  }
  const roster = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < TEAM_SIZE; i++) {
    const slot = t * TEAM_SIZE + i, h = teams[t][i];
    if (h) { h.slot = slot; h.team = t; roster.push({ slot, team: t, pid: h.pid, name: h.name }); }
    else roster.push({ slot, team: t, pid: null, name: "Bot " + (slot + 1) });
  }
  for (const p of humans) if (!roster.some((r) => r.pid === p.pid)) p.slot = -1;
  for (const p of room.players.values()) if (!p.conn) p.slot = roster.find((r) => r.pid === p.pid)?.slot ?? -1;
  return { roster, teams };
}

function startMatch(room) {
  const { roster, teams } = buildRoster(room);
  if (!room.bots && (!teams[0].length || !teams[1].length)) return "Sem bots, os dois times precisam ter jogadores.";
  if (!room.bots) for (const r of roster) if (!r.pid) r.dead = true;   // vagas vazias ficam fora
  room.roster = roster; room.matchId++; room.seed = (Math.random() * 1e9) | 0;
  room.round = 1; room.score = [0, 0]; room.lastWinner = -2;
  beginFreeze(room);
  return null;
}
function beginFreeze(room) {
  room.phase = "freeze"; room.endsAt = Date.now() + FREEZE * 1000; room.cubes.clear();
  room.alive.clear(); for (const r of room.roster) room.alive.set(r.slot, !r.dead);
  pickBotHost(room); emitLobby(room); emitPhase(room);
}
function counts(room) {
  const a = [0, 0];
  for (const r of room.roster) if (room.alive.get(r.slot)) a[r.team]++;
  return a;
}
function endRound(room, winner) {
  if (winner >= 0) room.score[winner]++;
  room.phase = "end"; room.lastWinner = winner; room.endsAt = Date.now() + END * 1000;
  emitPhase(room);
}
function tickRoom(room) {
  const now = Date.now();
  if (room.phase === "freeze" && now >= room.endsAt) { room.phase = "live"; room.endsAt = now + LIVE * 1000; emitPhase(room); }
  else if (room.phase === "live") {
    const a = counts(room);
    if (!a[0] && !a[1]) endRound(room, -1);
    else if (!a[1]) endRound(room, 0);
    else if (!a[0]) endRound(room, 1);
    else if (now >= room.endsAt) endRound(room, a[0] > a[1] ? 0 : a[1] > a[0] ? 1 : -1);
  } else if (room.phase === "end" && now >= room.endsAt) {
    if (room.round >= MAXR) { room.phase = "over"; room.endsAt = now; emitPhase(room); emitLobby(room); }
    else { room.round++; beginFreeze(room); }
  }
}
setInterval(() => { for (const room of rooms.values()) if (inMatch(room)) tickRoom(room); }, 100);

function dropPlayer(room, p) {
  if (p.slot >= 0 && inMatch(room)) room.alive.set(p.slot, false);
  room.players.delete(p.pid); room.order = room.order.filter((x) => x !== p.pid);
  if (p.slot >= 0 && inMatch(room)) io.to(room.code).emit("gone", p.slot);
  pickBotHost(room); emitLobby(room);
  if (!room.order.length) rooms.delete(room.code);
}

/* ---------- Sockets ---------- */
io.on("connection", (socket) => {
  const pidRaw = clean(socket.handshake.auth?.pid, 40);
  socket.data.pid = /^[a-z0-9-]{8,40}$/i.test(pidRaw) ? pidRaw : socket.id;
  let bucket = 80, last = Date.now();
  socket.use((_p, next) => {            // limite simples de mensagens por segundo
    const t = Date.now(); bucket = Math.min(120, bucket + (t - last) * 0.08); last = t;
    if (bucket < 1) return; bucket--; next();
  });
  const ctx = () => {
    const room = rooms.get(socket.data.code); const p = room?.players.get(socket.data.pid);
    return room && p ? { room, p } : {};
  };
  const ack = (cb, v) => { if (typeof cb === "function") cb(v); };

  function enter(room, name, cb) {
    const pid = socket.data.pid; let p = room.players.get(pid);
    if (p) {                                         // reconexão
      clearTimeout(p.timer); p.conn = true; p.sid = socket.id; if (name) p.name = name;
    } else {
      if (room.order.length >= MAX_PLAYERS) return ack(cb, { ok: false, error: "A sala está cheia." });
      p = { pid, sid: socket.id, name: name || "Jogador", team: null, conn: true, slot: -1, timer: null };
      room.players.set(pid, p); room.order.push(pid);
    }
    clearTimeout(room.emptyTimer);
    socket.data.code = room.code; socket.join(room.code);
    ack(cb, { ok: true, pid, lobby: lobbyMsg(room) });
    if (inMatch(room)) socket.emit("phase", phaseMsg(room));
    pickBotHost(room); emitLobby(room);
  }

  socket.on("create", ({ name } = {}, cb) => {
    if (rooms.size > 200) return ack(cb, { ok: false, error: "Servidor lotado, tente em instantes." });
    const code = genCode(); if (!code) return ack(cb, { ok: false, error: "Não foi possível criar a sala." });
    const room = newRoom(code); rooms.set(code, room);
    enter(room, clean(name, 16), cb);
  });
  socket.on("join", ({ code, name } = {}, cb) => {
    const room = rooms.get(String(code || "").toUpperCase().trim());
    if (!room) return ack(cb, { ok: false, error: "Sala não encontrada. Confira o código." });
    enter(room, clean(name, 16), cb);
  });
  socket.on("team", (t) => { const { room, p } = ctx(); if (!room || inMatch(room) && room.phase !== "over") return; p.team = t === 0 || t === 1 ? t : null; emitLobby(room); });
  socket.on("bots", (on) => { const { room, p } = ctx(); if (!room || p.pid !== hostOf(room) || (inMatch(room) && room.phase !== "over")) return; room.bots = !!on; emitLobby(room); });
  socket.on("start", (_a, cb) => {
    const { room, p } = ctx(); if (!room || p.pid !== hostOf(room)) return ack(cb, { ok: false, error: "Só o anfitrião inicia." });
    if (room.phase !== "lobby" && room.phase !== "over") return ack(cb, { ok: false });
    const err = startMatch(room); ack(cb, err ? { ok: false, error: err } : { ok: true });
  });
  socket.on("toLobby", () => { const { room, p } = ctx(); if (!room || p.pid !== hostOf(room) || room.phase !== "over") return; room.phase = "lobby"; for (const q of room.players.values()) q.slot = -1; room.roster = []; emitLobby(room); emitPhase(room); });
  socket.on("leave", () => { const { room, p } = ctx(); if (!room) return; socket.leave(room.code); socket.data.code = null; dropPlayer(room, p); });

  /* estado do jogador: [x,y,z,ry,hp,ammo,alive,tank,tammo,heli,hammo] */
  socket.on("st", (a) => {
    const { room, p } = ctx(); if (!room || p.slot < 0 || !Array.isArray(a) || a.length < 11 || a.length > 12) return;
    const s = a.map(num);
    if (!s[6] && room.phase === "live") room.alive.set(p.slot, false);
    socket.to(room.code).volatile.emit("s", p.slot, s);
  });
  /* bots simulados pelo anfitrião das IAs: [[slot,x,y,z,ry,hp,alive]...] */
  socket.on("bt", (arr) => {
    const { room, p } = ctx(); if (!room || p.pid !== room.botHost || !Array.isArray(arr) || arr.length > 10) return;
    const out = [];
    for (const b of arr) { if (!Array.isArray(b) || b.length !== 7) continue; const v = b.map(num); out.push(v);
      const r = room.roster[v[0]]; if (r && !r.pid && !r.dead && !v[6] && room.phase === "live") room.alive.set(v[0], false); }
    socket.to(room.code).volatile.emit("bt", out);
  });
  socket.on("throw", (d) => {
    const { room, p } = ctx(); if (!room || !d || typeof d !== "object") return;
    const slot = Number.isInteger(d.by) ? d.by : p.slot;
    if (slot !== p.slot && !(p.pid === room.botHost && room.roster[slot] && !room.roster[slot].pid)) return;
    const o = { by: slot, team: slot >= 5 ? 1 : 0, x: num(d.x), y: num(d.y), z: num(d.z), vx: clamp(num(d.vx), -80, 80), vy: clamp(num(d.vy), -80, 80), vz: clamp(num(d.vz), -80, 80), dmg: clamp(num(d.dmg), 1, 40) };
    socket.to(room.code).emit("throw", o);
  });
  socket.on("kill", (d) => {
    const { room, p } = ctx(); if (!room || !d) return; const v = d.v | 0, k = d.k | 0;
    const mine = v === p.slot || (p.pid === room.botHost && room.roster[v] && !room.roster[v].pid);
    if (!mine || v < 0 || v > 9) return; room.alive.set(v, false);
    io.to(room.code).emit("kill", { v, k: k >= 0 && k <= 9 ? k : -1 });
  });
  socket.on("cube", (idx) => {
    const { room, p } = ctx(); if (!room || room.phase !== "live" || p.slot < 0 || !Number.isInteger(idx) || idx < 0 || idx > 15 || room.cubes.has(idx)) return;
    room.cubes.add(idx); io.to(room.code).emit("cube", { i: idx, by: p.slot });
  });
  socket.on("ping2", (_a, cb) => ack(cb, 1));

  socket.on("disconnect", () => {
    const { room, p } = ctx(); if (!room || p.sid !== socket.id) return;
    p.conn = false; pickBotHost(room); emitLobby(room);
    p.timer = setTimeout(() => { if (!p.conn) dropPlayer(room, p); }, inMatch(room) ? GRACE_MS : 6000);
    if (!connected(room).length) room.emptyTimer = setTimeout(() => rooms.delete(room.code), 60000);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Guerra de Balões no ar na porta ${PORT}`);
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) console.log(`  No celular (mesmo Wi-Fi):  http://${i.address}:${PORT}`);
});
