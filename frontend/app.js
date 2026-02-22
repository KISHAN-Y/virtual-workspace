import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- CONFIGURATION ---
// Set to your deployed Render URL for production, e.g., 'wss://your-render-app.onrender.com/ws'
const hostname = window.location.hostname || 'localhost';
const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '', '::1', '[::1]'].includes(hostname) ||
    hostname.startsWith('192.168.') ||
    hostname.endsWith('.local') ||
    hostname.includes('::1') ||
    hostname.includes('localhost');

// Always use 'localhost' if testing locally to avoid IPv6 string binding issues with WebSockets
const resolvedHost = (hostname.includes('::') || hostname === '' || hostname === '0.0.0.0') ? 'localhost' : hostname;

const WS_URL = isLocal
    ? `ws://${resolvedHost}:8000/ws`
    : 'wss://virtual-workspace.onrender.com/ws';

// --- GLOBALS ---
let scene, camera, renderer, controls;
let socket, myUserId;
const avatars = {}; // Maps user_id to Three.js Object3D
const targetPositions = {}; // For smooth interpolation
const clock = new THREE.Clock();

// UI Elements
const connectionOverlay = document.getElementById('connection-overlay');
const usernameDisplay = document.getElementById('username-display');
const statusIndicator = document.querySelector('.status-indicator');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// Input State
const keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false
};

// Player State
const playerState = {
    x: 0, y: 1.5, z: 0,
    rotation: 0
};

const MOVE_SPEED = 10.0; // Units per second

init();
connectWebSocket();
animate();

function init() {
    // 1. Scene Setup
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07090f, 0.015);

    // 2. Camera Setup
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 15);

    // 3. Renderer Setup
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 4. Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground
    controls.minDistance = 5;
    controls.maxDistance = 50;

    // 5. Build Environment
    buildEnvironment();

    // 6. Event Listeners
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // UI Event Listeners
    sendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
}

function buildEnvironment() {
    // Grid Helper
    const grid = new THREE.GridHelper(200, 100, 0xff2a5f, 0xffffff);
    grid.material.opacity = 0.1;
    grid.material.transparent = true;
    scene.add(grid);

    // Floor Plane
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x101424,
        roughness: 0.8,
        metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);

    // Decorative floating particles
    const particleGeo = new THREE.BufferGeometry();
    const particleCount = 500;
    const posArray = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) {
        posArray[i] = (Math.random() - 0.5) * 100;
        // Keep particles above ground
        if (i % 3 === 1) posArray[i] = Math.random() * 20;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particleMat = new THREE.PointsMaterial({
        size: 0.1,
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);
}

function createAvatar(colorHex, name) {
    const group = new THREE.Group();

    // Glowing Core
    const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 16);
    const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.8
    });
    const body = new THREE.Mesh(geometry, material);
    body.position.y = 1.5;

    // Halo / Ring
    const ringGeo = new THREE.TorusGeometry(0.8, 0.05, 16, 100);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;

    // Name Tag Sprite (simplified using HTML overlays or Canvas textures, using a basic glowing point light here due to complexity of text geometries)
    const light = new THREE.PointLight(new THREE.Color(colorHex), 2, 5);
    light.position.y = 1.5;

    group.add(body);
    group.add(ring);
    group.add(light);

    // Create a floating animation effect data
    group.userData = {
        baseY: 1.5,
        timeOffset: Math.random() * Math.PI * 2
    };

    return group;
}

// --- WEBSOCKET LOGIC ---
function connectWebSocket() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log("Connected to server");
        connectionOverlay.classList.remove('fade-in');
        connectionOverlay.classList.add('hidden');
        statusIndicator.classList.add('online');
    };

    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
    };

    socket.onclose = () => {
        console.log("Disconnected");
        statusIndicator.classList.remove('online');
        usernameDisplay.textContent = "Disconnected - Retrying...";
        // Try to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (err) => {
        console.error("WebSocket Error:", err);
    }
}

function handleServerMessage(msg) {
    switch (msg.type) {
        case 'init':
            myUserId = msg.user_id;
            // Spawn existing users
            for (const [id, data] of Object.entries(msg.state)) {
                spawnUser(id, data);
            }
            usernameDisplay.textContent = msg.state[myUserId].name;
            addChatMessage('System', 'Connected to spatial network.', 'sys');
            break;

        case 'user_joined':
            if (msg.user_id !== myUserId) {
                spawnUser(msg.user_id, msg.data);
                addChatMessage('System', `${msg.data.name} joined the space.`, 'sys');
            }
            break;

        case 'user_moved':
            if (msg.user_id !== myUserId && avatars[msg.user_id]) {
                targetPositions[msg.user_id] = {
                    x: msg.x,
                    z: msg.z,
                    rotation: msg.rotation
                };
            }
            break;

        case 'user_left':
            if (avatars[msg.user_id]) {
                scene.remove(avatars[msg.user_id]);
                delete avatars[msg.user_id];
                delete targetPositions[msg.user_id];
            }
            break;

        case 'chat_message':
            const isMe = msg.user_id === myUserId;
            // Get sender name (might need to fetch from state, but for simplicity we rely on broadcast or default)
            const senderName = avatars[msg.user_id] ? avatars[msg.user_id].userData.name : `User-${msg.user_id.substring(0, 4)}`;
            addChatMessage(senderName, msg.text, isMe ? 'self' : 'other');
            break;
    }
}

