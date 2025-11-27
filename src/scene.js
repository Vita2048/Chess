import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initInput, updateInput } from './input.js';

export let scene, camera, renderer, controls;
let calculationMesh = null;
let overlayMesh = null;
let boardGlowMesh = null;
let boardBorderMesh = null;
let calculationVideo = null;
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

// Loading overlay functions
function showLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

function updateLoadingProgress(loaded, total) {
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-percentage');

    if (progressBar && progressText && total > 0) {
        const percentage = Math.round((loaded / total) * 100);
        progressBar.style.width = percentage + '%';
        progressText.textContent = percentage + '%';
    }
}


export const BOARD_SCALE = 20;
export const BOARD_ROTATION_Y = -90; // Degrees

export let rankDir = new THREE.Vector3();
export let fileDir = new THREE.Vector3();

let boardCenter = new THREE.Vector3();


export function initGame() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 12, 12);
    scene.add(camera); // Ensure camera children are rendered

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

    // Show loading overlay
    showLoadingOverlay();

    const loader = new GLTFLoader();
    loader.load('./models/ChessSetCorrectQueen.glb', function (gltf) {
        // Hide loading overlay on success
        hideLoadingOverlay();

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
                    boardY = worldPos.y;
                    boardCenter.copy(worldPos);
                }

                // Capture polySurface51 for the glow effect
                if (child.name === 'polySurface51') {
                    boardBorderMesh = child;
                    console.log("Found board border mesh: polySurface51");
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
        initCalculationVideo();
        initBoardGlow();
        animate();

    }, function (progress) {
        // Update loading progress
        updateLoadingProgress(progress.loaded, progress.total);
    }, function (error) {
        // Hide loading overlay on error
        hideLoadingOverlay();
        console.error('GLTF load error:', error);
    });
}

function initCalculationVideo() {
    // Create hidden video element
    calculationVideo = document.createElement('video');
    calculationVideo.src = (import.meta.env.BASE_URL || '/') + 'video/Calculation.mp4';
    calculationVideo.loop = true;
    calculationVideo.muted = true;
    calculationVideo.crossOrigin = 'anonymous';
    calculationVideo.playsInline = true;
    calculationVideo.style.display = 'none'; // Hidden from DOM

    calculationVideo.onerror = (e) => {
        console.error("Error loading calculation video:", calculationVideo.error, e);
    };

    document.body.appendChild(calculationVideo);

    const texture = new THREE.VideoTexture(calculationVideo);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.format = THREE.RGBAFormat;

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
            map: { value: texture }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D map;
            varying vec2 vUv;
            void main() {
                vec4 texColor = texture2D(map, vUv);
                
                // Luma Key: Calculate brightness
                float brightness = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
                
                // Smooth cutoff to remove black background
                // Adjust these values to tune the removal
                float alpha = smoothstep(0.05, 0.2, brightness);
                
                gl_FragColor = vec4(texColor.rgb, alpha);
            }
        `
    });

    // Create plane attached to camera (HUD style)
    // Use 1x1 geometry to make scaling easier
    const geometry = new THREE.PlaneGeometry(1, 1);
    calculationMesh = new THREE.Mesh(geometry, material);

    // Initial positioning (will be updated by layout function)
    calculationMesh.position.set(0, 0, -5);
    calculationMesh.visible = false;
    calculationMesh.renderOrder = 1000; // Ensure video is on top of overlay

    // CRITICAL FIX: Disable raycasting for this mesh so it doesn't block mouse clicks
    calculationMesh.raycast = () => { };

    camera.add(calculationMesh);

    // === Gray Overlay ===
    const overlayMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.6, // Slightly darker for better visibility
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    overlayMesh = new THREE.Mesh(geometry, overlayMaterial);
    overlayMesh.position.set(0, 0, -5.1); // Slightly behind video
    overlayMesh.visible = false;
    overlayMesh.renderOrder = 999; // On top of scene, behind video
    overlayMesh.raycast = () => { }; // Disable raycasting
    camera.add(overlayMesh);

    // Update layout once metadata is loaded (to get aspect ratio)
    calculationVideo.addEventListener('loadedmetadata', updateVideoLayout);

    // Update layout on resize
    window.addEventListener('resize', updateVideoLayout);

    // Trigger initial layout update
    updateVideoLayout();
}

function updateVideoLayout() {
    if (!calculationMesh || !calculationVideo || !camera) return;

    const videoWidth = calculationVideo.videoWidth || 16;
    const videoHeight = calculationVideo.videoHeight || 9;
    const aspect = videoWidth / videoHeight;

    // Target: 200px height, below top-center-status (which is at ~20px)
    const targetPixelHeight = 200;
    const targetTopPixel = 80; // Position below status
    const distance = 5; // Distance from camera

    // Calculate visible height at the given distance
    // vFOV is in degrees
    const vFOV = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2 * Math.tan(vFOV / 2) * distance;

    // Calculate visible width based on aspect ratio of the window
    const visibleWidth = visibleHeight * camera.aspect;

    // Convert pixel height to 3D units
    // 3D Height / Visible Height = Pixel Height / Window Height
    const height3D = visibleHeight * (targetPixelHeight / window.innerHeight);
    const width3D = height3D * aspect;

    // Apply scale
    calculationMesh.scale.set(width3D, height3D, 1);

    // Position: Below top-center-status
    // Convert targetTopPixel to 3D Y coordinate
    // Top of view is visibleHeight / 2, bottom is -visibleHeight / 2
    const topY3D = visibleHeight / 2;
    const pixelTo3D = visibleHeight / window.innerHeight;
    const targetTopY3D = topY3D - (targetTopPixel * pixelTo3D);
    const meshY = targetTopY3D - (height3D / 2); // Center of mesh

    calculationMesh.position.set(0, meshY, -distance);

    // Update Overlay Layout
    // Overlay should cover the whole screen
    // At distance 5.1
    const overlayDist = 5.1;
    const overlayHeight = 2 * Math.tan(vFOV / 2) * overlayDist;
    const overlayWidth = overlayHeight * camera.aspect;

    if (overlayMesh) {
        overlayMesh.scale.set(overlayWidth, overlayHeight, 1);
        overlayMesh.position.set(0, 0, -overlayDist);
    }
}

export function showCalculationVideo() {
    if (calculationVideo && calculationMesh) {
        calculationVideo.play().catch(e => console.error("Video play failed:", e));
        calculationMesh.visible = true;
        if (boardGlowMesh) boardGlowMesh.visible = true;
    }
}

export function hideCalculationVideo() {
    if (calculationVideo && calculationMesh) {
        calculationVideo.pause();
        calculationVideo.currentTime = 0;
        calculationMesh.visible = false;
        if (overlayMesh) overlayMesh.visible = false;
        if (boardGlowMesh) boardGlowMesh.visible = false;
    }
}

function initBoardGlow() {
    if (!boardBorderMesh) {
        console.warn("polySurface51 not found, skipping board glow.");
        return;
    }

    // Get bounding box of polySurface51
    boardBorderMesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(boardBorderMesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    console.log(`PolySurface51 Bounding Box: Size(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)})`);

    // Create a plane same size as polySurface51 for the glow on edges
    const geometry = new THREE.PlaneGeometry(size.x, size.z);

    // Beautiful shader like piece movement highlights
    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 }
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            varying vec2 vUv;

            void main() {
                vec2 uv = vUv;
                vec2 center = abs(uv - 0.5);
                float box = max(center.x, center.y); // Chebyshev = perfect square

                vec3 color = vec3(0.0);
                float alpha = 0.0;
                // Only glow on the thin outline
                if (box >= 0.45 && box <= 0.5) {
                    // Outer glowing border
                    float outer = 0.50;
                    float border = smoothstep(outer - 0.05, outer, box);

                    // Animated flashing energy waves
                    float wave = sin((box - 0.3) * 25.0 - time * 12.0) * 0.5 + 0.5;
                    float flash = pow(wave, 4.0) * (0.6 + 0.4 * sin(time * 8.0));

                    // Dark, intense blue
                    vec3 darkBlue   = vec3(0.00, 0.02, 0.18);
                    vec3 midBlue    = vec3(0.00, 0.10, 0.45);
                    vec3 brightBlue = vec3(0.10, 0.35, 0.95);
                    vec3 whiteFlash = vec3(0.70, 0.90, 1.00);

                    color = mix(darkBlue, midBlue, border);
                    color = mix(color, brightBlue, border * 1.2);
                    color = mix(color, whiteFlash, flash * border);

                    // Strong pulsing intensity
                    float pulse = 0.7 + 0.3 * sin(time * 10.0);
                    float intensity = (border * 1.8 + flash * 2.5) * pulse;

                    alpha = intensity * 28.0;
                }

                gl_FragColor = vec4(color, alpha);
            }
        `
    });

    boardGlowMesh = new THREE.Mesh(geometry, material);

    // Position at center, slightly above board
    boardGlowMesh.position.copy(center);
    boardGlowMesh.position.y = boardY + 0.01;
    boardGlowMesh.rotation.x = -Math.PI / 2;

    boardGlowMesh.visible = false;
    boardGlowMesh.raycast = () => { };

    // Add to SCENE
    scene.add(boardGlowMesh);

    console.log("Board glow mesh initialized (Rectangular silhouette bigger than polySurface51)");
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

