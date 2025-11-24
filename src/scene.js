import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initInput, updateInput } from './input.js';

export let scene, camera, renderer, controls;
export const pieces = {};
export const boardSquares = {};
export const pieceTemplates = {};

// Debugging
window.pieces = pieces;
window.boardSquares = boardSquares;
window.pieceTemplates = pieceTemplates;

export let boardY = 0;
export let pieceYOffset = 0;
export let boardMesh = null;
export let stepFile = 1.0;
export let stepRank = 1.0;

// Video plane for chroma key effect
export let videoPlane = null;
export let videoTexture = null;

export const BOARD_SCALE = 20;
export const BOARD_ROTATION_Y = -90; // Degrees

export let rankDir = new THREE.Vector3();
export let fileDir = new THREE.Vector3();

let boardCenter = new THREE.Vector3();

function createVideoPlane() {
    const videoElement = document.getElementById('calculation-video');
    if (!videoElement) {
        console.warn('Video element not found');
        return;
    }

    console.log('Video element found:', videoElement);
    console.log('Video src:', videoElement.src);
    console.log('Video readyState:', videoElement.readyState);

    // Create video texture
    videoTexture = new THREE.VideoTexture(videoElement);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.format = THREE.RGBFormat;

    // Temporarily use basic material to test video visibility
    const chromaKeyMaterial = new THREE.MeshBasicMaterial({
        map: videoTexture,
        transparent: false,
        side: THREE.DoubleSide
    });

    /*
    // Chroma key shader material
    const chromaKeyMaterial = new THREE.ShaderMaterial({
        uniforms: {
            videoTexture: { value: videoTexture },
            keyColor: { value: new THREE.Vector3(0.0, 0.0, 0.0) }, // Black
            threshold: { value: 0.4 } // Adjust this value to control how much "black" is removed
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D videoTexture;
            uniform vec3 keyColor;
            uniform float threshold;
            varying vec2 vUv;

            void main() {
                vec4 texColor = texture2D(videoTexture, vUv);

                // Calculate distance from key color (black)
                float dist = distance(texColor.rgb, keyColor);

                // Smooth transition for alpha based on distance
                float alpha = smoothstep(threshold, threshold + 0.1, dist);

                gl_FragColor = vec4(texColor.rgb, alpha);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide
    });
    */

    // Create plane geometry (adjust size to match original video dimensions)
    const planeGeometry = new THREE.PlaneGeometry(8, 4.5); // 16:9 aspect ratio, scaled larger for testing

    // Create mesh
    videoPlane = new THREE.Mesh(planeGeometry, chromaKeyMaterial);

    // Position the plane as an overlay (fixed world position)
    // From default camera position (0,12,12) looking at (0,0,0), this appears as overlay
    videoPlane.position.set(0, 6, 10); // Much closer and more visible
    videoPlane.lookAt(0, 6, 11); // Look slightly forward

    // Initially hide the plane
    videoPlane.visible = false;

    // Add to scene
    scene.add(videoPlane);

    console.log('Video plane created and added to scene');
}

