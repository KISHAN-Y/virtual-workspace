import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- CONFIGURATION ---
const hostname = window.location.hostname || 'localhost';
const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '', '::1', '[::1]'].includes(hostname) ||
    hostname.startsWith('192.168.') ||
    hostname.endsWith('.local') ||
    hostname.includes('::1') ||
    hostname.includes('localhost');

const resolvedHost = (hostname.includes('::') || hostname === '' || hostname === '0.0.0.0') ? 'localhost' : hostname;

const WS_URL = isLocal
    ? `ws://${resolvedHost}:8000/ws`
    : 'wss://virtual-workspace.onrender.com/ws';

const API_BASE = isLocal
    ? `http://${resolvedHost}:8000`
    : 'https://virtual-workspace.onrender.com';

// --- GLOBALS ---
let scene, camera, renderer, controls;
let sunLight, hemiLight, ambientLight;
const terrainHeights = new Map();
const interactables = [];
const inventory = { wood: 0, hasAxe: false };
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let socket, myUserId;
const avatars = {}; // Maps user_id to Three.js Object3D
const avatarMeta = {}; // Stores metadata (gender, isMoving, etc)
const goats = []; // For NPC movement
const targetPositions = {}; // For smooth interpolation
const clock = new THREE.Clock();

// UI Elements
const connectionOverlay = document.getElementById('connection-overlay');
const drawerUsername = document.getElementById('drawer-username');
const statusIndicator = document.getElementById('drawer-status');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const fileUploadBtn = document.getElementById('file-upload-btn');
const fileInput = document.getElementById('file-input');
const uploadProgress = document.getElementById('upload-progress');

const qtyAxe = document.getElementById('qty-axe');
const qtyWood = document.getElementById('qty-wood');
const slotAxe = document.getElementById('slot-axe');
const slotWood = document.getElementById('slot-wood');

// Hamburger & Drawer
const hamburgerBtn = document.getElementById('hamburger-btn');
const navDrawer = document.getElementById('nav-drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const closeDrawerBtn = document.getElementById('close-drawer-btn');

// Chat Collapse
const chatPanel = document.getElementById('chat-panel');
const chatCollapseBtn = document.getElementById('chat-collapse-btn');
const chatHeaderToggle = document.getElementById('chat-header-toggle');

// Profile UI Elements
const editProfileBtn = document.getElementById('edit-profile-btn');
const profileModal = document.getElementById('profile-modal');
const closeProfileBtn = document.getElementById('close-profile-btn');
const profileNameInput = document.getElementById('profile-name');
const genderCards = document.querySelectorAll('.radio-card');
const colorSwatches = document.querySelectorAll('.color-swatch');
const saveProfileBtn = document.getElementById('save-profile-btn');

// Initial Setup Elements
const loaderContent = document.getElementById('loader-content');
const initialSetupContent = document.getElementById('initial-setup-content');
const setupNameInput = document.getElementById('setup-name');
const setupGenderCards = document.querySelectorAll('#setup-gender-selector .radio-card');
const joinWorkspaceBtn = document.getElementById('join-workspace-btn');

// Input State
const keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false,
    ' ': false // Space for jump
};

// Player State
const playerState = {
    x: 0, y: -0.76, z: 0,
    vy: 0,
    rotation: 0,
    isMoving: false,
    isJumping: false
};

const MOVE_SPEED = 10.0;

init();
connectWebSocket();
animate();

function init() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Realistic sky blue
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.012); // Fog matches sky color

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 15);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 50;

    buildEnvironment();

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    
    // Minecraft Interaction
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

    // UI Event Listeners
    sendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // File upload listeners
    fileUploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // Profile Settings listeners
    initProfileModal();
    initSetupScreen();
}

function buildEnvironment() {
    createMinecraftTerrain();

    // Lighting
    ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.left = -50;
    sunLight.shadow.camera.right = 50;
    sunLight.shadow.camera.top = 50;
    sunLight.shadow.camera.bottom = -50;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 150;
    scene.add(sunLight);

    hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(hemiLight);

    // Decorative floating particles
    const particleGeo = new THREE.BufferGeometry();
    const particleCount = 500;
    const posArray = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) {
        posArray[i] = (Math.random() - 0.5) * 100;
        if (i % 3 === 1) posArray[i] = Math.random() * 20;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particleMat = new THREE.PointsMaterial({
        size: 0.08,
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.NormalBlending
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);
}

function createMinecraftTerrain() {
    const size = 60; // 60x60 grid
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    
    // Create simple block texture (canvas)
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    
    // Top - grass
    ctx.fillStyle = '#5b8a3c';
    ctx.fillRect(0, 0, 16, 16);
    for(let i=0; i<50; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#4b7331' : '#689d44';
        ctx.fillRect(Math.floor(Math.random()*16), Math.floor(Math.random()*16), 1, 1);
    }
    const grassTex = new THREE.CanvasTexture(canvas);
    grassTex.magFilter = THREE.NearestFilter;

    // Side - dirt with grass top
    const sideCanvas = document.createElement('canvas');
    sideCanvas.width = 16; sideCanvas.height = 16;
    const sCtx = sideCanvas.getContext('2d');
    sCtx.fillStyle = '#654b32'; // dirt
    sCtx.fillRect(0,0,16,16);
    for(let i=0; i<80; i++) {
        sCtx.fillStyle = Math.random() > 0.5 ? '#553f2a' : '#75573a';
        sCtx.fillRect(Math.floor(Math.random()*16), Math.floor(Math.random()*16), 1, 1);
    }
    sCtx.fillStyle = '#5b8a3c';
    sCtx.fillRect(0,0,16,4); // grass overlap
    for(let x=0; x<16; x++) {
        if(Math.random() > 0.5) sCtx.fillRect(x,4,1,1 + Math.random()*2);
    }
    const sideTex = new THREE.CanvasTexture(sideCanvas);
    sideTex.magFilter = THREE.NearestFilter;

    // Bottom - dirt
    const dirtCanvas = document.createElement('canvas');
    dirtCanvas.width = 16; dirtCanvas.height = 16;
    const dCtx = dirtCanvas.getContext('2d');
    dCtx.drawImage(sideCanvas, 0, 0); 
    dCtx.fillStyle = '#654b32'; dCtx.fillRect(0,0,16,16);
    const dirtTex = new THREE.CanvasTexture(dirtCanvas);
    dirtTex.magFilter = THREE.NearestFilter;

    const materials = [
        new THREE.MeshStandardMaterial({map: sideTex}), // right
        new THREE.MeshStandardMaterial({map: sideTex}), // left
        new THREE.MeshStandardMaterial({map: grassTex}), // top
        new THREE.MeshStandardMaterial({map: dirtTex}), // bottom
        new THREE.MeshStandardMaterial({map: sideTex}), // front
        new THREE.MeshStandardMaterial({map: sideTex}), // back
    ];

    const instancedMesh = new THREE.InstancedMesh(geometry, materials, size * size);
    instancedMesh.receiveShadow = true;
    instancedMesh.castShadow = true;

    let idx = 0;
    const dummy = new THREE.Object3D();
    
    for(let x = -size/2; x < size/2; x++) {
        for(let z = -size/2; z < size/2; z++) {
            // Simple terrain height
            let y = Math.floor(Math.sin(x/8) * 2 + Math.cos(z/6) * 1.5);
            if (Math.abs(x) < 5 && Math.abs(z) < 5) y = 0; // Flat spawn area

            dummy.position.set(x, y - 0.5, z); // Top of block is exactly at y
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(idx++, dummy.matrix);
            terrainHeights.set(`${x},${z}`, y);
        }
    }
    scene.add(instancedMesh);

    // Generate Nature Elements (Trees, grass, goats, axes) using the terrain heights
    const treeGeo = new THREE.BoxGeometry(0.8, 4, 0.8);
    const treeMat = new THREE.MeshStandardMaterial({color: 0x4f3621});
    const leafGeo = new THREE.BoxGeometry(3.5, 3, 3.5);
    const leafMat = new THREE.MeshStandardMaterial({color: 0x2e6616});
    const brushGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);

    for(let x = -size/2; x < size/2; x++) {
        for(let z = -size/2; z < size/2; z++) {
            let y = terrainHeights.get(`${x},${z}`);
            if (Math.abs(x) < 7 && Math.abs(z) < 7) continue;

            const r = Math.random();
            if (r < 0.04) { // 4% chance for Tall Grass
                const matchMat = new THREE.MeshStandardMaterial({ color: Math.random() > 0.5 ? 0x4b7331 : 0x689d44 });
                const grass = new THREE.Mesh(brushGeo, matchMat);
                grass.scale.set(0.6, 1 + Math.random() * 0.8, 0.6);
                grass.position.set(x, y + (grass.scale.y * 0.25), z); 
                grass.rotation.y = Math.random() * Math.PI;
                grass.castShadow = true;
                scene.add(grass);
            }
            else if (r < 0.044) { // Small chance for a Goat instance
                const goat = createMinecraftGoat(x, y, z, Math.random() * Math.PI * 2);
                scene.add(goat);
                goats.push(goat);
            }
            else if (r < 0.046) { // Small chance for an Axe in a stump
                const stump = createMinecraftAxeStump(x, y, z);
                stump.userData = { type: 'axe_stump' };
                scene.add(stump);
                interactables.push(stump);
            }
        }
    }

    // Generate exactly 10 Trees randomly across the terrain
    let treesPlaced = 0;
    while (treesPlaced < 10) {
        let x = Math.floor((Math.random() - 0.5) * size);
        let z = Math.floor((Math.random() - 0.5) * size);
        
        // Prevent trees too close to spawn
        if (Math.abs(x) < 7 && Math.abs(z) < 7) continue;

        let y = terrainHeights.get(`${x},${z}`);
        if (y === undefined) continue;

        const treeGroup = new THREE.Group();
        treeGroup.userData = { type: 'tree' };
        
        const trunk = new THREE.Mesh(treeGeo, treeMat);
        trunk.position.y = 2;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        treeGroup.add(trunk);
        
        const leaves = new THREE.Mesh(leafGeo, leafMat);
        leaves.position.y = 4.5;
        leaves.castShadow = true;
        treeGroup.add(leaves);
        
        const leavesTop = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), leafMat);
        leavesTop.position.y = 6;
        leavesTop.castShadow = true;
        treeGroup.add(leavesTop);

        treeGroup.position.set(x, y, z);
        scene.add(treeGroup);
        interactables.push(treeGroup);
        treesPlaced++;
    }
}

