import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.154.0/examples/jsm/controls/OrbitControls.js';

console.log("🚀 Oracle Racing 4.0: Script Loading...");

// ==========================================
// GAME CONFIG & STATE
// ==========================================
const MQTT_BROKER = 'wss://dustboy-wss-bridge.laris.workers.dev/mqtt';
const TOPIC_BASE = 'oracle/race/';
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
let scene, camera, renderer, controls, grid, fallbackCube;

try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827); // Dark theme
    scene.fog = new THREE.Fog(0x111827, 20, 100);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 4, 15);
    camera.lookAt(0, 2, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    canvas.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2, 0);
    controls.update();

    // Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(0, 20, 10);
    scene.add(dirLight);

    console.log("Oracle Racing: 3D Engine Started");

    // Floor Grid
    grid = new THREE.GridHelper(200, 40, 0xffffff, 0x444444);
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    scene.add(grid);

    const floorGeometry = new THREE.PlaneGeometry(200, 200);
    const floorMaterial = new THREE.MeshPhongMaterial({ color: 0x1e293b, depthWrite: false });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Fallback Cube
    const fallbackGeo = new THREE.BoxGeometry(1, 1, 1);
    const fallbackMat = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    fallbackCube = new THREE.Mesh(fallbackGeo, fallbackMat);
    fallbackCube.position.y = 0.5;
    scene.add(fallbackCube);

} catch (e) {
    console.error("WebGL Initialization failed:", e);
    // UI Fallback
    canvas.innerHTML = "<div style='color:white;text-align:center;padding-top:20%;'>⚠️ 3D Render Error: กรุณาเปิด WebGL หรือเปลี่ยนเบราว์เซอร์</div>";
}

// Animal Model Setup
let mixer;
let playerModel;
let selectedAnimal = 'horse';
const actions = {};

const ANIMAL_CONFIG = {
    horse: {
        url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/Horse.glb',
        scale: 0.012,
        y: 0
    },
    flamingo: {
        url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/Flamingo.glb',
        scale: 0.015,
        y: 3
    },
    stork: {
        url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/Stork.glb',
        scale: 0.015,
        y: 3
    },
    parrot: {
        url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/Parrot.glb',
        scale: 0.015,
        y: 3
    }
};

const loader = new GLTFLoader();

function loadAnimal(animalType) {
    if (!scene) {
        console.warn("Scene is not initialized, skipping model loading.");
        document.getElementById('hof-name').textContent = '⚠️ รุ่นจำลองไม่สามารถโหลดได้';
        return;
    }

    if (playerModel) scene.remove(playerModel);
    if (mixer) mixer.stopAllAction();

    const config = ANIMAL_CONFIG[animalType];
    loader.load(config.url, (gltf) => {
        console.log(`${animalType} model loaded successfully`);
        playerModel = gltf.scene;
        playerModel.scale.set(config.scale, config.scale, config.scale);
        playerModel.position.set(0, config.y, 0);
        scene.add(playerModel);

        if (fallbackCube) scene.remove(fallbackCube);

        mixer = new THREE.AnimationMixer(playerModel);
        const clip = gltf.animations[0];
        const action = mixer.clipAction(clip);
        actions['run'] = action;
        action.play();
        action.paused = true;

        const hofEl = document.getElementById('hof-name');
        if (hofEl && hofEl.textContent === 'กำลังตรวจสอบข้อมูล...') {
            hofEl.textContent = 'พร้อมซิ่งแล้ว!';
        }
    }, (xhr) => {
        const percent = (xhr.loaded / xhr.total) * 100;
        console.log(`Loading ${animalType}: ${Math.round(percent)}%`);
    }, (error) => {
        console.error(`Error loading ${animalType}:`, error);
        document.getElementById('hof-name').textContent = 'โหลดโมเดลไม่สำเร็จ';
    });
}

// Initial load
loadAnimal('horse');

// UI Selection Logic
document.querySelectorAll('.animal-option').forEach(option => {
    option.addEventListener('click', () => {
        document.querySelectorAll('.animal-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        selectedAnimal = option.dataset.animal;
        loadAnimal(selectedAnimal);
    });
});

// Window resize handler
window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});

