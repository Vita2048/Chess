import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initInput } from './input.js';

export let scene, camera, renderer, controls;
export const pieces = {};
export const boardSquares = {};

export function initGame() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue background

    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('app').appendChild(renderer.domElement);

    // Add controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Load GLTF model
    const loader = new GLTFLoader();
    loader.load('/models/chess-set_FULL.glb', function (gltf) {
        console.log('GLTF loaded:', gltf);
        scene.add(gltf.scene);

        // Enable shadows for the model
        gltf.scene.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Parse pieces from the model
        let piecesFound = 0;
        gltf.scene.traverse(function (child) {
            if (child.isMesh && child.name) {
                const name = child.name.trim();
                console.log('Processing mesh:', name);

                // Check for board surface
                if (name === 'pPlane1') {
                    const worldPos = new THREE.Vector3();
                    child.getWorldPosition(worldPos);
                    boardY = worldPos.y;
                    boardCenter.copy(worldPos); // Store center
                    console.log('Found board surface pPlane1 at Y:', boardY, 'Center:', boardCenter);
                }

                // Parse name in format: Color_PieceName_Position
                const parts = name.split('_');

                // Special case: White Queen is named "Mesh016" in the model
                let square, colorStr, pieceStr;
                if (name === 'Mesh016') { // Exact match to avoid duplicates with Mesh016_1
                    square = 'd1';
                    colorStr = 'White';
                    pieceStr = 'Queen';
                    console.log('Found White Queen at d1 (from Mesh016)');
                } else if (parts.length >= 3) {
                    colorStr = parts[0];
                    if (colorStr.toLowerCase() !== 'white' && colorStr.toLowerCase() !== 'black') {
                        console.log('Skipping non-piece object:', name);
                        return;
                    }

                    pieceStr = parts[1];
                    square = parts[2].toLowerCase();
                } else {
                    // console.log('Invalid name format:', name);
                    return;
                }

                let color = colorStr.toLowerCase() === 'white' ? 'w' : 'b';
                let type;

                const lowerPiece = pieceStr.toLowerCase();
                if (lowerPiece === 'pawn') type = 'p';
                else if (lowerPiece === 'rook') type = 'r';
                else if (lowerPiece === 'knight') type = 'n';
                else if (lowerPiece === 'bishop') type = 'b';
                else if (lowerPiece === 'queen') type = 'q';
                else if (lowerPiece === 'king') type = 'k';
                else {
                    console.log('Unknown piece type:', pieceStr);
                    return;
                }

                // Store metadata
                child.userData.square = square;
                child.userData.color = color;
                child.userData.type = type;

                // Save to pieces map
                pieces[square] = child;
                piecesFound++;

                // Save board position
                const worldPos = new THREE.Vector3();
                child.getWorldPosition(worldPos);
                boardSquares[square] = worldPos.clone();

                console.log(`Found ${colorStr} ${pieceStr} at ${square}`);
            }
        });

        console.log(`===== SETUP COMPLETE. Found ${piecesFound} pieces. =====`);

        // Fill in empty squares in boardSquares if needed
        interpolateBoardSquares();

        // Initialize input handling
        initInput(camera, scene);

        // Start animation loop
        animate();
    }, undefined, function (error) {
        console.error('Error loading GLTF:', error);
    });
}

export let stepRank = 1.0;
export let stepFile = 1.0;
export let boardY = 0; // Default, will be updated from pPlane1
export let pieceYOffset = 0; // Height of pieces above board surface

let boardCenter = new THREE.Vector3();

function interpolateBoardSquares() {
    const fileMap = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    // First, calculate piece Y offset from any piece
    if (pieces['a2']) {
        const pos = new THREE.Vector3();
        pieces['a2'].getWorldPosition(pos);
        pieceYOffset = pos.y - boardY;
        console.log(`Piece Y offset above board: ${pieceYOffset.toFixed(3)}`);
    }

    // Use actual piece positions as grid anchors (no interpolation errors)
    // For each square, if a piece exists there, use its position
    // Otherwise, interpolate from nearest pieces

    console.log("=== GRID GENERATION (Using Piece Anchors) ===");

    // Calculate rank direction vector (from rank 2 to rank 7)
    if (pieces['a2'] && pieces['a7']) {
        const posA2 = new THREE.Vector3();
        const posA7 = new THREE.Vector3();
        pieces['a2'].getWorldPosition(posA2);
        pieces['a7'].getWorldPosition(posA7);

        const vRank = new THREE.Vector3().subVectors(posA7, posA2);
        stepRank = vRank.length() / 5; // 5 squares between rank 2 and 7
        vRank.normalize();

        console.log(`stepRank: ${stepRank.toFixed(3)}`);

        // For each file (a-h), use the actual rank 2 piece as anchor
        for (let f = 0; f < 8; f++) {
            const fileChar = fileMap[f];
            const anchorSquare = `${fileChar}2`;

            if (pieces[anchorSquare]) {
                const anchorPos = new THREE.Vector3();
                pieces[anchorSquare].getWorldPosition(anchorPos);

                // Generate all 8 ranks for this file using the anchor
                for (let r = 0; r < 8; r++) {
                    const rankNum = r + 1;
                    const square = `${fileChar}${rankNum}`;

                    // Position = anchor + vRank * (rank - 2) * stepRank
                    const pos = anchorPos.clone().add(
                        vRank.clone().multiplyScalar((r - 1) * stepRank)
                    );
                    pos.y = boardY;

                    boardSquares[square] = pos;

                    if (f <= 2 && r <= 3) {
                        console.log(`  ${square}: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);
                    }
                }
            }
        }

        // Calculate stepFile for use in other modules (average distance between files)
        if (pieces['a2'] && pieces['b2']) {
            const posA = new THREE.Vector3();
            const posB = new THREE.Vector3();
            pieces['a2'].getWorldPosition(posA);
            pieces['b2'].getWorldPosition(posB);
            stepFile = posA.distanceTo(posB);
            console.log(`stepFile: ${stepFile.toFixed(3)}`);
        }

        console.log("=== Grid generated using piece anchors ===");
    } else {
        console.error("Could not find anchor pieces for grid generation!");
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