function createMinecraftGoat(x, y, z, rot) {
    const goat = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({color: 0xeeeeee, roughness: 0.9});
    const hornMat = new THREE.MeshStandardMaterial({color: 0xddccaa});
    const hoofMat = new THREE.MeshStandardMaterial({color: 0x333333});

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.0), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    goat.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), bodyMat);
    head.position.set(0, 0.85, 0.6);
    head.castShadow = true;
    goat.add(head);

    // Horns
    const hornGeo = new THREE.BoxGeometry(0.08, 0.4, 0.08);
    const horn1 = new THREE.Mesh(hornGeo, hornMat);
    horn1.position.set(0.12, 1.15, 0.6);
    const horn2 = new THREE.Mesh(hornGeo, hornMat);
    horn2.position.set(-0.12, 1.15, 0.6);
    goat.add(horn1);
    goat.add(horn2);

    // 4 Legs
    const legGeo = new THREE.BoxGeometry(0.15, 0.4, 0.15);
    for(let lx of [-0.2, 0.2]) {
        for(let lz of [-0.3, 0.3]) {
            let leg = new THREE.Mesh(legGeo, bodyMat);
            leg.position.set(lx, 0.2, lz);
            leg.castShadow = true;
            // tiny hoof
            let hoof = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), hoofMat);
            hoof.position.set(lx, 0.05, lz);
            goat.add(leg);
            goat.add(hoof);
        }
    }

    goat.position.set(x, y, z);
    goat.rotation.y = rot;

    // Movement state
    goat.userData = {
        type: 'goat',
        state: 'idle',
        stateTime: 2 + Math.random() * 4,
        targetRot: rot,
        vx: 0,
        vz: 0,
        vy: 0,
        moveSpeed: 1.2 + Math.random() * 0.8,
        isJumping: false
    };

    return goat;
}

function createMinecraftAxeStump(x, y, z) {
    const group = new THREE.Group();
    
    const stumpMat = new THREE.MeshStandardMaterial({color: 0x4f3621, roughness: 0.9});
    const stump = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), stumpMat);
    stump.position.y = 0.25;
    stump.castShadow = true;
    group.add(stump);

    const axe = createAxeMesh();
    axe.position.set(0.1, 0.6, 0);
    axe.rotation.z = Math.PI / 6;
    group.add(axe);

    group.position.set(x, y, z);
    return group;
}

function createAxeMesh() {
    const axeGroup = new THREE.Group();
    axeGroup.name = "axe";
    
    const woodMat = new THREE.MeshStandardMaterial({color: 0x8b5a2b, roughness: 0.9});
    const ironMat = new THREE.MeshStandardMaterial({color: 0xaaaaaa, metalness: 0.6, roughness: 0.4});
    
    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), woodMat);
    handle.castShadow = true;
    axeGroup.add(handle);

    // Axe Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.08), ironMat);
    head.position.set(0.18, 0.25, 0);
    head.castShadow = true;
    axeGroup.add(head);
    
    return axeGroup;
}



// =============================================
//  HUMAN-LIKE AVATAR BUILDER
// =============================================

/**
 * Skin-tone material helper — creates a smooth skin material
 */
function createSkinMaterial(colorHex) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.6,
        metalness: 0.05
    });
}

/**
 * Creates the avatar's clothing/body material with the user's accent color
 */
function createClothingMaterial(colorHex) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.4,
        metalness: 0.1,
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: 0.15
    });
}

/**
 * Skin tone palette
 */
const SKIN_TONES = ['#f5d0a9', '#e8b88a', '#d4956b', '#c47a53', '#8d5524', '#6b3e26'];

/**
 * Hair color palette
 */
const HAIR_COLORS = ['#1a1a1a', '#3b2314', '#8b4513', '#d2691e', '#f5deb3', '#b22222', '#4a0e4e'];

/**
 * Creates a Minecraft-style pixel face texture on a canvas
 * @param {string} skinColor - skin hex color
 * @param {string} hairColor - hair hex color
 * @param {string} accentColor - eye/accent color
 * @param {boolean} isMale - gender flag
 * @returns {THREE.CanvasTexture[]} array of 6 face textures [right, left, top, bottom, front, back]
 */
