import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/controls/OrbitControls.js';

// ==========================================
// GAME CONFIG & STATE
// ==========================================
const MQTT_BROKER = 'wss://broker.hivemq.com:8000/mqtt';
const TOPIC_BASE = 'oracle-racer/';
const TOPIC_POS = TOPIC_BASE + 'pos/';
const TOPIC_HOF = TOPIC_BASE + 'hof';
const WIN_SCORE = 100;

let myName = '';
let myProgress = 0;
let isRacing = false;
let opponents = {}; // { username: score }
let lastSpacePress = 0;

// ==========================================
// 3D GRAPHICS SETUP (Three.js)
// ==========================================
const canvas = document.getElementById('game-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111827); // Dark theme
scene.fog = new THREE.Fog(0x111827, 20, 100);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 4, 15);
camera.lookAt(0, 2, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
canvas.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.update();

// Lighting
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(0, 20, 10);
scene.add(dirLight);

// Floor Grid
const grid = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
grid.material.opacity = 0.2;
grid.material.transparent = true;
scene.add(grid);

const floorGeometry = new THREE.PlaneGeometry(200, 200);
const floorMaterial = new THREE.MeshPhongMaterial({ color: 0x1e293b, depthWrite: false });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Cube Character Setup
let cubeCharacter;
const cubeGroup = new THREE.Group();

function createCubeCharacter() {
    // Body
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x6366f1 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1;
    cubeGroup.add(body);

    // Head
    const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const headMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.9;
    cubeGroup.add(head);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.15, 2, 0.3);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.15, 2, 0.3);
    cubeGroup.add(leftEye, rightEye);

    scene.add(cubeGroup);
    return cubeGroup;
}

cubeCharacter = createCubeCharacter();

// Window resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Render Loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    const dt = clock.getDelta();

    // Cube Animation logic
    if (isRacing) {
        if (Date.now() - lastSpacePress < 300) {
            // Running: Jump and wiggle
            cubeGroup.position.y = Math.abs(Math.sin(time * 15)) * 0.5;
            cubeGroup.rotation.z = Math.sin(time * 15) * 0.1;

            // Move grid texture to simulate running effect
            grid.position.z += 8 * dt;
            if (grid.position.z > 5) grid.position.z = 0;
        } else {
            // Idle: Gentle hover
            cubeGroup.position.y = Math.sin(time * 2) * 0.1;
            cubeGroup.rotation.z = 0;
        }
    } else {
        // Not racing: Idle
        cubeGroup.position.y = Math.sin(time * 2) * 0.1;
    }

    controls.update();
    renderer.render(scene, camera);
}
animate();

// ==========================================
// MQTT & NETWORK LOGIC
// ==========================================
// using global mqtt from CDN script in HTML
const client = mqtt.connect(MQTT_BROKER);

client.on('connect', () => {
    const statusEl = document.getElementById('connection-status');
    statusEl.textContent = '🟢 ออนไลน์';
    statusEl.className = 'status-badge connected';

    client.subscribe(TOPIC_POS + '+');
    client.subscribe(TOPIC_HOF);
});

client.on('message', (topic, message) => {
    const payload = message.toString();

    // 1. Hall of Fame Update
    if (topic === TOPIC_HOF) {
        document.getElementById('hof-name').textContent = payload;
        return;
    }

    // 2. Position Updates
    if (topic.startsWith(TOPIC_POS)) {
        const player = topic.split('/').pop();
        const score = parseInt(payload, 10);

        if (player !== myName) {
            opponents[player] = score;
            updateTracks();

            // Checking if opponent won
            if (score >= WIN_SCORE && isRacing) {
                handleGameOver(player);
            }
        }
    }
});

// ==========================================
// GAMEPLAY LOGIC 
// ==========================================

function updateTracks() {
    const container = document.getElementById('tracks-container');
    container.innerHTML = '';

    // Create an array to sort by score (highest on top)
    const racers = [{ name: myName, score: myProgress, isMe: true }];
    for (const [name, score] of Object.entries(opponents)) {
        racers.push({ name, score, isMe: false });
    }

    // Keep top 5 or just show all
    racers.sort((a, b) => b.score - a.score);

    racers.forEach(r => {
        const perc = Math.min(100, Math.max(0, (r.score / WIN_SCORE) * 100));

        const lane = document.createElement('div');
        lane.className = r.isMe ? 'track-lane is-me' : 'track-lane';

        const progress = document.createElement('div');
        progress.className = 'track-progress';
        progress.style.width = perc + '%';

        const marker = document.createElement('div');
        marker.className = 'track-racer';
        marker.style.left = perc + '%';
        marker.textContent = r.name + (r.isMe ? ' (You)' : '');

        lane.appendChild(progress);
        lane.appendChild(marker);
        container.appendChild(lane);
    });
}

function handleSpacePress() {
    if (!isRacing) return;

    myProgress += 2; // +2 per keystroke (50 taps to win)
    if (myProgress > WIN_SCORE) myProgress = WIN_SCORE;

    lastSpacePress = Date.now();
    // Animation handled in animate() loop based on lastSpacePress

    // Send update to others
    client.publish(TOPIC_POS + myName, myProgress.toString());
    updateTracks();

    // Did I win?
    if (myProgress >= WIN_SCORE) {
        handleGameOver(myName);
        // Write to HOF with retain!
        client.publish(TOPIC_HOF, myName, { retain: true });
    }
}

isRacing = false;
document.getElementById('winner-name').textContent = '🏆 ' + winnerName + ' WINS!';
document.getElementById('victory-modal').classList.remove('hidden');

// ==========================================
// UI EVENTS
// ==========================================

document.getElementById('join-btn').addEventListener('click', () => {
    const input = document.getElementById('player-name').value.trim();
    if (!input) return alert('กรุณาตั้งชื่อของท่าน');

    myName = input;
    myProgress = 0;
    opponents = {};
    isRacing = true;

    // Transition UI
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('race-screen').classList.remove('hidden');
    document.getElementById('victory-modal').classList.add('hidden');

    // Announce start pos
    client.publish(TOPIC_POS + myName, "0");
    updateTracks();
});

document.getElementById('restart-btn').addEventListener('click', () => {
    // Hide race, show login again
    document.getElementById('race-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    isRacing = false;
    myProgress = 0;
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && isRacing) {
        e.preventDefault(); // Prevent scrolling
        handleSpacePress();
    }
});