// In scene.js

export function syncBoardVisuals(gameBoard) {
    // === 1. AGGRESSIVE CLEANUP ===
    // Instead of only checking the 'pieces' dictionary, we look at the Scene's children.
    // This removes any "ghost" pieces that might be lingering visually but missing from the dictionary.
    
    // Create a list of objects to remove to avoid modifying the scene while iterating
    const toRemove = [];
    
    scene.traverse((child) => {
        // Identify chess pieces by their userData
        if (child.userData && child.userData.type && (child.userData.color === 'w' || child.userData.color === 'b')) {
            // It's a piece! Mark it for removal.
            toRemove.push(child);
        }
    });

    // Actually remove them
    toRemove.forEach(child => {
        if (child.parent) {
            child.parent.remove(child);
        }
    });

    // Clear the internal dictionary completely
    for (const key in pieces) {
        delete pieces[key];
    }

    // === 2. REBUILD VISUALS FROM LOGIC ===
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = gameBoard[r][c]; // This comes from chess.js (game.board())
            if (piece) {
                const rank = 8 - r;
                const file = files[c];
                const square = file + rank;

                // Create the key for the template (e.g., "w_p", "b_k")
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
                    // Use the newly cloned piece's bbox to ensure it sits perfectly on the board
                    const heightAdjustment = boardY - bbox.min.y;
                    newPiece.position.y += heightAdjustment;

                    // Re-assign userData so we can identify it later
                    newPiece.userData = { square, color: piece.color, type: piece.type };
                    
                    // Update the dictionary
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
    
    console.log("Board visuals synced. Current pieces:", Object.keys(pieces));
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Update shader uniforms
    const time = Date.now() / 1000;
    updateInput(time);

    if (boardGlowMesh && boardGlowMesh.visible) {
        boardGlowMesh.material.uniforms.time.value = time;
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