function createMinecraftHeadTextures(skinColor, hairColor, accentColor, isMale) {
    const size = 64; // 8x8 pixel grid scaled up
    const px = size / 8; // pixel size

    // Color config per gender
    const femaleEyeColor = '#2e8b57'; // Deep green like reference
    const steveEyeColor = '#4444aa'; // Steve's blue-purple eyes
    const eyeColor = isMale ? steveEyeColor : femaleEyeColor;
    const hairHighlight = isMale ? '#4a2a0a' : '#6b4423';
    const hairDark = isMale ? '#1a0a00' : '#2a1506';

    // ---- FRONT FACE ----
    const frontCanvas = document.createElement('canvas');
    frontCanvas.width = size;
    frontCanvas.height = size;
    const fCtx = frontCanvas.getContext('2d');

    // Fill with skin
    fCtx.fillStyle = skinColor;
    fCtx.fillRect(0, 0, size, size);

    fCtx.fillStyle = hairColor;
    if (isMale) {
        // STEVE HAIR — top row + front bangs hanging down
        // Full hair top (rows 0-1)
        fCtx.fillRect(0, 0, size, px * 1.5);
        // Front bangs — Steve's iconic fringe (hangs to row 2-3 on forehead)
        fCtx.fillRect(px * 0, px * 1.5, px * 2, px * 2); // Left bang block
        fCtx.fillRect(px * 6, px * 1.5, px * 2, px * 2); // Right bang block
        fCtx.fillRect(px * 0, px * 1.5, px * 1, px * 2.5); // Far left sideburn
        fCtx.fillRect(px * 7, px * 1.5, px * 1, px * 2.5); // Far right sideburn
        // Lighter brown accent on bangs
        fCtx.fillStyle = hairHighlight;
        fCtx.fillRect(px * 1, px * 1.5, px, px * 1);
        fCtx.fillRect(px * 6, px * 1.5, px, px * 1);
    } else {
        // Female: full thick hair top (rows 0-2)
        fCtx.fillRect(0, 0, size, px * 2.5);
        fCtx.fillRect(0, 0, px * 1.5, size);
        fCtx.fillRect(size - px * 1.5, 0, px * 1.5, size);
        fCtx.fillStyle = '#6b4423';
        fCtx.fillRect(px * 0.5, px * 3, px * 0.5, px * 4);
        fCtx.fillRect(size - px, px * 2.5, px * 0.5, px * 4);
        fCtx.fillStyle = '#2a1506';
        fCtx.fillRect(0, px * 5, px, px * 2);
        fCtx.fillRect(size - px * 0.5, px * 4, px * 0.5, px * 3);
    }

    // Eyes
    // White part
    fCtx.fillStyle = '#ffffff';
    fCtx.fillRect(px * 2, px * 3, px * 1.5, px);
    fCtx.fillRect(px * 4.5, px * 3, px * 1.5, px);

    // Iris
    fCtx.fillStyle = eyeColor;
    fCtx.fillRect(px * 2, px * 3, px, px);
    fCtx.fillRect(px * 5.5, px * 3, px, px);

    if (isMale) {
        // Steve's distinct pupil placement (left-biased iris)
        fCtx.fillStyle = '#1a1a5c';
        fCtx.fillRect(px * 2, px * 3 + px * 0.15, px * 0.6, px * 0.7);
        fCtx.fillRect(px * 5.5, px * 3 + px * 0.15, px * 0.6, px * 0.7);
    } else {
        // Female pupil
        fCtx.fillStyle = '#000000';
        fCtx.fillRect(px * 2.5 + px * 0.3, px * 3 + px * 0.2, px * 0.4, px * 0.6);
        fCtx.fillRect(px * 5 + px * 0.3, px * 3 + px * 0.2, px * 0.4, px * 0.6);
        // Feminine thin brow
        fCtx.fillStyle = '#2a1506';
        fCtx.fillRect(px * 2, px * 2.5, px * 1.5, px * 0.3);
        fCtx.fillRect(px * 4.5, px * 2.5, px * 1.5, px * 0.3);
    }

    // Nose — Steve has a wider nose bridge
    if (isMale) {
        fCtx.fillStyle = '#b8835f';
        fCtx.fillRect(px * 3.5, px * 4, px, px);
        // Slight shadow under nose
        fCtx.fillStyle = '#a07050';
        fCtx.fillRect(px * 3, px * 4.5, px * 2, px * 0.3);
    } else {
        fCtx.fillStyle = '#d4a078';
        fCtx.fillRect(px * 3.5, px * 4, px, px * 0.5);
    }

    // Mouth
    if (isMale) {
        // Steve's signature crooked smile
        fCtx.fillStyle = '#6b3520';
        fCtx.fillRect(px * 2.5, px * 5.5, px * 3, px * 0.6);
        // Lip highlight
        fCtx.fillStyle = '#8B5030';
        fCtx.fillRect(px * 3, px * 5.5, px * 2, px * 0.3);
    } else {
        fCtx.fillStyle = '#cc7777';
        fCtx.fillRect(px * 3.25, px * 5, px * 1.5, px * 0.5);
    }

    const frontTex = new THREE.CanvasTexture(frontCanvas);
    frontTex.magFilter = THREE.NearestFilter;
    frontTex.minFilter = THREE.NearestFilter;

    // ---- BACK FACE — hair ----
    const backCanvas = document.createElement('canvas');
    backCanvas.width = size;
    backCanvas.height = size;
    const bCtx = backCanvas.getContext('2d');
    bCtx.fillStyle = hairColor;
    bCtx.fillRect(0, 0, size, size);
    // Hair texture streaks
    bCtx.fillStyle = hairHighlight;
    bCtx.fillRect(px * 1, px * 1, px * 0.5, size);
    bCtx.fillRect(px * 3, px * 2, px * 0.5, size);
    bCtx.fillRect(px * 5.5, px * 1, px * 0.5, size);
    bCtx.fillRect(px * 7, px * 3, px * 0.5, size);
    // Dark accents
    bCtx.fillStyle = hairDark;
    bCtx.fillRect(px * 2, px * 2, px * 0.5, size);
    bCtx.fillRect(px * 4.5, px * 0, px * 0.5, size);
    bCtx.fillRect(px * 6, px * 2, px * 0.5, size);

    const backTex = new THREE.CanvasTexture(backCanvas);
    backTex.magFilter = THREE.NearestFilter;
    backTex.minFilter = THREE.NearestFilter;

    // ---- TOP FACE — hair top ----
    const topCanvas = document.createElement('canvas');
    topCanvas.width = size;
    topCanvas.height = size;
    const tCtx = topCanvas.getContext('2d');
    tCtx.fillStyle = hairColor;
    tCtx.fillRect(0, 0, size, size);
    // Checkerboard-ish texture for Minecraft hair-top look
    tCtx.fillStyle = hairHighlight;
    tCtx.fillRect(px * 1, px * 1, px, px);
    tCtx.fillRect(px * 3, px * 0, px, px);
    tCtx.fillRect(px * 5, px * 2, px, px);
    tCtx.fillRect(px * 0, px * 4, px, px);
    tCtx.fillRect(px * 6, px * 5, px, px);
    tCtx.fillRect(px * 2, px * 6, px, px);
    tCtx.fillStyle = hairDark;
    tCtx.fillRect(px * 4, px * 3, px, px);
    tCtx.fillRect(px * 7, px * 1, px, px);
    tCtx.fillRect(px * 1, px * 5, px, px);

    const topTex = new THREE.CanvasTexture(topCanvas);
    topTex.magFilter = THREE.NearestFilter;
    topTex.minFilter = THREE.NearestFilter;

    // ---- BOTTOM FACE — chin/skin ----
    const bottomCanvas = document.createElement('canvas');
    bottomCanvas.width = size;
    bottomCanvas.height = size;
    const boCtx = bottomCanvas.getContext('2d');
    boCtx.fillStyle = skinColor;
    boCtx.fillRect(0, 0, size, size);
    if (!isMale) {
        // Hair visible on the edges under chin
        boCtx.fillStyle = hairColor;
        boCtx.fillRect(0, 0, px * 1.5, size);
        boCtx.fillRect(size - px * 1.5, 0, px * 1.5, size);
    }

    const bottomTex = new THREE.CanvasTexture(bottomCanvas);
    bottomTex.magFilter = THREE.NearestFilter;
    bottomTex.minFilter = THREE.NearestFilter;

    // ---- SIDE FACES — skin with hair on top ----
    function makeSideCanvas() {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = skinColor;
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = hairColor;
        if (isMale) {
            // Steve side — hair on top + sideburn
            ctx.fillRect(0, 0, size, px * 1.5);
            // Sideburn extending down front edge
            ctx.fillRect(size - px * 2, px * 1.5, px * 2, px * 2);
            ctx.fillRect(size - px, px * 1.5, px, px * 2.5);
            // Hair on back half of side
            ctx.fillRect(0, px * 1.5, px * 3, px * 2);
            // Subtle darker hair texture
            ctx.fillStyle = hairHighlight;
            ctx.fillRect(px * 1, px * 0.5, px, px * 2);
            ctx.fillRect(px * 4, px * 0.5, px, px);
            // Ear
            ctx.fillStyle = '#b8835f';
            ctx.fillRect(px * 5, px * 3, px * 1.5, px * 1.2);
            ctx.fillStyle = '#a07050';
            ctx.fillRect(px * 5.3, px * 3.2, px, px * 0.8);
        } else {
            // Female: hair covers most of the side
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = skinColor;
            ctx.fillRect(px * 0, px * 2.5, px * 3, px * 3);
            ctx.fillStyle = '#6b4423';
            ctx.fillRect(px * 4, px * 1, px * 0.5, size);
            ctx.fillRect(px * 6, px * 2, px * 0.5, size);
            ctx.fillStyle = '#2a1506';
            ctx.fillRect(px * 3, px * 3, px * 0.5, size);
            ctx.fillRect(px * 7, px * 1, px * 0.5, size);
            ctx.fillStyle = '#d4a078';
            ctx.fillRect(px * 0.5, px * 3.5, px, px * 0.8);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        return tex;
    }

    const sideTex = makeSideCanvas();
    const side2Tex = makeSideCanvas();

    return [sideTex, side2Tex, topTex, bottomTex, frontTex, backTex];
}

/**
 * Creates a Minecraft-style torso texture
 */
function createMinecraftTorsoTextures(clothingColor, isMale) {
    const size = 64;
    const px = size / 8;

    if (isMale) {
        // ---- STEVE'S ICONIC CYAN TEAL SHIRT ----
        const steveShirtColor = '#00aaa0'; // Steve's signature teal/cyan
        const steveShirtDark = '#009090'; // Slightly darker shade
        const steveShirtLight = '#00bfb5'; // Lighter highlight

        // FRONT — Steve tee with collar shadow
        const frontC = document.createElement('canvas');
        frontC.width = size;
        frontC.height = size;
        const fCtx = frontC.getContext('2d');
        fCtx.fillStyle = steveShirtColor;
        fCtx.fillRect(0, 0, size, size);
        // Collar/neckline shadow
        fCtx.fillStyle = steveShirtDark;
        fCtx.fillRect(px * 2.5, 0, px * 3, px * 0.6);
        // Bottom edge darker (tuck)
        fCtx.fillStyle = steveShirtDark;
        fCtx.fillRect(0, size - px, size, px);
        // Side shadows
        fCtx.fillStyle = 'rgba(0,0,0,0.06)';
        fCtx.fillRect(0, 0, px * 0.5, size);
        fCtx.fillRect(size - px * 0.5, 0, px * 0.5, size);
        // Light center highlight
        fCtx.fillStyle = steveShirtLight;
        fCtx.fillRect(px * 3, px * 1, px * 2, px * 0.5);

        const frontTex = new THREE.CanvasTexture(frontC);
        frontTex.magFilter = THREE.NearestFilter;
        frontTex.minFilter = THREE.NearestFilter;

        // BACK — solid teal with subtle detail
        const backC = document.createElement('canvas');
        backC.width = size;
        backC.height = size;
        const bkCtx = backC.getContext('2d');
        bkCtx.fillStyle = steveShirtColor;
        bkCtx.fillRect(0, 0, size, size);
        bkCtx.fillStyle = steveShirtDark;
        bkCtx.fillRect(0, size - px, size, px);
        bkCtx.fillRect(0, 0, size, px * 0.4);

        const backTex = new THREE.CanvasTexture(backC);
        backTex.magFilter = THREE.NearestFilter;
        backTex.minFilter = THREE.NearestFilter;

        // SIDE — teal with arm hole shadow
        const sideC = document.createElement('canvas');
        sideC.width = size;
        sideC.height = size;
        const sdCtx = sideC.getContext('2d');
        sdCtx.fillStyle = steveShirtColor;
        sdCtx.fillRect(0, 0, size, size);
        sdCtx.fillStyle = steveShirtDark;
        sdCtx.fillRect(0, size - px, size, px);
        sdCtx.fillRect(0, 0, size, px * 0.4);

        const sideTex = new THREE.CanvasTexture(sideC);
        sideTex.magFilter = THREE.NearestFilter;
        sideTex.minFilter = THREE.NearestFilter;

        // TOP — teal with collar opening
        const topC = document.createElement('canvas');
        topC.width = size;
        topC.height = size;
        const tpCtx = topC.getContext('2d');
        tpCtx.fillStyle = steveShirtColor;
        tpCtx.fillRect(0, 0, size, size);
        tpCtx.fillStyle = steveShirtDark;
        tpCtx.fillRect(px * 2, px * 1, px * 4, px * 6);

        const topTex = new THREE.CanvasTexture(topC);
        topTex.magFilter = THREE.NearestFilter;
        topTex.minFilter = THREE.NearestFilter;

        // BOTTOM — darker teal tuck
        const botC = document.createElement('canvas');
        botC.width = size;
        botC.height = size;
        const btCtx = botC.getContext('2d');
        btCtx.fillStyle = steveShirtDark;
        btCtx.fillRect(0, 0, size, size);

        const botTex = new THREE.CanvasTexture(botC);
        botTex.magFilter = THREE.NearestFilter;
        botTex.minFilter = THREE.NearestFilter;

        return [sideTex, sideTex, topTex, botTex, frontTex, backTex];
    }

    // ---- FEMALE TORSO (Reference: teal green top + orange belt) ----
    const tealColor = '#2ecc71'; // Vibrant teal/green matching the reference
    const beltColor = '#d4850a'; // Orange belt
    const buckleColor = '#f5a623'; // Golden buckle
    const skinColor = '#c69c6d'; // Skin show at neckline

    // FRONT — teal top with V-neckline, skin showing, orange belt at bottom
    const frontC = document.createElement('canvas');
    frontC.width = size;
    frontC.height = size;
    const fCtx = frontC.getContext('2d');
    // Main teal body
    fCtx.fillStyle = tealColor;
    fCtx.fillRect(0, 0, size, size);
    // Skin neckline V-shape (top 2 rows center)
    fCtx.fillStyle = skinColor;
    fCtx.fillRect(px * 2.5, 0, px * 3, px * 0.8);
    fCtx.fillRect(px * 3, px * 0.8, px * 2, px * 0.8);
    // Darker teal shadow under neckline
    fCtx.fillStyle = 'rgba(0,0,0,0.1)';
    fCtx.fillRect(px * 2, px * 1.5, px * 4, px * 0.3);
    // Teal darker edges for contour
    fCtx.fillStyle = 'rgba(0,0,0,0.08)';
    fCtx.fillRect(0, 0, px, size);
    fCtx.fillRect(size - px, 0, px, size);
    // Orange belt at bottom
    fCtx.fillStyle = beltColor;
    fCtx.fillRect(0, size - px * 1.5, size, px * 1.5);
    // Belt buckle center
    fCtx.fillStyle = buckleColor;
    fCtx.fillRect(px * 3, size - px * 1.5, px * 2, px * 1.2);
    // Buckle detail
    fCtx.fillStyle = 'rgba(0,0,0,0.2)';
    fCtx.fillRect(px * 3.3, size - px * 1.2, px * 1.4, px * 0.8);
    fCtx.fillStyle = buckleColor;
    fCtx.fillRect(px * 3.5, size - px * 1, px * 1, px * 0.5);
    // Shirt drape below belt (teal)
    fCtx.fillStyle = tealColor;
    fCtx.fillRect(px * 2.5, size - px * 0.5, px * 3, px * 0.5);

    const frontTex = new THREE.CanvasTexture(frontC);
    frontTex.magFilter = THREE.NearestFilter;
    frontTex.minFilter = THREE.NearestFilter;

    // BACK — teal top solid + belt
    const backC = document.createElement('canvas');
    backC.width = size;
    backC.height = size;
    const bkCtx = backC.getContext('2d');
    bkCtx.fillStyle = tealColor;
    bkCtx.fillRect(0, 0, size, size);
    bkCtx.fillStyle = 'rgba(0,0,0,0.05)';
    bkCtx.fillRect(px * 3, px * 1, px * 2, px * 5);
    // Belt
    bkCtx.fillStyle = beltColor;
    bkCtx.fillRect(0, size - px * 1.5, size, px * 1.5);

    const backTex = new THREE.CanvasTexture(backC);
    backTex.magFilter = THREE.NearestFilter;
    backTex.minFilter = THREE.NearestFilter;

    // SIDE — teal top + belt
    const sideC = document.createElement('canvas');
    sideC.width = size;
    sideC.height = size;
    const sdCtx = sideC.getContext('2d');
    sdCtx.fillStyle = tealColor;
    sdCtx.fillRect(0, 0, size, size);
    sdCtx.fillStyle = 'rgba(0,0,0,0.06)';
    sdCtx.fillRect(0, 0, size, px * 0.5);
    // Belt
    sdCtx.fillStyle = beltColor;
    sdCtx.fillRect(0, size - px * 1.5, size, px * 1.5);

    const sideTex = new THREE.CanvasTexture(sideC);
    sideTex.magFilter = THREE.NearestFilter;
    sideTex.minFilter = THREE.NearestFilter;

    // TOP — teal with skin neckline
    const topC = document.createElement('canvas');
    topC.width = size;
    topC.height = size;
    const tpCtx = topC.getContext('2d');
    tpCtx.fillStyle = tealColor;
    tpCtx.fillRect(0, 0, size, size);
    tpCtx.fillStyle = skinColor;
    tpCtx.fillRect(px * 2, 0, px * 4, px * 2);

    const topTex = new THREE.CanvasTexture(topC);
    topTex.magFilter = THREE.NearestFilter;
    topTex.minFilter = THREE.NearestFilter;

    // BOTTOM — belt
    const botC = document.createElement('canvas');
    botC.width = size;
    botC.height = size;
    const btCtx = botC.getContext('2d');
    btCtx.fillStyle = beltColor;
    btCtx.fillRect(0, 0, size, size);

    const botTex = new THREE.CanvasTexture(botC);
    botTex.magFilter = THREE.NearestFilter;
    botTex.minFilter = THREE.NearestFilter;

    return [sideTex, sideTex, topTex, botTex, frontTex, backTex];
}


/**
 * Build a MINECRAFT-STYLE blocky avatar from Box geometries
 * @param {string} colorHex - accent/clothing color
 * @param {string} name - display name
 * @param {string} gender - "male" or "female"
 */
function createHumanAvatar(colorHex, name, gender) {
    const group = new THREE.Group();
    const isMale = gender === 'male';

    // Minecraft skin & hair
    const skinTone = '#c69c6d';
    const hairColor = '#3b2314';
    const hairHighlight = '#6b4423';
    const hairDark = '#2a1506';

    const skinMat = new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.9, metalness: 0 });
    const clothingMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.85, metalness: 0 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.9, metalness: 0 });
    const hairHighlightMat = new THREE.MeshStandardMaterial({ color: hairHighlight, roughness: 0.9, metalness: 0 });

    // Female-specific materials
    const tealMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.85, metalness: 0 });
    const khakiMat = new THREE.MeshStandardMaterial({ color: 0xb8a070, roughness: 0.85, metalness: 0 }); // Khaki/tan pants
    const darkBrownBootMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.9, metalness: 0 });
    const brownHandMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9, metalness: 0 });

    // Male-specific materials (Steve's look)
    const steveTealMat = new THREE.MeshStandardMaterial({ color: 0x00aaa0, roughness: 0.85, metalness: 0 }); // Steve's iconic cyan shirt
    const malePantsMat = new THREE.MeshStandardMaterial({ color: 0x2b2b7a, roughness: 0.85, metalness: 0 }); // Dark indigo jeans
    const maleBootMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0 }); // Gray shoes

    // === HEAD (Minecraft iconic cube) ===
    const headSize = 0.6;
    const headGeo = new THREE.BoxGeometry(headSize, headSize, headSize);
    const headTextures = createMinecraftHeadTextures(skinTone, hairColor, colorHex, isMale);
    const headMaterials = headTextures.map(tex => new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.9,
        metalness: 0
    }));
    const head = new THREE.Mesh(headGeo, headMaterials);
    head.position.y = 2.42;
    head.castShadow = true;
    group.add(head);

    // === FEMALE LONG HAIR BLOCKS ===
    if (!isMale) {
        // Back hair — wide flat block behind the head extending down
        const backHairGeo = new THREE.BoxGeometry(0.62, 0.95, 0.12);
        const backHair = new THREE.Mesh(backHairGeo, hairMat);
        backHair.position.set(0, 1.98, -0.20);
        backHair.castShadow = true;
        group.add(backHair);

        // Hair highlight stripes on back hair
        const backHairStripe1 = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.9, 0.005),
            hairHighlightMat
        );
        backHairStripe1.position.set(-0.15, 1.98, -0.26);
        group.add(backHairStripe1);

        const backHairStripe2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.85, 0.005),
            hairHighlightMat
        );
        backHairStripe2.position.set(0.18, 2.0, -0.26);
        group.add(backHairStripe2);

        // Left side hair — cascading block going down
        const leftHairGeo = new THREE.BoxGeometry(0.10, 0.85, 0.22);
        const leftHair = new THREE.Mesh(leftHairGeo, hairMat);
        leftHair.position.set(-0.35, 2.0, -0.04);
        leftHair.castShadow = true;
        group.add(leftHair);

        // Left front hair strand
        const leftFrontHair = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.7, 0.10),
            hairMat
        );
        leftFrontHair.position.set(-0.33, 1.95, 0.10);
        leftFrontHair.castShadow = true;
        group.add(leftFrontHair);

        // Right side hair
        const rightHairGeo = new THREE.BoxGeometry(0.10, 0.85, 0.22);
        const rightHair = new THREE.Mesh(rightHairGeo, hairMat);
        rightHair.position.set(0.35, 2.0, -0.04);
        rightHair.castShadow = true;
        group.add(rightHair);

        // Right front hair strand
        const rightFrontHair = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.7, 0.10),
            hairMat
        );
        rightFrontHair.position.set(0.33, 1.95, 0.10);
        rightFrontHair.castShadow = true;
        group.add(rightFrontHair);

        // Hair highlight blocks on sides
        const leftHairHL = new THREE.Mesh(
            new THREE.BoxGeometry(0.005, 0.6, 0.08),
            hairHighlightMat
        );
        leftHairHL.position.set(-0.40, 2.0, 0.0);
        group.add(leftHairHL);

        const rightHairHL = new THREE.Mesh(
            new THREE.BoxGeometry(0.005, 0.6, 0.08),
            hairHighlightMat
        );
        rightHairHL.position.set(0.40, 2.0, 0.0);
        group.add(rightHairHL);
    }

    // === TORSO (rectangular body) ===
    const torsoW = isMale ? 0.56 : 0.50; // Female slightly slimmer
    const torsoH = 0.72;
    const torsoD = 0.28;
    const torsoGeo = new THREE.BoxGeometry(torsoW, torsoH, torsoD);
    const torsoTextures = createMinecraftTorsoTextures(colorHex, isMale);
    const torsoMaterials = torsoTextures.map(tex => new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.85,
        metalness: 0
    }));
    const torso = new THREE.Mesh(torsoGeo, torsoMaterials);
    torso.position.y = 1.72;
    torso.castShadow = true;
    group.add(torso);

    // === ARMS ===
    const armW = isMale ? 0.24 : 0.20; // Female slimmer arms
    const armH = 0.72;
    const armD = isMale ? 0.24 : 0.20;

    // Arm offset: torso edge + half arm width
    const armOffsetX = torsoW / 2 + armW / 2;

    // Left arm pivot (shoulder joint)
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-armOffsetX, 2.06, 0);

    if (isMale) {
        // STEVE ARMS — short cyan teal sleeve on upper, skin on lower
        const leftArmSleeve = new THREE.Mesh(
            new THREE.BoxGeometry(armW, armH * 0.35, armD),
            steveTealMat
        );
        leftArmSleeve.position.y = -armH * 0.17;
        leftArmSleeve.castShadow = true;
        leftArmPivot.add(leftArmSleeve);

        const leftArmSkin = new THREE.Mesh(
            new THREE.BoxGeometry(armW * 0.95, armH * 0.65, armD * 0.95),
            skinMat
        );
        leftArmSkin.position.y = -armH * 0.67;
        leftArmSkin.castShadow = true;
        leftArmPivot.add(leftArmSkin);
    } else {
        // FEMALE ARMS — short teal sleeve (top ~25%), long skin area, brown blocky hand
        const leftSleeve = new THREE.Mesh(
            new THREE.BoxGeometry(armW, armH * 0.25, armD),
            tealMat
        );
        leftSleeve.position.y = -armH * 0.12;
        leftSleeve.castShadow = true;
        leftArmPivot.add(leftSleeve);

        const leftArmSkin = new THREE.Mesh(
            new THREE.BoxGeometry(armW * 0.95, armH * 0.48, armD * 0.95),
            skinMat
        );
        leftArmSkin.position.y = -armH * 0.48;
        leftArmSkin.castShadow = true;
        leftArmPivot.add(leftArmSkin);

        // Brown blocky hand/glove
        const leftHand = new THREE.Mesh(
            new THREE.BoxGeometry(armW * 1.05, armH * 0.18, armD * 1.05),
            brownHandMat
        );
        leftHand.position.y = -armH * 0.80;
        leftHand.castShadow = true;
        leftArmPivot.add(leftHand);
    }

    group.add(leftArmPivot);

    // Right arm pivot
    const rightArmPivot = new THREE.Group();
    rightArmPivot.name = "rightArmPivot";
    rightArmPivot.position.set(armOffsetX, 2.06, 0);

    if (isMale) {
        // STEVE RIGHT ARM — cyan sleeve + skin
        const rightArmSleeve = new THREE.Mesh(
            new THREE.BoxGeometry(armW, armH * 0.35, armD),
            steveTealMat
        );
        rightArmSleeve.position.y = -armH * 0.17;
        rightArmSleeve.castShadow = true;
        rightArmPivot.add(rightArmSleeve);

        const rightArmSkin = new THREE.Mesh(
            new THREE.BoxGeometry(armW * 0.95, armH * 0.65, armD * 0.95),
            skinMat
        );
        rightArmSkin.position.y = -armH * 0.67;
        rightArmSkin.castShadow = true;
        rightArmPivot.add(rightArmSkin);
    } else {
        // FEMALE RIGHT ARM
        const rightSleeve = new THREE.Mesh(
            new THREE.BoxGeometry(armW, armH * 0.25, armD),
            tealMat
        );
        rightSleeve.position.y = -armH * 0.12;
        rightSleeve.castShadow = true;
        rightArmPivot.add(rightSleeve);

        const rightArmSkin = new THREE.Mesh(
            new THREE.BoxGeometry(armW * 0.95, armH * 0.48, armD * 0.95),
            skinMat
        );
        rightArmSkin.position.y = -armH * 0.48;
        rightArmSkin.castShadow = true;
        rightArmPivot.add(rightArmSkin);

        const rightHand = new THREE.Mesh(
            new THREE.BoxGeometry(armW * 1.05, armH * 0.18, armD * 1.05),
            brownHandMat
        );
        rightHand.position.y = -armH * 0.80;
        rightHand.castShadow = true;
        rightArmPivot.add(rightHand);
    }

    // Add Axe to right hand (hidden initially)
    const axe = createAxeMesh();
    axe.position.set(0, -armH, 0.1); 
    axe.rotation.x = -Math.PI / 2;
    axe.rotation.y = Math.PI / 2;
    axe.visible = false;
    rightArmPivot.add(axe);

    group.add(rightArmPivot);

    // === LEGS ===
    const legW = 0.24;
    const legH = 0.72;
    const legD = 0.24;
    const legOffsetX = legW / 2 + 0.02;
    const pantsMat = isMale ? malePantsMat : khakiMat;
    const shoeMat = isMale ? maleBootMat : darkBrownBootMat;

    // Left leg pivot
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-legOffsetX, 1.36, 0);

    const leftLeg = new THREE.Mesh(
        new THREE.BoxGeometry(legW, legH * 0.65, legD),
        pantsMat
    );
    leftLeg.position.y = -legH * 0.32;
    leftLeg.castShadow = true;
    leftLegPivot.add(leftLeg);

    // Boot
    const leftBoot = new THREE.Mesh(
        new THREE.BoxGeometry(legW * 1.05, legH * 0.35, legD * 1.1),
        shoeMat
    );
    leftBoot.position.y = -legH * 0.55 - legH * 0.1;
    leftBoot.castShadow = true;
    leftLegPivot.add(leftBoot);

    // Female boot gem accents
    if (!isMale) {
        // Boot strap
        const leftBootStrap = new THREE.Mesh(
            new THREE.BoxGeometry(legW * 1.08, 0.02, legD * 1.13),
            brownHandMat
        );
        leftBootStrap.position.y = -legH * 0.48;
        leftLegPivot.add(leftBootStrap);

        // Blue gem
        const leftGem = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.04, 0.005),
            new THREE.MeshStandardMaterial({ color: 0x3498db, emissive: 0x3498db, emissiveIntensity: 0.3 })
        );
        leftGem.position.set(-0.06, -legH * 0.58, legD * 0.56);
        leftLegPivot.add(leftGem);

        // Green gem
        const leftGem2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.04, 0.005),
            new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x2ecc71, emissiveIntensity: 0.3 })
        );
        leftGem2.position.set(0.06, -legH * 0.62, legD * 0.56);
        leftLegPivot.add(leftGem2);
    }

    group.add(leftLegPivot);

    // Right leg pivot
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(legOffsetX, 1.36, 0);

    const rightLeg = new THREE.Mesh(
        new THREE.BoxGeometry(legW, legH * 0.65, legD),
        pantsMat
    );
    rightLeg.position.y = -legH * 0.32;
    rightLeg.castShadow = true;
    rightLegPivot.add(rightLeg);

    const rightBoot = new THREE.Mesh(
        new THREE.BoxGeometry(legW * 1.05, legH * 0.35, legD * 1.1),
        shoeMat
    );
    rightBoot.position.y = -legH * 0.55 - legH * 0.1;
    rightBoot.castShadow = true;
    rightLegPivot.add(rightBoot);

    // Female boot gem accents
    if (!isMale) {
        const rightBootStrap = new THREE.Mesh(
            new THREE.BoxGeometry(legW * 1.08, 0.02, legD * 1.13),
            brownHandMat
        );
        rightBootStrap.position.y = -legH * 0.48;
        rightLegPivot.add(rightBootStrap);

        const rightGem = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.04, 0.005),
            new THREE.MeshStandardMaterial({ color: 0x3498db, emissive: 0x3498db, emissiveIntensity: 0.3 })
        );
        rightGem.position.set(0.06, -legH * 0.58, legD * 0.56);
        rightLegPivot.add(rightGem);

        const rightGem2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.04, 0.005),
            new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x2ecc71, emissiveIntensity: 0.3 })
        );
        rightGem2.position.set(-0.06, -legH * 0.62, legD * 0.56);
        rightLegPivot.add(rightGem2);
    }

    group.add(rightLegPivot);

    // === GLOW RING (under feet — square, Minecraft-style) ===
    const ringGeo = new THREE.BoxGeometry(1.0, 0.03, 1.0);
    const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex),
        transparent: true,
        opacity: 0.3
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.02;
    group.add(ring);

    // === POINT LIGHT (accent glow) ===
    const light = new THREE.PointLight(new THREE.Color(colorHex), 1.2, 4);
    light.position.y = 1.5;
    group.add(light);

    // === NAME TAG (Canvas Sprite) ===
    const nameTag = createNameSprite(name, colorHex);
    nameTag.position.y = 3.05;
    group.add(nameTag);

    // Store references for animation
    group.userData = {
        leftArmPivot,
        rightArmPivot,
        leftLegPivot,
        rightLegPivot,
        ring,
        torso,
        head,
        nameSprite: nameTag,
        timeOffset: Math.random() * Math.PI * 2,
        gender,
        isMoving: false,
        isSwinging: false,
        walkPhase: 0
    };

    return group;
}