export function initGame() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
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

    // Create video plane with chroma key shader
    createVideoPlane();

    const loader = new GLTFLoader();
    loader.load('./models/ChessSetCorrectQueen.glb', function (gltf) {
        const model = gltf.scene;

        // === CRUCIAL FIX: Correct the 45° rotation from Blender ===
        model.rotation.y = THREE.MathUtils.degToRad(BOARD_ROTATION_Y);  // Counter-rotate
        model.updateMatrixWorld();

        // Scale (you can tweak this value)
        model.scale.set(BOARD_SCALE, BOARD_SCALE, BOARD_SCALE);

        // Optional: move model down a bit if it's floating
        // model.position.y = -1;

        scene.add(model);

        // DEBUG: Log full hierarchy to understand Queen structure
        console.log("=== MODEL HIERARCHY ===");
        model.traverse((child) => {
            console.log(`Name: "${child.name}", Type: ${child.type}, Parent: "${child.parent ? child.parent.name : 'null'}"`);
        });
        console.log("=======================");

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

            // Helper to normalize template with relative transform
            const createTemplate = (key, obj) => {
                if (pieceTemplates[key]) return;

                console.log(`Storing template for ${key}`);

                // === FIX: Normalize Template with Relative Transform ===
                const container = new THREE.Group();
                container.scale.set(BOARD_SCALE, BOARD_SCALE, BOARD_SCALE);
                container.rotation.y = THREE.MathUtils.degToRad(BOARD_ROTATION_Y);

                // Calculate relative transform (Model -> Piece)
                obj.updateMatrixWorld(true);
                model.updateMatrixWorld(true);

                const m1 = model.matrixWorld.clone().invert();
                const m2 = obj.matrixWorld;
                const localToModel = m1.multiply(m2);

                const pos = new THREE.Vector3();
                const quat = new THREE.Quaternion();
                const scale = new THREE.Vector3();
                localToModel.decompose(pos, quat, scale);

                const clone = obj.clone();
                clone.quaternion.copy(quat);
                clone.scale.copy(scale);

                // Reset position temporarily to measure
                clone.position.set(0, 0, 0);

                // CRITICAL FIX: Clear userData from the inner mesh
                clone.userData = {};

                // Update matrix to ensure bounding box is correct in local space
                clone.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(clone);
                const center = new THREE.Vector3();
                box.getCenter(center);

                // Center X and Z, align Bottom Y to 0
                clone.position.x = -center.x;
                clone.position.z = -center.z;
                clone.position.y = -box.min.y;

                container.add(clone);
                pieceTemplates[key] = container;
                console.log(`Template ${key} created. Relative Scale:`, scale, `Offset Fix:`, clone.position);
            };

            // Special case for white queen
            if (name === 'Mesh016') {
                const pieceObject = child.parent && child.parent.type === 'Group' ? child.parent : child;

                pieceObject.userData = { square: 'd1', color: 'w', type: 'q' };
                pieces['d1'] = pieceObject;
                piecesFound++;

                createTemplate('w_q', pieceObject);
                return;
            }

            // Special case for black queen
            if (name === 'Mesh017') {
                child.userData = { square: 'd8', color: 'b', type: 'q' };
                pieces['d8'] = child;
                piecesFound++;

                createTemplate('b_q', child);
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
            } else if (parts[0] && typeMap[parts[0].toLowerCase()] && parts[1] && (parts[1].toLowerCase() === 'white' || parts[1].toLowerCase() === 'black')) {
                pieceStr = parts[0];
                colorStr = parts[1];
                square = parts[2].toLowerCase();
            } else {
                return;
            }

            const color = colorStr.toLowerCase() === 'white' ? 'w' : 'b';
            const lower = pieceStr.toLowerCase();
            const typeMap = { pawn: 'p', rook: 'r', knight: 'n', bishop: 'b', queen: 'q', king: 'k' };
            const type = typeMap[lower];
            if (!type) return;

            // Fix: Use parent group if available (and not the root model) to ensure all sub-meshes are interactive
            const pieceObject = child.parent && child.parent.type === 'Group' && child.parent !== model ? child.parent : child;

            // IMPROVED VISIBILITY: Change material for black pieces
            if (color === 'b') {
                child.material = new THREE.MeshStandardMaterial({
                    color: 0x444444, // Lighter grey instead of black
                    roughness: 0.5,
                    metalness: 0.3
                });
            }

            pieceObject.userData = { square, color, type };
            pieces[square] = pieceObject;
            piecesFound++;

            createTemplate(color + '_' + type, pieceObject);

            // Store world position
            const pos = new THREE.Vector3();
            child.getWorldPosition(pos);
            boardSquares[square] = pos.clone();
        });

        console.log(`Found ${piecesFound} chess pieces`);

        // === Calibrate board grid using corner pieces ===
        calibrateBoardGrid();

        // === Lighting ===
        // Increased ambient light for better overall visibility
        const ambient = new THREE.AmbientLight(0xffffff, 1.5);
        scene.add(ambient);

        // Stronger key light
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
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

        // Stronger fill light for black pieces (back/side)
        const fillLight = new THREE.DirectionalLight(0xffffff, 1.5);
        fillLight.position.set(boardCenter.x - 8, boardCenter.y + 12, boardCenter.z - 8);
        scene.add(fillLight);

        const topLight = new THREE.DirectionalLight(0xffffff, 0.8);
        topLight.position.set(boardCenter.x, boardCenter.y + 25, boardCenter.z);
        scene.add(topLight);

        // Stronger rim light
        const rimLight = new THREE.DirectionalLight(0xffffff, 1.0);
        rimLight.position.set(boardCenter.x + 5, boardCenter.y + 10, boardCenter.z - 15);
        scene.add(rimLight);

        // New Front Light pointing directly at the board
        const frontLight = new THREE.DirectionalLight(0xffffff, 1.5);
        frontLight.position.set(boardCenter.x, boardCenter.y + 15, boardCenter.z + 15);
        frontLight.target.position.copy(boardCenter);
        scene.add(frontLight);
        scene.add(frontLight.target);

        // === Final camera positioning ===
        camera.position.set(boardCenter.x, boardCenter.y + 6, boardCenter.z + 6);
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
    const fileVec = new THREE.Vector3().subVectors(h1, a1).multiplyScalar(1 / 7);
    stepFile = fileVec.length();
    fileDir.copy(fileVec).normalize();

    // Rank direction: a1 → a8
    const rankVec = new THREE.Vector3().subVectors(a8, a1).multiplyScalar(1 / 7);
    stepRank = rankVec.length();
    rankDir.copy(rankVec).normalize();

    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (let f = 0; f < 8; f++) {
        for (let r = 1; r <= 8; r++) {
            const sq = files[f] + r;
            const offset = fileVec.clone().multiplyScalar(f).add(rankVec.clone().multiplyScalar(r - 1));
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

export function syncBoardVisuals(gameBoard) {
    // 1. Remove all existing pieces from scene
    for (const sq in pieces) {
        if (pieces[sq]) {
            // Fix: Remove from parent (could be scene OR model)
            if (pieces[sq].parent) {
                pieces[sq].parent.remove(pieces[sq]);
            }
            delete pieces[sq];
        }
    }

    // 2. Iterate through the game board (8x8 array)
    // gameBoard is array of rows (0=Rank 8, 7=Rank 1)
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = gameBoard[r][c];
            if (piece) {
                const rank = 8 - r; // Row 0 is Rank 8
                const file = files[c];
                const square = file + rank;

                const key = piece.color + '_' + piece.type;
                const template = pieceTemplates[key];

                if (template && boardSquares[square]) {
                    const newPiece = template.clone();
                    scene.add(newPiece);

                    // Position logic
                    const targetPos = boardSquares[square];
                    newPiece.position.set(targetPos.x, boardY, targetPos.z);

                    // Adjust Y based on bounding box
                    newPiece.updateMatrixWorld(true);
                    const bbox = new THREE.Box3().setFromObject(newPiece);
                    const heightAdjustment = boardY - bbox.min.y;
                    newPiece.position.y += heightAdjustment;

                    newPiece.userData = { square, color: piece.color, type: piece.type };
                    pieces[square] = newPiece;

                    // Enable shadows
                    newPiece.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                }
            }
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Update shader uniforms
    updateInput(Date.now() / 1000);

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