// Render Loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (mixer) {
        mixer.update(dt);

        // Animal Animation logic
        if (isRacing && (Date.now() - lastSpacePress < 300) && actions['run']) {
            actions['run'].paused = false;
            // Move grid texture to simulate running effect
            if (grid) {
                grid.position.z += 12 * dt;
                if (grid.position.z > 5) grid.position.z = 0;
            }
        } else if (actions['run']) {
            actions['run'].paused = true;
        }
    }

    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}
animate();

// ==========================================
// MQTT & NETWORK LOGIC
// ==========================================
console.log("MQTT Initializing...");
let client = null;
let mqttConnected = false;

if (typeof mqtt === 'undefined') {
    console.error("MQTT library NOT loaded! Playing in OFFLINE mode.");
    document.getElementById('hof-name').textContent = "⚠️ เล่นโหมดออฟไลน์ (MQTT Missing)";
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
        statusEl.textContent = '🔴 ออฟไลน์';
        statusEl.className = 'status-badge offline';
    }
} else {
    try {
        client = mqtt.connect(MQTT_BROKER);

        // Connection Timeout Fallback
        setTimeout(() => {
            if (!mqttConnected) {
                console.error("MQTT Connection Timeout (5s)");
                const titleEl = document.getElementById('hof-name');
                if (titleEl) titleEl.textContent = '❌ ชะงัก: เชื่อมโยงสนามประลองไม่สำเร็จ (ออฟไลน์)';

                const statusEl = document.getElementById('connection-status');
                if (statusEl) {
                    statusEl.textContent = '🔴 ออฟไลน์';
                    statusEl.className = 'status-badge offline';
                }
            }
        }, 5000);

        client.on('connect', () => {
            mqttConnected = true;
            console.log("MQTT Connected!");
            const statusEl = document.getElementById('connection-status');
            if (statusEl) {
                statusEl.textContent = '🟢 ออนไลน์';
                statusEl.className = 'status-badge connected';
            }
            client.subscribe(TOPIC_POS + '+');
            client.subscribe(TOPIC_HOF);
        });


        client.on('error', (err) => {
            console.error('MQTT Connection Error:', err);
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
                try {
                    const data = JSON.parse(payload);
                    const score = data.score;
                    const animal = data.animal || 'horse';

                    if (player !== myName) {
                        opponents[player] = { score, animal };
                        updateTracks();

                        // Checking if opponent won
                        if (score >= WIN_SCORE && isRacing) {
                            handleGameOver(player);
                        }
                    }
                } catch (e) {
                    // Fallback for old simple payloads
                    const score = parseInt(payload, 10);
                    if (player !== myName) {
                        opponents[player] = { score, animal: 'horse' };
                        updateTracks();
                    }
                }
            }
        });
    } catch (e) {
        console.error("Failed to setup MQTT:", e);
    }
}

// ==========================================
// GAMEPLAY LOGIC 
// ==========================================

const EMOJI_MAP = {
    horse: '🐎',
    flamingo: '🦩',
    stork: '🦢',
    parrot: '🦜'
};

function updateTracks() {
    const container = document.getElementById('tracks-container');
    container.innerHTML = '';

    // Create an array to sort by score (highest on top)
    const racers = [{ name: myName, score: myProgress, animal: selectedAnimal, isMe: true }];
    for (const [name, data] of Object.entries(opponents)) {
        racers.push({ name, score: data.score, animal: data.animal, isMe: false });
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

        const emoji = EMOJI_MAP[r.animal] || '❓';
        marker.textContent = `${emoji} ${r.name}${r.isMe ? ' (You)' : ''}`;

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

    // Send update to others with animal type
    if (client && mqttConnected) {
        client.publish(TOPIC_POS + myName, JSON.stringify({
            score: myProgress,
            animal: selectedAnimal
        }));
    }
    updateTracks();

    // Did I win?
    if (myProgress >= WIN_SCORE) {
        handleGameOver(myName);
        if (client && mqttConnected) client.publish(TOPIC_HOF, myName, { retain: true });
    }
}

function handleGameOver(winnerName) {
    isRacing = false;
    document.getElementById('winner-name').textContent = '🏆 ' + winnerName + ' WINS!';
    document.getElementById('victory-modal').classList.remove('hidden');
}

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
    if (client && mqttConnected) {
        client.publish(TOPIC_POS + myName, JSON.stringify({
            score: 0,
            animal: selectedAnimal
        }));
    }
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