/**
 * Creates a floating name tag as a Canvas-textured Sprite
 */
function createNameSprite(name, colorHex) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;

    // Background pill
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    const pillX = 16;
    const pillW = 224;
    const pillH = 44;
    const pillY = 10;
    const pillR = 22;
    ctx.beginPath();
    ctx.moveTo(pillX + pillR, pillY);
    ctx.lineTo(pillX + pillW - pillR, pillY);
    ctx.arc(pillX + pillW - pillR, pillY + pillR, pillR, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(pillX + pillR, pillY + pillH);
    ctx.arc(pillX + pillR, pillY + pillR, pillR, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();

    // Accent bar
    ctx.fillStyle = colorHex;
    ctx.fillRect(pillX, pillY, 4, pillH);

    // Name text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 32, 200);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.0, 0.5, 1);
    return sprite;
}


// =============================================
//  AVATAR ANIMATION
// =============================================

function animateAvatar(avatar, time, delta, isMoving) {
    const ud = avatar.userData;
    const t = time + ud.timeOffset;
    const walkSpeed = 10; // Faster, snappier Minecraft walk

    if (isMoving) {
        ud.walkPhase += delta * walkSpeed;

        // Minecraft-style stiff leg swing (sharper angles)
        const legSwing = Math.sin(ud.walkPhase) * 0.8;
        ud.leftLegPivot.rotation.x = legSwing;
        ud.rightLegPivot.rotation.x = -legSwing;

        // Arms swing opposite to legs (stiff, no ease)
        ud.leftArmPivot.rotation.x = -legSwing * 0.7;
        if (!ud.isSwinging) {
            ud.rightArmPivot.rotation.x = legSwing * 0.7;
        }

        // Minecraft bob — slightly more pronounced
        ud.torso.position.y = 1.72 + Math.abs(Math.sin(ud.walkPhase * 2)) * 0.03;
        ud.head.position.y = 2.42 + Math.abs(Math.sin(ud.walkPhase * 2)) * 0.03;
    } else {
        // Idle — very subtle, Minecraft-style
        ud.walkPhase = 0;

        // No breathing scale — Minecraft characters are rigid
        ud.torso.scale.set(1, 1, 1);

        // Very subtle arm idle sway
        ud.leftArmPivot.rotation.x = Math.sin(t * 0.6) * 0.02;
        if (!ud.isSwinging) {
            ud.rightArmPivot.rotation.x = Math.sin(t * 0.6 + 0.5) * 0.02;
            ud.rightArmPivot.rotation.z = 0;
        }
        ud.leftArmPivot.rotation.z = 0;

        // Reset legs to neutral
        ud.leftLegPivot.rotation.x = THREE.MathUtils.lerp(ud.leftLegPivot.rotation.x, 0, delta * 8);
        ud.rightLegPivot.rotation.x = THREE.MathUtils.lerp(ud.rightLegPivot.rotation.x, 0, delta * 8);

        // Reset positions
        ud.torso.position.y = THREE.MathUtils.lerp(ud.torso.position.y, 1.72, delta * 6);
        ud.head.position.y = THREE.MathUtils.lerp(ud.head.position.y, 2.42, delta * 6);
    }

    // Ring pulse (always)
    ud.ring.material.opacity = 0.2 + Math.sin(t * 2) * 0.1;

    // Name tag always faces camera (sprites do this automatically)
    ud.nameSprite.position.y = 3.05 + Math.sin(t * 1.2) * 0.04;
}



// --- WEBSOCKET LOGIC ---
function connectWebSocket() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log("Connected to server");
        // Hide loader and show setup instead of fully hiding connection overlay
        loaderContent.style.display = 'none';
        initialSetupContent.style.display = 'block';
        statusIndicator.classList.add('online');
    };

    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
    };

    socket.onclose = () => {
        console.log("Disconnected");
        statusIndicator.classList.remove('online');
        drawerUsername.textContent = "Disconnected - Retrying...";
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (err) => {
        console.error("WebSocket Error:", err);
    };
}

