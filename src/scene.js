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
                    console.log('Found board surface pPlane1 at Y:', boardY);
                }

                // Parse name in format: Color_PieceName_Position
                const parts = name.split('_');
                if (parts.length >= 3) {
                    const colorStr = parts[0];
                    if (colorStr.toLowerCase() !== 'white' && colorStr.toLowerCase() !== 'black') {
                        console.log('Skipping non-piece object:', name);
                        return;
                    }

                    const pieceStr = parts[1];
                    const square = parts[2].toLowerCase();

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
                } else {
                    console.log('Invalid name format:', name);
                }
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

export let squareSize = 1.0; // Default, will be updated
export let boardY = 0; // Default, will be updated from pPlane1

function interpolateBoardSquares() {
    const fileMap = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    // We need at least some anchors.
    // We expect pieces at ranks 1, 2, 7, 8.
    // We can interpolate ranks 3, 4, 5, 6.

    let calculatedSize = false;

    for (let f = 0; f < 8; f++) {
        const file = fileMap[f];
        const p2 = boardSquares[`${file}2`]; // White Pawn
        const p7 = boardSquares[`${file}7`]; // Black Pawn

        if (p2 && p7) {
            // Calculate square size if not yet done
            if (!calculatedSize) {
                const dist = p2.distanceTo(p7);
                squareSize = dist / 5; // 5 squares between rank 2 and 7
                console.log("Calculated square size:", squareSize);
                calculatedSize = true;
            }

            for (let r = 3; r <= 6; r++) {
                const square = `${file}${r}`;
                const alpha = (r - 2) / 5; // 2->0, 7->1. range is 5 steps (2,3,4,5,6,7)
                // Wait, 2 to 7 is 5 steps:
                // r=3: (3-2)/5 = 0.2
                // r=4: (4-2)/5 = 0.4
                // ...
                // r=7: (7-2)/5 = 1.0 -> Correct.

                const pos = new THREE.Vector3().lerpVectors(p2, p7, alpha);
                boardSquares[square] = pos;
            }
        }
    }

    // Also interpolate rank 1 and 8 if missing (unlikely if pieces are there)
    // But what if we want to be robust?
    // Let's assume standard board layout.
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
