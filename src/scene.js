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
            console.log(`Node: '${child.name}', Type: ${child.type}, isMesh: ${child.isMesh}`);
            if (child.name === 'pPlane1') {
                console.log('!!! FOUND pPlane1 !!!', child);
                boardMesh = child; // Force assignment if found, even if not isMesh (though it should be)
            }

            if (child.isMesh && child.name) {
                const name = child.name.trim();
                console.log('Processing mesh:', name);

                // Check for board surface
                if (name.toLowerCase().includes('plane') || name.toLowerCase().includes('board') || name === 'pPlane1') {
                    const worldPos = new THREE.Vector3();
                    child.getWorldPosition(worldPos);
                    boardY = worldPos.y;
                    boardCenter.copy(worldPos); // Store center
                    boardMesh = child; // Save mesh for grid generation
                    console.log('Found board surface', name, 'at Y:', boardY, 'Center:', boardCenter);
                }

                // Parse name in format: Color_PieceName_Position or PieceName_Color_Position
                const parts = name.split('_');

                // Special case: White Queen is named "Mesh016" in the model
                let square, colorStr, pieceStr;
                if (name === 'Mesh016') { // Exact match to avoid duplicates with Mesh016_1
                    square = 'd1';
                    colorStr = 'White';
                    pieceStr = 'Queen';
                    console.log('Found White Queen at d1 (from Mesh016)');
                } else if (parts.length >= 3) {
                    let colorIndex = -1;
                    let pieceIndex = -1;
                    let squareIndex = -1;

                    // Check for Color_Piece_Square format
                    if (parts[0].toLowerCase() === 'white' || parts[0].toLowerCase() === 'black') {
                        colorIndex = 0;
                        pieceIndex = 1;
                        squareIndex = 2;
                    }
                    // Check for Piece_Color_Square format
                    else if (parts[1] && (parts[1].toLowerCase() === 'white' || parts[1].toLowerCase() === 'black')) {
                        colorIndex = 1;
                        pieceIndex = 0;
                        squareIndex = 2;
                    }

                    if (colorIndex !== -1) {
                        colorStr = parts[colorIndex];
                        pieceStr = parts[pieceIndex];
                        square = parts[squareIndex].toLowerCase();
                    } else {
                        console.log('Skipping non-piece object:', name);
                        return;
                    }
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
export let boardMesh; // Exported for grid generation

let boardCenter = new THREE.Vector3();

function interpolateBoardSquares() {
    const fileMap = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    console.log("=== GRID GENERATION (Corner Calibration) ===");

    // First, calculate piece Y offset from any piece
    if (pieces['a2']) {
        const pos = new THREE.Vector3();
        pieces['a2'].getWorldPosition(pos);
        pieceYOffset = pos.y - boardY;
        console.log(`Piece Y offset above board: ${pieceYOffset.toFixed(3)}`);
    }

    // Check for Corner Pieces
    const pA1 = pieces['a1'];
    const pH1 = pieces['h1'];
    const pA8 = pieces['a8'];

    if (!pA1 || !pH1 || !pA8) {
        console.error("Critical: Missing corner pieces (A1, H1, or A8). Cannot calibrate grid.");
        return;
    }

    const posA1 = new THREE.Vector3();
    const posH1 = new THREE.Vector3();
    const posA8 = new THREE.Vector3();

    pA1.getWorldPosition(posA1);
    pH1.getWorldPosition(posH1);
    pA8.getWorldPosition(posA8);

    console.log(`Corner Positions: A1(${posA1.x.toFixed(2)}, ${posA1.z.toFixed(2)}) H1(${posH1.x.toFixed(2)}, ${posH1.z.toFixed(2)}) A8(${posA8.x.toFixed(2)}, ${posA8.z.toFixed(2)})`);

    // 1. Calculate File Vector (A1 -> H1)
    // This vector spans 7 steps (from file 0 to file 7)
    const vecFileTotal = new THREE.Vector3().subVectors(posH1, posA1);
    const distFileTotal = vecFileTotal.length();
    stepFile = distFileTotal / 7;
    const vFile = vecFileTotal.clone().normalize();

    // 2. Calculate Rank Vector (A1 -> A8)
    // This vector spans 7 steps (from rank 1 to rank 8)
    const vecRankTotal = new THREE.Vector3().subVectors(posA8, posA1);
    const distRankTotal = vecRankTotal.length();
    stepRank = distRankTotal / 7;
    const vRank = vecRankTotal.clone().normalize();

    console.log(`Calibration Results:`);
    console.log(`  stepFile: ${stepFile.toFixed(4)} (Total Dist: ${distFileTotal.toFixed(2)})`);
    console.log(`  stepRank: ${stepRank.toFixed(4)} (Total Dist: ${distRankTotal.toFixed(2)})`);
    console.log(`  vFile: (${vFile.x.toFixed(3)}, ${vFile.y.toFixed(3)}, ${vFile.z.toFixed(3)})`);
    console.log(`  vRank: (${vRank.x.toFixed(3)}, ${vRank.y.toFixed(3)}, ${vRank.z.toFixed(3)})`);

    // 3. Generate Grid
    // Formula: Pos(f, r) = A1 + (f * stepFile * vFile) + (r * stepRank * vRank)
    // Where f is 0-7 (File A-H), r is 0-7 (Rank 1-8)

    for (let f = 0; f < 8; f++) {
        for (let r = 0; r < 8; r++) {
            const fileChar = fileMap[f];
            const rankNum = r + 1;
            const square = `${fileChar}${rankNum}`;

            const fileOffset = vFile.clone().multiplyScalar(f * stepFile);
            const rankOffset = vRank.clone().multiplyScalar(r * stepRank);

            const pos = posA1.clone().add(fileOffset).add(rankOffset);
            pos.y = boardY; // Flatten to board height

            boardSquares[square] = pos;
        }
    }

    console.log("=== Grid generation complete ===");
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