function handleServerMessage(msg) {
    switch (msg.type) {
        case 'init':
            myUserId = msg.user_id;
            for (const [id, data] of Object.entries(msg.state)) {
                spawnUser(id, data);
            }
            drawerUsername.textContent = msg.state[myUserId].name;
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
                avatarMeta[msg.user_id].isMoving = true;
                // Reset isMoving after a short delay
                clearTimeout(avatarMeta[msg.user_id].moveTimeout);
                avatarMeta[msg.user_id].moveTimeout = setTimeout(() => {
                    if (avatarMeta[msg.user_id]) avatarMeta[msg.user_id].isMoving = false;
                }, 200);
            }
            break;

        case 'user_left':
            if (avatars[msg.user_id]) {
                scene.remove(avatars[msg.user_id]);
                delete avatars[msg.user_id];
                delete targetPositions[msg.user_id];
                delete avatarMeta[msg.user_id];
            }
            break;

        case 'chat_message': {
            const isMe = msg.user_id === myUserId;
            const senderName = avatars[msg.user_id] ? avatars[msg.user_id].userData.nameSprite ? avatarMeta[msg.user_id]?.name : `User-${msg.user_id.substring(0, 4)}` : `User-${msg.user_id.substring(0, 4)}`;
            addChatMessage(senderName, msg.text, isMe ? 'self' : 'other');
            break;
        }

        case 'file_message': {
            const isMe = msg.user_id === myUserId;
            const senderName = avatarMeta[msg.user_id]?.name || `User-${msg.user_id.substring(0, 4)}`;
            addFileMessage(senderName, msg.filename, msg.file_url, msg.file_type, isMe ? 'self' : 'other');
            break;
        }

        case 'profile_updated':
            if (avatarMeta[msg.user_id]) {
                const oldAvatar = avatars[msg.user_id];
                const oldMeta = avatarMeta[msg.user_id];
                
                // Store updated data
                const updatedName = msg.name;
                const updatedColor = msg.color;
                const updatedGender = msg.gender || oldMeta.gender;
                const currentPos = oldAvatar.position.clone();
                const currentRot = oldAvatar.rotation.y;
                
                // Remove old avatar
                scene.remove(oldAvatar);
                
                // Create new avatar with new appearance
                const newAvatar = createHumanAvatar(updatedColor, updatedName, updatedGender);
                newAvatar.position.copy(currentPos);
                newAvatar.rotation.y = currentRot;
                scene.add(newAvatar);
                
                // Update references
                avatars[msg.user_id] = newAvatar;
                avatarMeta[msg.user_id] = {
                    name: updatedName,
                    gender: updatedGender,
                    color: updatedColor,
                    isMoving: oldMeta.isMoving,
                    moveTimeout: oldMeta.moveTimeout
                };
                
                // If it's us, update UI & Camera
                if (msg.user_id === myUserId) {
                    drawerUsername.textContent = updatedName;
                    controls.target.copy(newAvatar.position).add(new THREE.Vector3(0, 2.26, 0));
                    
                    // Restore axe visibility
                    if (inventory.hasAxe) {
                        const axe = newAvatar.getObjectByName('axe');
                        if (axe) axe.visible = true;
                    }
                }
            }
            break;
    }
}

