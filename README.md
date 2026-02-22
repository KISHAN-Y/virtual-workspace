# MetaSpace - Virtual Workspace Platform

A fully functional, real-time 2D/3D virtual workspace designed for remote teams with a premium, Synthwave/glassmorphism aesthetic.

## Tech Stack
- **Backend**: Python, FastAPI, WebSockets (`backend/`)
- **Frontend**: Vanilla JS, WebGL via Three.js, CSS3 Variables (`frontend/`)

---

## 🚀 Step-by-Step Deployment Guide

We will deploy the Backend to **Render** (free tier supports WebSockets) and the Frontend to **Netlify**.

### 1. Push to GitHub
1. Create a new GitHub repository named `virtual-workspace`.
2. Commit and push both `backend` and `frontend` folders to this repository.

### 2. Deploy Backend on Render
1. Go to [Render](https://render.com/) and sign in.
2. Click **New +** -> **Web Service**.
3. Choose **Build and deploy from a Git repository**.
4. Connect your `virtual-workspace` repository.
5. In the service settings:
   - **Name**: `metaspace-backend`
   - **Root Directory**: `backend` (Important!)
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt` (This is already preset in `render.yaml`)
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Click **Create Web Service**.
7. Once deployed, copy your Render URL (e.g., `metaspace-backend.onrender.com`).

### 3. Link Frontend to Backend
1. Open `frontend/app.js` locally.
2. Find the configuration on line 5:
   ```javascript
   const WS_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
       ? 'ws://localhost:8000/ws' 
       : 'wss://YOUR-RENDER-URL.onrender.com/ws'; // <-- UPDATE THIS
   ```
3. Replace `YOUR-RENDER-URL.onrender.com` with the actual URL you got from Render step 7. Make sure it starts with `wss://`.
4. Commit and push this change to GitHub.

### 4. Deploy Frontend on Netlify
1. Go to [Netlify](https://www.netlify.com/) and sign in.
2. Click **Add new site** -> **Import an existing project**.
3. Connect your GitHub and select the `virtual-workspace` repository.
4. In the build settings:
   - **Base directory**: `frontend`
   - **Build command**: *(Leave blank)*
   - **Publish directory**: `frontend` (or just leave it default if Netlify auto-detects)
5. Click **Deploy site**.
6. Netlify will instantly deploy the frontend. Click your Netlify generic URL to access MetaSpace!

---

## 💻 Local Development

1. **Start Backend**:
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn main:app --reload
   ```

2. **Start Frontend**:
   ```bash
   cd frontend
   npx serve
   # OR
   python3 -m http.server 3000
   ```
   Then open `http://localhost:3000` in multiple browser tabs to test multiplayer!

---
*Powered by Three.js & FastAPI WebSockets.*
