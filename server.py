import json
import os
import secrets
from pathlib import Path
from typing import Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).resolve().parent
app = FastAPI(title="Balooons Multiplayer")
app.mount("/static", StaticFiles(directory=BASE), name="static")
rooms: dict[str, dict[str, Any]] = {}
clients: dict[WebSocket, dict[str, Any]] = {}

async def send(ws: WebSocket, payload: dict):
    try:
        await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except Exception:
        pass

async def reply(ws: WebSocket, msg: dict, **extra):
    data = {"requestId": msg.get("requestId"), "ok": True, **extra}
    await send(ws, data)

def room_for(code: str):
    code = code.upper()
    return rooms.setdefault(code, {"doc": None, "peers": {}, "watchers": set()})

def peer_list(code: str):
    room = rooms.get(code, {})
    return [{"peer": pid, "presence": item.get("presence", {}), "sameTab": pid == item.get("peer")} for pid, item in room.get("peers", {}).items()]

async def broadcast_peers(code: str):
    room = rooms.get(code)
    if not room: return
    peers = []
    for pid, item in room["peers"].items():
        peers.append({"peer": pid, "presence": item.get("presence", {}), "sameTab": False})
    for ws, info in list(clients.items()):
        if info.get("room") == code and ws in clients:
            own = info.get("peer")
            view = [{**p, "sameTab": p["peer"] == own} for p in peers]
            await send(ws, {"type": "peers", "peers": view})
            await send(ws, {"type": "presence_update", "peers": view})

async def broadcast_doc(code: str):
    room = rooms.get(code)
    if not room or room.get("doc") is None: return
    for ws, info in list(clients.items()):
        if info.get("room") == code or code in info.get("watched_docs", set()):
            await send(ws, {"type": "doc", "code": code, "doc": room["doc"]})

async def broadcast_rooms():
    open_rooms = [r["doc"] for r in rooms.values() if r.get("doc") and r["doc"].get("status") == "aberta"]
    for ws, info in list(clients.items()):
        if info.get("watch_rooms"):
            await send(ws, {"type": "rooms", "rooms": open_rooms[:15]})

@app.get("/")
async def home():
    return FileResponse(BASE / "index.html")

@app.get("/health")
async def health():
    return {"status": "ok", "rooms": len(rooms)}

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients[ws] = {"room": None, "peer": None, "watched_docs": set(), "watch_rooms": False}
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            typ = msg.get("type")
            code = str(msg.get("code", "")).upper()
            info = clients[ws]
            if typ == "join":
                code = code[:4]
                if len(code) != 4 or code not in rooms or not rooms[code].get("doc"):
                    await send(ws, {"type": "error", "message": "Sala não encontrada. Confira o código ou crie uma sala."})
                    await send(ws, {"requestId": msg.get("requestId"), "ok": False, "error": "Sala não encontrada"})
                    continue
                if info.get("room") and info["room"] in rooms:
                    rooms[info["room"]]["peers"].pop(info.get("peer"), None)
                pid = str(msg.get("peer") or secrets.token_hex(8))
                info.update(room=code, peer=pid)
                rooms[code]["peers"][pid] = {"peer": pid, "presence": {}}
                await reply(ws, msg, code=code)
                await broadcast_peers(code)
                await broadcast_doc(code)
            elif typ == "presence":
                if code not in rooms or info.get("room") != code:
                    await send(ws, {"requestId": msg.get("requestId"), "ok": False, "error": "Entre na sala primeiro"}); continue
                rooms[code]["peers"][info["peer"]]["presence"].update(msg.get("presence") or {})
                await reply(ws, msg)
                await broadcast_peers(code)
            elif typ == "emit":
                if info.get("room") != code:
                    await send(ws, {"requestId": msg.get("requestId"), "ok": False, "error": "Você não está nessa sala"}); continue
                await reply(ws, msg)
                for other, oi in list(clients.items()):
                    if oi.get("room") == code:
                        await send(other, {"type": "event", "event": msg.get("event"), "data": msg.get("data"), "peer": info.get("peer")})
            elif typ == "doc_set":
                room = room_for(code); room["doc"] = msg.get("doc") or {}
                await reply(ws, msg); await broadcast_doc(code); await broadcast_rooms()
            elif typ == "doc_update":
                room = rooms.get(code)
                if not room or room.get("doc") is None:
                    await send(ws, {"requestId": msg.get("requestId"), "ok": False, "error": "Sala não existe"}); continue
                room["doc"].update(msg.get("patch") or {})
                await reply(ws, msg); await broadcast_doc(code); await broadcast_rooms()
            elif typ == "watch_doc":
                info["watched_docs"].add(code)
                room = rooms.get(code)
                if room and room.get("doc") is not None:
                    await send(ws, {"type": "doc", "code": code, "doc": room["doc"]})
                await reply(ws, msg)
            elif typ == "list_rooms":
                info["watch_rooms"] = True
                await reply(ws, msg)
                await broadcast_rooms()
            else:
                await send(ws, {"requestId": msg.get("requestId"), "ok": False, "error": "Comando desconhecido"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await send(ws, {"type": "error", "message": f"Erro de conexão: {exc}"})
    finally:
        info = clients.pop(ws, {})
        code = info.get("room")
        if code in rooms:
            rooms[code]["peers"].pop(info.get("peer"), None)
            await broadcast_peers(code)