function spawnUser(id, data) {
    if (avatars[id]) return;

    const gender = data.gender || 'male';
    const avatar = createHumanAvatar(data.color, data.name, gender);
    avatar.position.set(data.x, 0, data.z);
    avatar.rotation.y = data.rotation;

    scene.add(avatar);
    avatars[id] = avatar;
    avatarMeta[id] = {
        name: data.name,
        gender,
        color: data.color,
        isMoving: false,
        moveTimeout: null
    };
    targetPositions[id] = { x: data.x, z: data.z, rotation: data.rotation };

    if (id === myUserId) {
        playerState.x = data.x;
        playerState.z = data.z;
        controls.target.copy(avatar.position).add(new THREE.Vector3(0, 2.26, 0));
        
        // Show axe if we have it
        if (inventory.hasAxe) {
            const axe = avatar.getObjectByName('axe');
            if (axe) axe.visible = true;
        }
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
    if (document.activeElement === chatInput) return;
    if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
    if (keys.hasOwnProperty(e.code)) keys[e.code] = true;
}

function onKeyUp(e) {
    if (keys.hasOwnProperty(e.key)) keys[e.key] = false;
    if (keys.hasOwnProperty(e.code)) keys[e.code] = false;
}

function onPointerDown(event) {
    const isLeftClick = event.button === 0;
    const isRightClick = event.button === 2;
    
    if (!isLeftClick && !isRightClick) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // 1. Check interactables (Trees & Axes)
    const intersects = raycaster.intersectObjects(interactables, true);
    
    if (intersects.length > 0 && intersects[0].distance < 12) {
        let hit = intersects[0].object;
        while (hit && !hit.userData.type) {
            hit = hit.parent; 
        }

        if (hit) {
            // PICK UP AXE (Left or Right click)
            if (hit.userData.type === 'axe_stump') {
                scene.remove(hit);
                interactables.splice(interactables.indexOf(hit), 1);
                inventory.hasAxe = true;
                
                qtyAxe.textContent = "1";
                slotAxe.classList.add('selected');
                
                // Show axe on avatar
                const myAvatar = avatars[myUserId];
                if (myAvatar) {
                    const axe = myAvatar.getObjectByName('axe');
                    if (axe) axe.visible = true;
                }
                return;
            }
            // CUT TREE (Left click ONLY as requested)
            else if (hit.userData.type === 'tree') {
                if (isLeftClick) {
                    if (inventory.hasAxe) {
                        performAxeSwing();
                        performTreeFall(hit);
                        
                        // Add wood logic
                        inventory.wood += 5;
                        qtyWood.textContent = inventory.wood;
                        
                        // Remove from interactables immediately so it can't be clicked twice
                        interactables.splice(interactables.indexOf(hit), 1);
                    } else {
                        addChatMessage("System", "You need an Axe to cut trees! Left-click an axe stump first.", "sys");
                    }
                }
                return;
            }
        }
    }

    if (!isRightClick) return; // Standard building only on Right-Click

    // 2. Building Mechanics
    if (inventory.wood > 0) {
        // Raycast against the environment meshes
        const envObjects = [];
        scene.children.forEach(c => {
            if (c.isInstancedMesh || c.geometry?.type === 'BoxGeometry') envObjects.push(c);
        });

        const sceneIntersects = raycaster.intersectObjects(envObjects, true);
        if (sceneIntersects.length > 0 && sceneIntersects[0].distance < 15) {
            const intersect = sceneIntersects[0];
            
            // Determine coordinate by extending outward along the surface normal
            const addPos = intersect.point.clone().add(intersect.face.normal.clone().multiplyScalar(0.5));
            const bx = Math.round(addPos.x);
            const by = Math.round(addPos.y);
            const bz = Math.round(addPos.z);

            // Restrict from placing block exactly where the player is standing
            const px = Math.round(playerState.x);
            const py = Math.round(playerState.y + 0.76);
            const pz = Math.round(playerState.z);
            if (bx === px && bz === pz && (by === py || by === py + 1)) return; 

            // Spawn Block
            const blockGeo = new THREE.BoxGeometry(1, 1, 1);
            
            // Create a custom plank texture programmatically
            const plankCanvas = document.createElement('canvas');
            plankCanvas.width = 16; plankCanvas.height = 16;
            const pCtx = plankCanvas.getContext('2d');
            pCtx.fillStyle = '#b58853'; pCtx.fillRect(0,0,16,16);
            for(let i=0; i<30; i++) {
                pCtx.fillStyle = '#9c7042';
                pCtx.fillRect(Math.floor(Math.random()*16), Math.floor(Math.random()*16), Math.random()*8, 1);
            }
            pCtx.fillStyle = '#6b4423';
            pCtx.fillRect(0,0,16,2); pCtx.fillRect(0,8,16,2); // lines
            const plankTex = new THREE.CanvasTexture(plankCanvas);
            plankTex.magFilter = THREE.NearestFilter;

            const blockMat = new THREE.MeshStandardMaterial({map: plankTex, roughness: 0.9});
            const block = new THREE.Mesh(blockGeo, blockMat);
            
            block.position.set(bx, by, bz);
            block.castShadow = true;
            block.receiveShadow = true;
            scene.add(block);

            // Update state
            inventory.wood -= 1;
            qtyWood.textContent = inventory.wood;

            // CRITICAL: Update the global heightmap so gravity and walking accounts for this new block
            const currentH = terrainHeights.has(`${bx},${bz}`) ? terrainHeights.get(`${bx},${bz}`) : -Infinity;
            // Math.max because they might build an arch and we only map top collision height for now
            if (by >= currentH) {
                terrainHeights.set(`${bx},${bz}`, by);
            }
        }
    }
}

function updateMovement(delta) {
    if (!avatars[myUserId]) return;

    let moved = false;
    const direction = new THREE.Vector3();

    if (keys[' ']) {
        if (!playerState.isJumping) {
            playerState.vy = 10; // Jump strength
            playerState.isJumping = true;
        }
    }

    const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    if (keys.w || keys.ArrowUp) { direction.add(forward); }
    if (keys.s || keys.ArrowDown) { direction.sub(forward); }
    if (keys.a || keys.ArrowLeft) { direction.sub(right); }
    if (keys.d || keys.ArrowRight) { direction.add(right); }

    const radius = 0.25; 
    
    // Calculate current ground max height under player bounding box
    const checkHeight = (x, z) => {
        let maxBase = -Infinity;
        const pts = [
            {x: x + radius, z: z + radius},
            {x: x - radius, z: z + radius},
            {x: x + radius, z: z - radius},
            {x: x - radius, z: z - radius}
        ];
        for (let p of pts) {
            let bx = Math.round(p.x);
            let bz = Math.round(p.z);
            let gh = terrainHeights.has(`${bx},${bz}`) ? terrainHeights.get(`${bx},${bz}`) : 0;
            let base = gh - 0.76;
            if (base > maxBase) maxBase = base;
        }
        return maxBase;
    };

    let currentBase = checkHeight(playerState.x, playerState.z);

    // X-axis movement
    if (direction.x !== 0 || direction.z !== 0) {
        direction.normalize();
        
        let moveX = direction.x * MOVE_SPEED * delta;
        let xBase = checkHeight(playerState.x + moveX, playerState.z);
        if (xBase <= playerState.y + 0.5) { // Can walk if step is < 0.5
            playerState.x += moveX;
            moved = true;
        }

        let moveZ = direction.z * MOVE_SPEED * delta;
        let zBase = checkHeight(playerState.x, playerState.z + moveZ);
        if (zBase <= playerState.y + 0.5) { 
            playerState.z += moveZ;
            moved = true;
        }
        
        if (moved) playerState.rotation = Math.atan2(direction.x, direction.z);
    }
    
    // Update ground target based on new position
    let targetBaseY = checkHeight(playerState.x, playerState.z);

    // Gravity logic
    if (playerState.isJumping || playerState.y > targetBaseY) {
        playerState.vy -= 25 * delta; // Gravity
        playerState.y += playerState.vy * delta;
        if (playerState.y <= targetBaseY) {
            playerState.y = targetBaseY;
            playerState.vy = 0;
            playerState.isJumping = false;
        }
    } else if (playerState.y < targetBaseY) {
        // Only step up if we are already clearing the horizontal collision
        playerState.y = targetBaseY;
    }

    playerState.isMoving = moved;

    if (moved || playerState.isJumping || playerState.vy !== 0) {
        const me = avatars[myUserId];
        me.position.x = playerState.x;
        me.position.y = playerState.y;
        me.position.z = playerState.z;
        me.rotation.y = THREE.MathUtils.lerp(me.rotation.y, playerState.rotation, 0.1);
        
        // Make camera follow jump too, but smoothly looking at upper body
        controls.target.copy(me.position).add(new THREE.Vector3(0, 2.26, 0));
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
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- FILE UPLOAD ---
async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Check size client-side
    if (file.size > 5 * 1024 * 1024) {
        addChatMessage('System', 'File too large. Maximum size is 5MB.', 'sys');
        fileInput.value = '';
        return;
    }

    // Show progress
    uploadProgress.classList.remove('hidden');

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: 'Upload failed' }));
            throw new Error(err.detail || 'Upload failed');
        }

        const result = await response.json();

        // Send file message through WebSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'file',
                filename: result.data.filename,
                file_url: result.data.file_url,
                file_type: result.data.file_type
            }));
        }

    } catch (err) {
        console.error('Upload error:', err);
        addChatMessage('System', `Upload failed: ${err.message}`, 'sys');
    } finally {
        uploadProgress.classList.add('hidden');
        fileInput.value = '';
    }
}

