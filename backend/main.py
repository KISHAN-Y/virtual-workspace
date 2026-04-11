import uuid
import os
import random
from typing import Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
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

# Ensure uploads directory exists
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files for uploaded content
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Max file size: 5MB
MAX_FILE_SIZE = 5 * 1024 * 1024

# Gender-specific default colors
GENDER_COLORS = {
    "male": ["#2563eb", "#0891b2", "#059669", "#4f46e5", "#7c3aed"],
    "female": ["#e11d48", "#db2777", "#c026d3", "#f59e0b", "#ec4899"]
}


class ConnectionManager:
    def __init__(self):
        # Maps websocket objects to user_ids
        self.active_connections: Dict[WebSocket, str] = {}
        # Stores global state (positions, rotations, colors, names, gender)
        # { user_id: { x, y, z, rotation, color, name, gender } }
        self.users_state: Dict[str, Any] = {}

    async def connect(self, websocket: WebSocket) -> str:
        await websocket.accept()
        user_id = str(uuid.uuid4())
        self.active_connections[websocket] = user_id

        # Randomly assign gender
        gender = random.choice(["male", "female"])
        color = random.choice(GENDER_COLORS[gender])

        # Initialize default state
        self.users_state[user_id] = {
            "x": random.uniform(-5, 5),
            "y": 1,
            "z": random.uniform(-5, 5),
            "rotation": 0,
            "color": color,
            "name": f"Avatar-{user_id[:4]}",
            "gender": gender
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


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Handle file upload, save to uploads dir, return URL."""
    # Read file content
    content = await file.read()

    # Check file size
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Max 5MB.")

    # Generate unique filename to avoid collisions
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    unique_name = f"{uuid.uuid4().hex[:12]}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)

    # Write file
    with open(file_path, "wb") as f:
        f.write(content)

    # Determine file type category
    content_type = file.content_type or ""
    if content_type.startswith("image/"):
        file_category = "image"
    elif content_type.startswith("video/"):
        file_category = "video"
    else:
        file_category = "document"

    return JSONResponse({
        "success": True,
        "data": {
            "filename": file.filename,
            "stored_name": unique_name,
            "file_url": f"/uploads/{unique_name}",
            "file_type": file_category,
            "size": len(content)
        }
    })


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
                if "gender" in parsed:
                    manager.users_state[user_id]["gender"] = parsed["gender"]
                
                await manager.broadcast(json.dumps({
                    "type": "profile_updated",
                    "user_id": user_id,
                    "name": manager.users_state[user_id]["name"],
                    "color": manager.users_state[user_id]["color"],
                    "gender": manager.users_state[user_id]["gender"]
                }))
                
            elif parsed["type"] == "chat":
                # Broadcast chat message with spatial context if needed
                await manager.broadcast(json.dumps({
                    "type": "chat_message",
                    "user_id": user_id,
                    "text": parsed["text"]
                }))

            elif parsed["type"] == "file":
                # Broadcast file share message
                await manager.broadcast(json.dumps({
                    "type": "file_message",
                    "user_id": user_id,
                    "filename": parsed["filename"],
                    "file_url": parsed["file_url"],
                    "file_type": parsed["file_type"]
                }))

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(json.dumps({
            "type": "user_left",
            "user_id": user_id
        }))