function spawnUser(id, data) {
    if (avatars[id]) return; // Already exists

    const avatar = createAvatar(data.color, data.name);
    avatar.position.set(data.x, 0, data.z);
    avatar.rotation.y = data.rotation;
    avatar.userData.name = data.name;

    scene.add(avatar);
    avatars[id] = avatar;
    targetPositions[id] = { x: data.x, z: data.z, rotation: data.rotation };

    if (id === myUserId) {
        // Sync my position
        playerState.x = data.x;
        playerState.z = data.z;

        // Link camera to player
        controls.target = avatar.position;
    }
}

function sendMyMovement() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !myUserId) return;

    socket.send(JSON.stringify({
        type: 'move',
        x: playerState.x,
        y: playerState.y,
        z: playerState.z,
        rotation: playerState.rotation
    }));
}

// --- INPUT & MOVEMENT ---
function onKeyDown(e) {
    if (document.activeElement === chatInput) return; // Don't move while typing
    if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
    if (keys.hasOwnProperty(e.code)) keys[e.code] = true;
}

function onKeyUp(e) {
    if (keys.hasOwnProperty(e.key)) keys[e.key] = false;
    if (keys.hasOwnProperty(e.code)) keys[e.code] = false;
}

function updateMovement(delta) {
    if (!avatars[myUserId]) return;

    let moved = false;
    const direction = new THREE.Vector3();

    // Get camera orientation for relative movement
    const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    if (keys.w || keys.ArrowUp) { direction.add(forward); }
    if (keys.s || keys.ArrowDown) { direction.sub(forward); }
    if (keys.a || keys.ArrowLeft) { direction.sub(right); }
    if (keys.d || keys.ArrowRight) { direction.add(right); }

    if (direction.lengthSq() > 0) {
        direction.normalize();
        playerState.x += direction.x * MOVE_SPEED * delta;
        playerState.z += direction.z * MOVE_SPEED * delta;

        // Calculate rotation based on movement direction
        playerState.rotation = Math.atan2(direction.x, direction.z);
        moved = true;
    }

    if (moved) {
        // Update my avatar instantly
        const me = avatars[myUserId];
        me.position.x = playerState.x;
        me.position.z = playerState.z;

        // Smooth rotation
        me.rotation.y = THREE.MathUtils.lerp(me.rotation.y, playerState.rotation, 0.1);

        // Move camera with player
        controls.target.copy(me.position);

        // Throttle WebSocket updates (simplified here, sending every frame is ok for a small demo)
        // In reality, you'd send at fixed tick rate
        sendMyMovement();
    }
}

// --- CHAT ---
function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
        type: 'chat',
        text: text
    }));

    chatInput.value = '';
}

function addChatMessage(sender, text, type) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${type}`;

    if (type !== 'sys') {
        const senderEl = document.createElement('span');
        senderEl.className = 'sender';
        senderEl.textContent = sender;
        msgEl.appendChild(senderEl);
    }

    const textEl = document.createElement('span');
    textEl.textContent = text;
    msgEl.appendChild(textEl);

    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll
}

// --- RENDERING ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    controls.update();
    updateMovement(delta);

    // Interpolate other players & animate avatars
    for (const [id, avatar] of Object.entries(avatars)) {
        // Bobbing animation
        avatar.children[0].position.y = avatar.userData.baseY + Math.sin(time * 2 + avatar.userData.timeOffset) * 0.2;

        // Rotate ring
        avatar.children[1].rotation.z += delta * 2;

        if (id !== myUserId && targetPositions[id]) {
            const target = targetPositions[id];
            // Linear interpolation for smooth movement
            avatar.position.x = THREE.MathUtils.lerp(avatar.position.x, target.x, delta * 10);
            avatar.position.z = THREE.MathUtils.lerp(avatar.position.z, target.z, delta * 10);

            // Shortest path rotation interpolation
            let rotDiff = target.rotation - avatar.rotation.y;
            rotDiff = (rotDiff + Math.PI) % (Math.PI * 2) - Math.PI;
            avatar.rotation.y += rotDiff * delta * 10;
        }
    }

    renderer.render(scene, camera);
}