function addFileMessage(sender, filename, fileUrl, fileType, type) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message file-msg ${type}`;

    const senderEl = document.createElement('span');
    senderEl.className = 'sender';
    senderEl.textContent = sender;
    msgEl.appendChild(senderEl);

    const fullUrl = `${API_BASE}${fileUrl}`;

    if (fileType === 'image') {
        // Image preview
        const preview = document.createElement('div');
        preview.className = 'file-preview';
        const img = document.createElement('img');
        img.src = fullUrl;
        img.alt = filename;
        img.loading = 'lazy';
        img.addEventListener('click', () => window.open(fullUrl, '_blank'));
        preview.appendChild(img);
        msgEl.appendChild(preview);
    } else {
        // Document download link
        const link = document.createElement('a');
        link.className = 'file-download-link';
        link.href = fullUrl;
        link.target = '_blank';
        link.download = filename;

        // File icon SVG
        link.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <span class="file-name">${filename}</span>
            <span class="file-badge">${getFileExtension(filename)}</span>
        `;
        msgEl.appendChild(link);
    }

    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function getFileExtension(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toUpperCase() : 'FILE';
}


// --- INITIAL SETUP SCREEN LOGIC ---
function initSetupScreen() {
    let setupSelectedGender = 'male';

    setupGenderCards.forEach(card => {
        card.addEventListener('click', () => {
            setupGenderCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            setupSelectedGender = card.dataset.value;
        });
    });

    joinWorkspaceBtn.addEventListener('click', () => {
        const newName = setupNameInput.value.trim() || 'Anonymous';
        
        // Distinct default colors so male and female look totally different initially
        const defaultColor = setupSelectedGender === 'male' ? '#2563eb' : '#ff2a5f';
        
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'update_profile',
                name: newName,
                gender: setupSelectedGender,
                color: defaultColor
            }));
        }
        
        // Finalize setup: hide the complete connection overlay
        connectionOverlay.classList.remove('fade-in');
        connectionOverlay.classList.add('hidden');
    });
}

// --- PROFILE MODAL LOGIC ---
function initProfileModal() {
    let selectedGender = 'male';
    let selectedColor = '#ff2a5f';

    editProfileBtn.addEventListener('click', () => {
        if (!avatarMeta[myUserId]) return;

        // Close drawer when opening profile modal
        closeNavDrawer();
        
        profileNameInput.value = avatarMeta[myUserId].name;
        selectedGender = avatarMeta[myUserId].gender;
        selectedColor = avatarMeta[myUserId].color;

        genderCards.forEach(c => {
            if (c.dataset.value === selectedGender) c.classList.add('active');
            else c.classList.remove('active');
        });
        
        colorSwatches.forEach(s => {
            if (s.dataset.color === selectedColor) s.classList.add('active');
            else s.classList.remove('active');
        });

        profileModal.classList.remove('hidden');
    });

    closeProfileBtn.addEventListener('click', () => {
        profileModal.classList.add('hidden');
    });

    genderCards.forEach(card => {
        card.addEventListener('click', () => {
            genderCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectedGender = card.dataset.value;
        });
    });

    colorSwatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            colorSwatches.forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            selectedColor = swatch.dataset.color;
        });
    });

    saveProfileBtn.addEventListener('click', () => {
        const newName = profileNameInput.value.trim() || 'Anonymous';
        
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'update_profile',
                name: newName,
                gender: selectedGender,
                color: selectedColor
            }));
        }
        
        profileModal.classList.add('hidden');
    });
}

