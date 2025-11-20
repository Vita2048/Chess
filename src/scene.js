import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initInput } from './input.js';

export let scene, camera, renderer, controls;
export const pieces = {};
export const boardSquares = {};

export let boardY = 0;
export let pieceYOffset = 0;
export let boardMesh = null;
export let stepFile = 1.0;
export let stepRank = 1.0;

let boardCenter = new THREE.Vector3();

export function initGame() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 12, 12);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    document.getElementById('app').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2;

    const loader = new GLTFLoader();
    loader.load('./models/chess-set_FULL.glb', function (gltf) {
        const model = gltf.scene;

        // === CRUCIAL FIX: Correct the 45° rotation from Blender ===
        model.rotation.y = THREE.MathUtils.degToRad(-45);  // Counter-rotate
        model.updateMatrixWorld();

        // Scale (you can tweak this value)
        model.scale.set(20, 20, 20);

        // Optional: move model down a bit if it's floating
        // model.position.y = -1;

        scene.add(model);

        // Enable shadows
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Fix board material (keep texture but make it bright/unlit)
                if (child.name.toLowerCase().includes('plane') || child.name === 'pPlane1') {
                    boardMesh = child;
                    const tex = child.material.map;
                    child.material = new THREE.MeshBasicMaterial({
                        map: tex,
                        side: THREE.DoubleSide
                    });
                    child.material.needsUpdate = true;

                    // Get board Y level
                    const worldPos = new THREE.Vector3();
                    child.getWorldPosition(worldPos);
                    boardY = worldPos.y;
                    boardCenter.copy(worldPos);
                }
            }
        });

        // === Parse pieces (same logic, but more robust) ===
        let piecesFound = 0;
        model.traverse((child) => {
            if (!child.isMesh || !child.name) return;

            const name = child.name.trim();

            // Special case for white queen
            if (name === 'Mesh016') {
                child.userData = { square: 'd1', color: 'w', type: 'q' };
                pieces['d1'] = child;
                piecesFound++;
                return;
            }

            const parts = name.split('_');
            if (parts.length < 3) return;

            let colorStr, pieceStr, square;
            if (parts[0].toLowerCase() === 'white' || parts[0].toLowerCase() === 'black') {
                colorStr = parts[0];
                pieceStr = parts[1];
                square = parts[2].toLowerCase();
            } else if (parts[1] && (parts[1].toLowerCase() === 'white' || parts[1].toLowerCase() === 'black')) {
                colorStr = parts[1];
                pieceStr = parts[0];
                square = parts[2].toLowerCase();
            } else {
                return;
            }

            const color = colorStr.toLowerCase() === 'white' ? 'w' : 'b';
            const lower = pieceStr.toLowerCase();
            const typeMap = { pawn: 'p', rook: 'r', knight: 'n', bishop: 'b', queen: 'q', king: 'k' };
            const type = typeMap[lower];
            if (!type) return;

            child.userData = { square, color, type };
            pieces[square] = child;
            piecesFound++;

            // Store world position
            const pos = new THREE.Vector3();
            child.getWorldPosition(pos);
            boardSquares[square] = pos.clone();
        });

        console.log(`Found ${piecesFound} chess pieces`);

        // === Calibrate board grid using corner pieces ===
        calibrateBoardGrid();

        // === Lighting ===
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambient);

scene.add(new THREE.AmbientLight(0xffffff, 0.9));

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
        keyLight.position.set(boardCenter.x + 6, boardCenter.y + 15, boardCenter.z + 10);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 50;
        keyLight.shadow.camera.left = -15;
        keyLight.shadow.camera.right = 15;
        keyLight.shadow.camera.top = 15;
        keyLight.shadow.camera.bottom = -15;
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
        fillLight.position.set(boardCenter.x - 8, boardCenter.y + 12, boardCenter.z - 8);
        scene.add(fillLight);

        const topLight = new THREE.DirectionalLight(0xffffff, 0.6);
        topLight.position.set(boardCenter.x, boardCenter.y + 25, boardCenter.z);
        scene.add(topLight);

        const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
        rimLight.position.set(boardCenter.x + 5, boardCenter.y + 10, boardCenter.z - 15);
        scene.add(rimLight);

        // === Final camera positioning ===
        camera.position.set(boardCenter.x, boardCenter.y + 12, boardCenter.z + 12);
        camera.lookAt(boardCenter);
        controls.target.copy(boardCenter);
        controls.update();

        initInput(camera, scene);
        animate();

    }, undefined, (error) => {
        console.error('GLTF load error:', error);
    });
}

function calibrateBoardGrid() {
    const corners = ['a1', 'h1', 'a8', 'h8'].map(sq => pieces[sq]);
    if (corners.some(p => !p)) {
        console.error("Missing corner pieces for grid calibration!");
        return;
    }

    const pos = (sq) => {
        const v = new THREE.Vector3();
        pieces[sq].getWorldPosition(v);
        return v;
    };

    const a1 = pos('a1');
    const h1 = pos('h1');
    const a8 = pos('a8');

    // File direction: a1 → h1
    const fileVec = new THREE.Vector3().subVectors(h1, a1).multiplyScalar(1/7);
    stepFile = fileVec.length();

    // Rank direction: a1 → a8
    const rankVec = new THREE.Vector3().subVectors(a8, a1).multiplyScalar(1/7);
    stepRank = rankVec.length();

    const files = ['a','b','c','d','e','f','g','h'];
    for (let f = 0; f < 8; f++) {
        for (let r = 1; r <= 8; r++) {
            const sq = files[f] + r;
            const offset = fileVec.clone().multiplyScalar(f).add(rankVec.clone().multiplyScalar(r-1));
            const worldPos = a1.clone().add(offset);
            worldPos.y = boardY; // snap to board height
            boardSquares[sq] = worldPos;
        }
    }

    // Calculate piece Y offset (for smooth movement later)
    if (pieces['a2']) {
        const p = new THREE.Vector3();
        pieces['a2'].getWorldPosition(p);
        pieceYOffset = p.y - boardY;
    }

    console.log("Board grid calibrated successfully");
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
