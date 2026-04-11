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
let socket, myUserId;
const avatars = {}; // Maps user_id to Three.js Object3D
const avatarMeta = {}; // Stores metadata (gender, isMoving, etc)
const targetPositions = {}; // For smooth interpolation
const clock = new THREE.Clock();

// UI Elements
const connectionOverlay = document.getElementById('connection-overlay');
const usernameDisplay = document.getElementById('username-display');
const statusIndicator = document.querySelector('.status-indicator');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const fileUploadBtn = document.getElementById('file-upload-btn');
const fileInput = document.getElementById('file-input');
const uploadProgress = document.getElementById('upload-progress');

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
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false
};

// Player State
const playerState = {
    x: 0, y: 1.5, z: 0,
    rotation: 0,
    isMoving: false
};

const MOVE_SPEED = 10.0;

init();
connectWebSocket();
animate();

function init() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07090f, 0.012);

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
    floor.receiveShadow = true;
    scene.add(floor);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    // Hemisphere light for softer shading
    const hemiLight = new THREE.HemisphereLight(0x6699ff, 0x101424, 0.4);
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
        size: 0.1,
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);
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
 * Build a human-like avatar from Three.js primitives
 * @param {string} colorHex - accent/clothing color
 * @param {string} name - display name
 * @param {string} gender - "male" or "female"
 */