function updateDayNightCycle() {
    // Get exact IST Time
    const today = new Date();
    const istOpts = { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
    
    // We convert it to a continuous decimal 0.0 to 24.0 (e.g. 14.5 is 2:30 PM)
    const istString = today.toLocaleString('en-US', istOpts); 
    const matches = istString.match(/(\d+):(\d+):(\d+)/);
    if (!matches) return;
    
    const h = parseInt(matches[1]);
    const m = parseInt(matches[2]);
    const s = parseInt(matches[3]);
    let t = h + (m / 60) + (s / 3600); // Ex: 14.25

    // Fast-time test mode shortcut: 
    // uncomment below to test day/night quickly in an hour loop
    // t = (clock.getElapsedTime() / 15) % 24; 

    // Angle mappings: Noon (12) is Math.PI/2 overhead. Midnight (0 or 24) is -Math.PI/2
    const angle = ((t - 6) / 12) * Math.PI;

    // Position the sun via Orbit
    const radius = 60;
    sunLight.position.x = Math.cos(angle) * radius;
    sunLight.position.y = Math.sin(angle) * radius;
    sunLight.position.z = Math.cos(angle) * radius * 0.5;

    // Day/Night Colors Map
    let cSky, iLight, iAmbient, iHemi;

    if (t >= 6.5 && t < 17.5) {
        // DAY
        cSky = new THREE.Color(0x87CEEB); 
        iLight = 1.2; iAmbient = 0.4; iHemi = 0.6;
    } else if (t >= 17.5 && t < 19) {
        // SUNSET
        cSky = new THREE.Color(0xFD5E53); // Orange/Red
        iLight = 0.6; iAmbient = 0.3; iHemi = 0.3;
    } else if (t >= 19 || t < 5.5) {
        // NIGHT
        cSky = new THREE.Color(0x07090f); // Dark space
        iLight = 0.05; iAmbient = 0.1; iHemi = 0.1; 
    } else {
        // SUNRISE
        cSky = new THREE.Color(0xFFB6C1); // Soft Pink
        iLight = 0.5; iAmbient = 0.2; iHemi = 0.3;
    }

    // Smooth transition between times
    scene.background.lerp(cSky, 0.01);
    scene.fog.color.lerp(cSky, 0.01);
    sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, iLight, 0.01);
    ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, iAmbient, 0.01);
    hemiLight.intensity = THREE.MathUtils.lerp(hemiLight.intensity, iHemi, 0.01);
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

    if (ambientLight && sunLight && hemiLight) {
        updateDayNightCycle();
    }

    updateMovement(delta);
    updateGoats(delta, time);

    // Animate all avatars
    for (const [id, avatar] of Object.entries(avatars)) {
        const isMoving = id === myUserId ? playerState.isMoving : (avatarMeta[id]?.isMoving || false);
        animateAvatar(avatar, time, delta, isMoving);

        // Interpolate other players' positions
        if (id !== myUserId && targetPositions[id]) {
            const target = targetPositions[id];
            avatar.position.x = THREE.MathUtils.lerp(avatar.position.x, target.x, delta * 10);
            avatar.position.y = THREE.MathUtils.lerp(avatar.position.y, target.y !== undefined ? target.y : -0.76, delta * 15);
            avatar.position.z = THREE.MathUtils.lerp(avatar.position.z, target.z, delta * 10);

            let rotDiff = target.rotation - avatar.rotation.y;
            rotDiff = (rotDiff + Math.PI) % (Math.PI * 2) - Math.PI;
            avatar.rotation.y += rotDiff * delta * 10;
        }
    }

    renderer.render(scene, camera);
}

// ===== HAMBURGER DRAWER =====
function openNavDrawer() {
    navDrawer.classList.add('open');
    drawerBackdrop.classList.add('active');
    hamburgerBtn.classList.add('active');
}

function closeNavDrawer() {
    navDrawer.classList.remove('open');
    drawerBackdrop.classList.remove('active');
    hamburgerBtn.classList.remove('active');
}

function initHamburgerDrawer() {
    hamburgerBtn.addEventListener('click', () => {
        if (navDrawer.classList.contains('open')) {
            closeNavDrawer();
        } else {
            openNavDrawer();
        }
    });

    closeDrawerBtn.addEventListener('click', closeNavDrawer);
    drawerBackdrop.addEventListener('click', closeNavDrawer);

    // Close drawer on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navDrawer.classList.contains('open')) {
            closeNavDrawer();
        }
    });
}

initHamburgerDrawer();

// ===== CHAT COLLAPSE =====
function initChatCollapse() {
    const toggleChat = () => {
        chatPanel.classList.toggle('collapsed');
    };

    chatHeaderToggle.addEventListener('click', (e) => {
        // Don't toggle if they clicked the collapse button itself (handled below)
        if (e.target.closest('#chat-collapse-btn')) return;
        toggleChat();
    });

    chatCollapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChat();
    });
}

initChatCollapse();
function performAxeSwing() {
    const myAvatar = avatars[myUserId];
    if (!myAvatar) return;

    const ud = myAvatar.userData;
    if (ud.isSwinging) return;
    
    // Find the right arm pivot
    const rightArmPivot = ud.rightArmPivot;
    if (!rightArmPivot) return;

    ud.isSwinging = true;

    // Simple swing animation using rotation
    const originalRotation = rightArmPivot.rotation.x;
    
    // Animation sequence
    const swingDuration = 400;
    const start = performance.now();
    
    function animateSwing(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / swingDuration, 1);
        
        // Quadratic ease for the swing
        // 0 to 1 back to 0
        const swingAngle = Math.sin(progress * Math.PI) * -1.5;
        rightArmPivot.rotation.x = originalRotation + swingAngle;
        
        if (progress < 1) {
            requestAnimationFrame(animateSwing);
        } else {
            rightArmPivot.rotation.x = originalRotation;
            ud.isSwinging = false;
        }
    }
    
    requestAnimationFrame(animateSwing);
}

function performTreeFall(treeGroup) {
    const duration = 1200;
    const start = performance.now();
    const fallAxis = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    const finalAngle = Math.PI / 2;

    // Start particle effect
    spawnWoodParticles(treeGroup.position);

    function animateFall(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease In Quad
        const angle = (progress * progress) * finalAngle;
        
        // Rotate the whole group
        treeGroup.rotation.x = angle * fallAxis.z;
        treeGroup.rotation.z = -angle * fallAxis.x;
        
        // Sinking into ground/Scaling down at end
        if (progress > 0.6) {
            const scaleProgress = (progress - 0.6) / 0.4;
            const scale = 1 - scaleProgress;
            treeGroup.scale.set(scale, scale, scale);
            treeGroup.position.y -= 0.05;
        }

        if (progress < 1) {
            requestAnimationFrame(animateFall);
        } else {
            scene.remove(treeGroup);
        }
    }
    
    requestAnimationFrame(animateFall);
}

function spawnWoodParticles(pos) {
    const particleCount = 20;
    const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
    const group = new THREE.Group();
    
    for (let i = 0; i < particleCount; i++) {
        const p = new THREE.Mesh(geo, mat);
        p.position.set(pos.x, pos.y + 2, pos.z);
        
        // Random velocities
        const vx = (Math.random() - 0.5) * 0.2;
        const vy = Math.random() * 0.3;
        const vz = (Math.random() - 0.5) * 0.2;
        
        p.userData = { vx, vy, vz, life: 1.0 };
        group.add(p);
    }
    
    scene.add(group);
    
    const start = performance.now();
    function animateParticles(time) {
        let allDead = true;
        group.children.forEach(p => {
            const ud = p.userData;
            if (ud.life > 0) {
                p.position.x += ud.vx;
                p.position.y += ud.vy;
                p.position.z += ud.vz;
                ud.vy -= 0.01; // gravity
                ud.life -= 0.02;
                p.scale.set(ud.life, ud.life, ud.life);
                allDead = false;
            }
        });
        
        if (!allDead) {
            requestAnimationFrame(animateParticles);
        } else {
            scene.remove(group);
        }
    }
    requestAnimationFrame(animateParticles);
}

function updateGoats(delta, time) {
    const size = 60;
    
    goats.forEach(goat => {
        const ud = goat.userData;
        if (!ud) return;
        ud.stateTime -= delta;
        
        // 1. State Switching
        if (ud.stateTime <= 0) {
            if (ud.state === 'idle') {
                ud.state = 'wandering';
                ud.stateTime = 3 + Math.random() * 5;
                ud.targetRot = Math.random() * Math.PI * 2;
                ud.vx = Math.sin(ud.targetRot) * ud.moveSpeed;
                ud.vz = Math.cos(ud.targetRot) * ud.moveSpeed;
            } else {
                ud.state = 'idle';
                ud.stateTime = 2 + Math.random() * 4;
                ud.vx = 0;
                ud.vz = 0;
            }
        }
        
        // 2. Rotation Interpolation
        goat.rotation.y = THREE.MathUtils.lerp(goat.rotation.y, ud.targetRot, delta * 3);
        
        // 3. Horizontal Movement
        if (ud.state === 'wandering') {
            const nextX = goat.position.x + ud.vx * delta;
            const nextZ = goat.position.z + ud.vz * delta;
            
            // Map boundaries check
            if (Math.abs(nextX) < size/2 - 1 && Math.abs(nextZ) < size/2 - 1) {
                goat.position.x = nextX;
                goat.position.z = nextZ;
            } else {
                ud.stateTime = 0; // Force idle/new direction
            }
        }
        
        // 4. Gravity & Terrain Snapping
        const gridX = Math.round(goat.position.x);
        const gridZ = Math.round(goat.position.z);
        const terrainY = terrainHeights.get(`${gridX},${gridZ}`) || 0;
        
        // Jump logic if blocked by small bump
        const forwardX = Math.round(goat.position.x + Math.sin(goat.rotation.y) * 0.8);
        const forwardZ = Math.round(goat.position.z + Math.cos(goat.rotation.y) * 0.8);
        const forwardY = terrainHeights.get(`${forwardX},${forwardZ}`) || 0;
        
        if (forwardY > terrainY && !ud.isJumping && ud.state === 'wandering') {
            ud.vy = 5.5; // Jump power
            ud.isJumping = true;
        }
        
        // Apply vertical velocity
        goat.position.y += ud.vy * delta;
        ud.vy -= 15 * delta; // Gravity
        
        if (goat.position.y < terrainY) {
            goat.position.y = terrainY;
            ud.vy = 0;
            ud.isJumping = false;
        }
        
        // Tiny legs animation
        if (ud.state === 'wandering') {
            const walkCycle = Math.sin(time * 12) * 0.2;
            // Leg indices 4, 5, 6, 7
            for(let i=4; i<8; i++) {
                if (goat.children[i]) {
                    goat.children[i].rotation.x = i % 2 === 0 ? walkCycle : -walkCycle;
                }
            }
        } else {
            for(let i=4; i<8; i++) {
                if (goat.children[i]) goat.children[i].rotation.x = 0;
            }
        }
    });
}
