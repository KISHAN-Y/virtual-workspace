import uuid
from typing import Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json

app = FastAPI(title="Virtual Workspace API")

# Allow CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ConnectionManager:
    def __init__(self):
        # Maps websocket objects to user_ids
        self.active_connections: Dict[WebSocket, str] = {}
        # Stores global state (positions, rotations, colors, names)
        # { user_id: { x, y, z, rotation, color, name } }
        self.users_state: Dict[str, Any] = {}

    async def connect(self, websocket: WebSocket) -> str:
        await websocket.accept()
        user_id = str(uuid.uuid4())
        self.active_connections[websocket] = user_id
        # Initialize default state
        self.users_state[user_id] = {
            "x": 0, "y": 1, "z": 0,
            "rotation": 0,
            "color": "#0d6efd",
            "name": f"Avatar-{user_id[:4]}"
        }
        return user_id

    def disconnect(self, websocket: WebSocket):
        user_id = self.active_connections.get(websocket)
        if user_id:
            del self.active_connections[websocket]
            if user_id in self.users_state:
                del self.users_state[user_id]
        return user_id

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                pass

manager = ConnectionManager()

@app.get("/")
def read_root():
    return {"message": "Virtual Workspace Backend is running!"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    user_id = await manager.connect(websocket)
    
    # Send the user their ID and the current state of everyone
    await websocket.send_text(json.dumps({
        "type": "init",
        "user_id": user_id,
        "state": manager.users_state
    }))

    # Broadcast that a new user joined
    await manager.broadcast(json.dumps({
        "type": "user_joined",
        "user_id": user_id,
        "data": manager.users_state[user_id]
    }))

    try:
        while True:
            data = await websocket.receive_text()
            parsed = json.loads(data)

            if parsed["type"] == "move":
                # Update user state
                manager.users_state[user_id].update({
                    "x": parsed["x"],
                    "y": parsed["y"],
                    "z": parsed["z"],
                    "rotation": parsed["rotation"]
                })
                
                # Broadcast movement
                await manager.broadcast(json.dumps({
                    "type": "user_moved",
                    "user_id": user_id,
                    "x": parsed["x"],
                    "y": parsed["y"],
                    "z": parsed["z"],
                    "rotation": parsed["rotation"]
                }))

            elif parsed["type"] == "update_profile":
                if "name" in parsed:
                    manager.users_state[user_id]["name"] = parsed["name"]
                if "color" in parsed:
                    manager.users_state[user_id]["color"] = parsed["color"]
                
                await manager.broadcast(json.dumps({
                    "type": "profile_updated",
                    "user_id": user_id,
                    "name": manager.users_state[user_id]["name"],
                    "color": manager.users_state[user_id]["color"]
                }))
                
            elif parsed["type"] == "chat":
                # Broadcast chat message with spatial context if needed
                await manager.broadcast(json.dumps({
                    "type": "chat_message",
                    "user_id": user_id,
                    "text": parsed["text"]
                }))

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(json.dumps({
            "type": "user_left",
            "user_id": user_id
        }))