function createHumanAvatar(colorHex, name, gender) {
    const group = new THREE.Group();
    const isMale = gender === 'male';

    // Static skin and hair color per user request
    const skinTone = '#ffe0cc'; // Fair white
    const hairColor = '#d63031'; // Rad Red

    const skinMat = createSkinMaterial(skinTone);
    const clothingMat = createClothingMaterial(colorHex);
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8, metalness: 0 });
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const irisMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), emissive: new THREE.Color(colorHex), emissiveIntensity: 0.3, roughness: 0.2 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });

    // === HEAD ===
    const headGeo = new THREE.SphereGeometry(0.32, 24, 24);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 2.42;
    head.castShadow = true;
    group.add(head);

    // === EYES (on head) ===
    const eyeGeo = new THREE.SphereGeometry(0.06, 12, 12);
    const irisGeo = new THREE.SphereGeometry(0.035, 10, 10);
    const pupilGeo = new THREE.SphereGeometry(0.018, 8, 8);

    // Left eye
    const leftEyeWhite = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    leftEyeWhite.position.set(-0.12, 2.45, 0.26);
    group.add(leftEyeWhite);

    const leftIris = new THREE.Mesh(irisGeo, irisMat);
    leftIris.position.set(-0.12, 2.45, 0.30);
    group.add(leftIris);

    const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
    leftPupil.position.set(-0.12, 2.45, 0.32);
    group.add(leftPupil);

    // Right eye
    const rightEyeWhite = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    rightEyeWhite.position.set(0.12, 2.45, 0.26);
    group.add(rightEyeWhite);

    const rightIris = new THREE.Mesh(irisGeo, irisMat);
    rightIris.position.set(0.12, 2.45, 0.30);
    group.add(rightIris);

    const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
    rightPupil.position.set(0.12, 2.45, 0.32);
    group.add(rightPupil);

    // === MOUTH (simple arc) ===
    const mouthGeo = new THREE.TorusGeometry(0.06, 0.012, 8, 12, Math.PI);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0xcc6666, roughness: 0.5 });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, 2.35, 0.28);
    mouth.rotation.x = Math.PI;
    group.add(mouth);

    // === HAIR ===
    if (isMale) {
        // Refined Male Hair (Textured short cut with quiff)
        const hairBaseGeo = new THREE.SphereGeometry(0.34, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
        const hairBase = new THREE.Mesh(hairBaseGeo, hairMat);
        hairBase.position.y = 2.44;
        hairBase.castShadow = true;
        group.add(hairBase);

        // Front Quiff / Spikes
        const quiffGeo = new THREE.CapsuleGeometry(0.08, 0.2, 8, 8);
        
        const quiff1 = new THREE.Mesh(quiffGeo, hairMat);
        quiff1.position.set(0, 2.73, 0.22);
        quiff1.rotation.x = Math.PI / 3.5;
        quiff1.castShadow = true;
        group.add(quiff1);

        const quiff2 = new THREE.Mesh(quiffGeo, hairMat);
        quiff2.position.set(-0.14, 2.68, 0.18);
        quiff2.rotation.x = Math.PI / 3.5;
        quiff2.rotation.z = 0.2;
        quiff2.castShadow = true;
        group.add(quiff2);

        const quiff3 = new THREE.Mesh(quiffGeo, hairMat);
        quiff3.position.set(0.14, 2.68, 0.18);
        quiff3.rotation.x = Math.PI / 3.5;
        quiff3.rotation.z = -0.2;
        quiff3.castShadow = true;
        group.add(quiff3);

        // Texturized Sideburns
        const sideburnGeo = new THREE.CapsuleGeometry(0.04, 0.12, 4, 8);
        
        const leftBurn = new THREE.Mesh(sideburnGeo, hairMat);
        leftBurn.position.set(-0.32, 2.38, 0.05);
        leftBurn.rotation.z = 0.1;
        leftBurn.castShadow = true;
        group.add(leftBurn);

        const rightBurn = new THREE.Mesh(sideburnGeo, hairMat);
        rightBurn.position.set(0.32, 2.38, 0.05);
        rightBurn.rotation.z = -0.1;
        rightBurn.castShadow = true;
        group.add(rightBurn);
    } else {
        // Refined Long Flowing Hair
        const hairTopGeo = new THREE.SphereGeometry(0.36, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
        const hairTop = new THREE.Mesh(hairTopGeo, hairMat);
        hairTop.position.y = 2.44;
        hairTop.castShadow = true;
        group.add(hairTop);

        // Long Back Hair Drape (a flattened, elongated sphere for volume)
        const backHairGeo = new THREE.SphereGeometry(0.34, 24, 24);
        const backHair = new THREE.Mesh(backHairGeo, hairMat);
        backHair.scale.set(1.0, 1.6, 0.6); // Stretch downwards and flatten depth
        backHair.position.set(0, 2.0, -0.2);
        backHair.castShadow = true;
        group.add(backHair);

        // Front Side Strands / Locks falling past shoulders
        const sideLockGeo = new THREE.CapsuleGeometry(0.08, 0.45, 8, 12);
        
        const leftLock = new THREE.Mesh(sideLockGeo, hairMat);
        leftLock.position.set(-0.3, 2.05, 0.08);
        leftLock.rotation.z = 0.15;
        leftLock.rotation.x = -0.1;
        leftLock.castShadow = true;
        group.add(leftLock);

        const rightLock = new THREE.Mesh(sideLockGeo, hairMat);
        rightLock.position.set(0.3, 2.05, 0.08);
        rightLock.rotation.z = -0.15;
        rightLock.rotation.x = -0.1;
        rightLock.castShadow = true;
        group.add(rightLock);
    }

    // === NECK ===
    const neckGeo = new THREE.CylinderGeometry(0.08, 0.10, 0.14, 12);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 2.05;
    group.add(neck);

    // === TORSO ===
    const torsoWidth = isMale ? 0.52 : 0.42;
    const torsoDepth = isMale ? 0.26 : 0.22;
    const torsoGeo = new THREE.BoxGeometry(torsoWidth, 0.6, torsoDepth);
    // Round the torso edges slightly
    const torso = new THREE.Mesh(torsoGeo, clothingMat);
    torso.position.y = 1.68;
    torso.castShadow = true;
    group.add(torso);

    // Torso detail — collar line
    const collarGeo = new THREE.TorusGeometry(0.12, 0.015, 8, 16, Math.PI);
    const collarMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.set(0, 1.96, 0.10);
    collar.rotation.x = -Math.PI * 0.5;
    group.add(collar);

    // === HIPS / LOWER BODY ===
    const hipWidth = isMale ? 0.44 : 0.46;
    const hipGeo = new THREE.BoxGeometry(hipWidth, 0.3, torsoDepth);
    const hipMat = new THREE.MeshStandardMaterial({
        color: isMale ? 0x2a2a3e : 0x3a2a3e,
        roughness: 0.5
    });
    const hips = new THREE.Mesh(hipGeo, hipMat);
    hips.position.y = 1.23;
    hips.castShadow = true;
    group.add(hips);

    // === ARMS ===
    const armLength = 0.48;
    const armRadius = isMale ? 0.065 : 0.055;
    const armGeo = new THREE.CylinderGeometry(armRadius * 0.9, armRadius, armLength, 10);

    // Forearm (skin) and upper arm (clothing)
    const armOffsetX = torsoWidth / 2 + armRadius + 0.02;

    // Left arm group
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-armOffsetX, 1.92, 0);
    const leftArm = new THREE.Mesh(armGeo, clothingMat);
    leftArm.position.y = -armLength / 2;
    leftArm.castShadow = true;
    leftArmPivot.add(leftArm);

    // Left hand
    const handGeo = new THREE.SphereGeometry(armRadius * 1.1, 10, 10);
    const leftHand = new THREE.Mesh(handGeo, skinMat);
    leftHand.position.y = -armLength;
    leftArmPivot.add(leftHand);

    group.add(leftArmPivot);

    // Right arm group
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(armOffsetX, 1.92, 0);
    const rightArm = new THREE.Mesh(armGeo, clothingMat);
    rightArm.position.y = -armLength / 2;
    rightArm.castShadow = true;
    rightArmPivot.add(rightArm);

    const rightHand = new THREE.Mesh(handGeo, skinMat);
    rightHand.position.y = -armLength;
    rightArmPivot.add(rightHand);

    group.add(rightArmPivot);

    // === LEGS ===
    const legLength = 0.55;
    const legRadius = isMale ? 0.075 : 0.065;
    const legGeo = new THREE.CylinderGeometry(legRadius, legRadius * 0.85, legLength, 10);
    const legOffsetX = isMale ? 0.12 : 0.11;

    // Left leg pivot
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-legOffsetX, 1.08, 0);
    const leftLeg = new THREE.Mesh(legGeo, hipMat);
    leftLeg.position.y = -legLength / 2;
    leftLeg.castShadow = true;
    leftLegPivot.add(leftLeg);

    // Left shoe
    const shoeGeo = new THREE.BoxGeometry(0.12, 0.08, 0.2);
    const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
    leftShoe.position.set(0, -legLength - 0.01, 0.03);
    leftLegPivot.add(leftShoe);

    group.add(leftLegPivot);

    // Right leg pivot
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(legOffsetX, 1.08, 0);
    const rightLeg = new THREE.Mesh(legGeo, hipMat);
    rightLeg.position.y = -legLength / 2;
    rightLeg.castShadow = true;
    rightLegPivot.add(rightLeg);

    const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
    rightShoe.position.set(0, -legLength - 0.01, 0.03);
    rightLegPivot.add(rightShoe);

    group.add(rightLegPivot);

    // === GLOW RING (under feet) ===
    const ringGeo = new THREE.TorusGeometry(0.5, 0.02, 16, 64);
    const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex),
        transparent: true,
        opacity: 0.4
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    // === POINT LIGHT (accent glow) ===
    const light = new THREE.PointLight(new THREE.Color(colorHex), 1.5, 4);
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
    const walkSpeed = 8;

    if (isMoving) {
        ud.walkPhase += delta * walkSpeed;

        // Leg swing
        const legSwing = Math.sin(ud.walkPhase) * 0.6;
        ud.leftLegPivot.rotation.x = legSwing;
        ud.rightLegPivot.rotation.x = -legSwing;

        // Arm swing (opposite to legs)
        ud.leftArmPivot.rotation.x = -legSwing * 0.5;
        ud.rightArmPivot.rotation.x = legSwing * 0.5;

        // Slight torso bob
        ud.torso.position.y = 1.68 + Math.abs(Math.sin(ud.walkPhase * 2)) * 0.02;
        ud.head.position.y = 2.42 + Math.abs(Math.sin(ud.walkPhase * 2)) * 0.02;
    } else {
        // Idle animation — subtle breathing + gentle sway
        ud.walkPhase = 0;

        // Breathing — subtle torso scale
        const breathe = 1 + Math.sin(t * 1.5) * 0.008;
        ud.torso.scale.set(1, breathe, 1);

        // Gentle arm sway
        ud.leftArmPivot.rotation.x = Math.sin(t * 0.8) * 0.04;
        ud.rightArmPivot.rotation.x = Math.sin(t * 0.8 + 0.5) * 0.04;
        ud.leftArmPivot.rotation.z = Math.sin(t * 0.5) * 0.02;
        ud.rightArmPivot.rotation.z = -Math.sin(t * 0.5) * 0.02;

        // Reset legs to neutral
        ud.leftLegPivot.rotation.x = THREE.MathUtils.lerp(ud.leftLegPivot.rotation.x, 0, delta * 6);
        ud.rightLegPivot.rotation.x = THREE.MathUtils.lerp(ud.rightLegPivot.rotation.x, 0, delta * 6);

        // Reset torso position
        ud.torso.position.y = THREE.MathUtils.lerp(ud.torso.position.y, 1.68, delta * 4);
        ud.head.position.y = THREE.MathUtils.lerp(ud.head.position.y, 2.42, delta * 4);
    }

    // Ring pulse (always)
    ud.ring.material.opacity = 0.25 + Math.sin(t * 2) * 0.15;
    ud.ring.rotation.z += delta * 0.5;

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
        usernameDisplay.textContent = "Disconnected - Retrying...";
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
                    usernameDisplay.textContent = updatedName;
                    controls.target = newAvatar.position;
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
    if (document.activeElement === chatInput) return;
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
        playerState.rotation = Math.atan2(direction.x, direction.z);
        moved = true;
    }

    playerState.isMoving = moved;

    if (moved) {
        const me = avatars[myUserId];
        me.position.x = playerState.x;
        me.position.z = playerState.z;
        me.rotation.y = THREE.MathUtils.lerp(me.rotation.y, playerState.rotation, 0.1);
        controls.target.copy(me.position);
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

    // Animate all avatars
    for (const [id, avatar] of Object.entries(avatars)) {
        const isMoving = id === myUserId ? playerState.isMoving : (avatarMeta[id]?.isMoving || false);
        animateAvatar(avatar, time, delta, isMoving);

        // Interpolate other players' positions
        if (id !== myUserId && targetPositions[id]) {
            const target = targetPositions[id];
            avatar.position.x = THREE.MathUtils.lerp(avatar.position.x, target.x, delta * 10);
            avatar.position.z = THREE.MathUtils.lerp(avatar.position.z, target.z, delta * 10);

            let rotDiff = target.rotation - avatar.rotation.y;
            rotDiff = (rotDiff + Math.PI) % (Math.PI * 2) - Math.PI;
            avatar.rotation.y += rotDiff * delta * 10;
        }
    }

    renderer.render(scene, camera);
}
