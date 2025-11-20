import * as THREE from 'three';
import { pieces, boardSquares, stepRank, stepFile, boardY, pieceYOffset, boardMesh } from './scene.js';
import { getMoves, makeMove, game } from './chessLogic.js';

let raycaster;
let mouse;
let camera;
let scene;
let selectedSquare = null;
let highlightedSquares = [];
let selectedHighlight = null;

export function initInput(cam, sc) {
    camera = cam;
    scene = sc;
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    console.log("Input initialized! Click listener attached.");
    window.addEventListener('click', onMouseClick, false);
}

function onMouseClick(event) {
    console.log("Click detected!", event);
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(scene.children, true);
    console.log("Intersects:", intersects.length);

    if (intersects.length > 0) {
        let clickedObject = intersects[0].object;
        console.log("Clicked object:", clickedObject.name, "Type:", clickedObject.type);

        let pieceRoot = clickedObject;
        while (pieceRoot.parent && pieceRoot.parent !== scene && !pieceRoot.userData.square) {
            // console.log("Traversing up to:", pieceRoot.parent.name, "Has square?", !!pieceRoot.parent.userData.square);
            pieceRoot = pieceRoot.parent;
        }

        console.log("Final pieceRoot:", pieceRoot.name, "Has square?", !!pieceRoot.userData.square, "Square:", pieceRoot.userData.square);

        if (pieceRoot.userData.square) {
            handleSquareClick(pieceRoot.userData.square);
        } else {
            console.log("No square found, trying handleBoardClick");
            handleBoardClick(intersects[0].point);
        }
    }
}

function handleSquareClick(square) {
    console.log("Clicked square:", square);

    if (selectedSquare) {
        const move = {
            from: selectedSquare,
            to: square,
            promotion: 'q'
        };

        try {
            const result = makeMove(move);
            if (result) {
                movePieceVisual(selectedSquare, square);
                selectedSquare = null;
                clearHighlights();
                clearSelected();

                // Trigger AI move
                const statusDiv = document.getElementById('status');
                if (statusDiv) statusDiv.innerText = "Computer is thinking...";

                setTimeout(() => {
                    import('./ai.js').then(module => {
                        const bestMove = module.getBestMove();
                        if (bestMove) {
                            makeMove(bestMove);
                            movePieceVisual(bestMove.from, bestMove.to);
                            if (statusDiv) statusDiv.innerText = "White's Turn";

                            // Check game over
                            if (game.isGameOver()) {
                                if (game.in_checkmate()) {
                                    statusDiv.innerText = "Checkmate! " + (game.turn() === 'w' ? "Black" : "White") + " Wins!";
                                } else if (game.in_draw()) {
                                    statusDiv.innerText = "Draw!";
                                } else {
                                    statusDiv.innerText = "Game Over";
                                }
                                alert(statusDiv.innerText);
                            }
                        }
                    });
                }, 100);
                return;
            }
        } catch (e) {
            // Invalid move
            console.log("Invalid move", e);
        }
    }

    const piece = game.get(square);
    if (piece && piece.color === game.turn()) {
        selectedSquare = square;
        highlightSelected(square);
        highlightMoves(square);
    } else {
        selectedSquare = null;
        clearHighlights();
        clearSelected();
    }
}

function handleBoardClick(point) {
    // Project point to board plane
    point.y = boardY;

    let closestSquare = null;
    let minDist = Infinity;

    for (const [sq, pos] of Object.entries(boardSquares)) {
        const dist = point.distanceTo(pos);
        // Use average step size for tolerance
        const avgStep = (stepRank + stepFile) / 2;
        if (dist < avgStep * 0.3) {
            if (dist < minDist) {
                minDist = dist;
                closestSquare = sq;
            }
        }
    }

    if (closestSquare) {
        handleSquareClick(closestSquare);
    }
}
function alignHighlightToBoard(mesh) {
    // Calculate orientation based on the actual grid corners
    // This ensures alignment even if the board mesh has weird local rotations
    const a1 = pieces['a1'];
    const h1 = pieces['h1'];
    const a8 = pieces['a8'];

    if (!a1 || !h1 || !a8) {
        // Fallback if pieces aren't loaded yet
        if (boardMesh) {
            mesh.rotation.set(0, boardMesh.rotation.y, 0);
        }
        return;
    }

    const pA1 = new THREE.Vector3();
    const pH1 = new THREE.Vector3();
    const pA8 = new THREE.Vector3();

    a1.getWorldPosition(pA1);
    h1.getWorldPosition(pH1);
    a8.getWorldPosition(pA8);

    // 1. Define our target local axes based on the BoxGeometry dimensions
    // Geometry is: width = stepRank, depth = stepFile
    // So Local X should align with Rank direction (a1 -> a8)
    // So Local Z should align with File direction (a1 -> h1)

    const targetX = new THREE.Vector3().subVectors(pA8, pA1).normalize(); // Rank direction
    const targetZ = new THREE.Vector3().subVectors(pH1, pA1).normalize(); // File direction

    // 2. Calculate the normal (Up vector)
    // Z cross X = Y (Right-handed coordinate system)
    const targetY = new THREE.Vector3().crossVectors(targetZ, targetX).normalize();

    // 3. Re-orthogonalize to ensure a perfect rotation matrix
    // We keep Y (Up) and X (Rank) as primary, recalculate Z (File)
    // or keep X and Z and recalculate Y? 
    // Let's trust the Up vector derived from the cross product, and recalculate Z to be perfectly perpendicular to X and Y
    const correctedZ = new THREE.Vector3().crossVectors(targetX, targetY).normalize();

    // 4. Create rotation matrix
    const rotationMatrix = new THREE.Matrix4();
    rotationMatrix.makeBasis(targetX, targetY, correctedZ);

    // 5. Apply rotation
    mesh.setRotationFromMatrix(rotationMatrix);
}
function highlightMoves(square) {
    clearHighlights();
    const moves = getMoves(square);

    moves.forEach(move => {
        const targetSquare = move.to;
        const pos = boardSquares[targetSquare];
        if (pos) {
            const avgStep = (stepRank + stepFile) / 2;
            const height = avgStep * 0.02;

            const geometry = new THREE.BoxGeometry(stepRank * 0.95, height, stepFile * 0.95);
            const material = new THREE.MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.6 });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(pos);

            const surfaceY = boardY !== undefined ? boardY : pos.y;
            mesh.position.y = surfaceY + height / 2 + avgStep * 0.01;

            alignHighlightToBoard(mesh);  // ← CORRECT ORIENTATION

            scene.add(mesh);
            highlightedSquares.push(mesh);
        }
    });
}

function highlightSelected(square) {
    clearSelected();
    const pos = boardSquares[square];
    if (pos) {
        const avgStep = (stepRank + stepFile) / 2;
        const height = avgStep * 0.02;

        const geometry = new THREE.BoxGeometry(stepRank * 0.95, height, stepFile * 0.95);
        const material = new THREE.MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.8, wireframe: true });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(pos);

        const surfaceY = boardY !== undefined ? boardY : pos.y;
        mesh.position.y = surfaceY + height / 2 + avgStep * 0.01;

        alignHighlightToBoard(mesh);  // ← NOW FIXED!

        scene.add(mesh);
        selectedHighlight = mesh;
    }
}
function clearHighlights() {
    highlightedSquares.forEach(mesh => scene.remove(mesh));
    highlightedSquares = [];
}



function clearSelected() {
    if (selectedHighlight) {
        scene.remove(selectedHighlight);
        selectedHighlight = null;
    }
}

function movePieceVisual(from, to) {
    const pieceObj = pieces[from];
    const targetPos = boardSquares[to];

    if (pieceObj && targetPos) {
        if (pieces[to]) {
            scene.remove(pieces[to]);
        }

        console.log(`Moving ${from} to ${to}`);

        const startWorld = new THREE.Vector3();
        pieceObj.getWorldPosition(startWorld);
        console.log(`Start World Pos: ${startWorld.x.toFixed(3)}, ${startWorld.y.toFixed(3)}, ${startWorld.z.toFixed(3)}`);
        console.log(`Target Grid Pos: ${targetPos.x.toFixed(3)}, ${targetPos.y.toFixed(3)}, ${targetPos.z.toFixed(3)}`);

        // Calculate target World Position
        const worldTarget = new THREE.Vector3(
            targetPos.x,
            boardY + pieceYOffset,
            targetPos.z
        );
        console.log(`Calculated World Target: ${worldTarget.x.toFixed(3)}, ${worldTarget.y.toFixed(3)}, ${worldTarget.z.toFixed(3)}`);

        // Attach piece to Scene to ensure it shares the same coordinate space as the boardSquares/rectangles
        // This handles any parent transforms (scale/rotation) automatically
        scene.attach(pieceObj);

        // Set initial position
        pieceObj.position.copy(worldTarget);

        // Center the piece in the cell by adjusting based on its bounding box
        pieceObj.updateMatrixWorld(true);
        const bbox = new THREE.Box3().setFromObject(pieceObj);
        const currentCenter = new THREE.Vector3();
        bbox.getCenter(currentCenter);

        // Offset to move the center to the target position horizontally
        const offset = worldTarget.clone().sub(currentCenter);
        offset.y = 0; // Keep Y for now
        pieceObj.position.add(offset);

        // Adjust Y so the bottom of the piece is on the board surface
        pieceObj.updateMatrixWorld(true);
        const updatedBbox = new THREE.Box3().setFromObject(pieceObj);
        pieceObj.position.y += boardY - updatedBbox.min.y;

        pieceObj.updateMatrixWorld(true); // Force update to check result
        const endWorld = new THREE.Vector3();
        pieceObj.getWorldPosition(endWorld);
        console.log(`End World Pos: ${endWorld.x.toFixed(3)}, ${endWorld.y.toFixed(3)}, ${endWorld.z.toFixed(3)}`);

        pieces[to] = pieceObj;
        delete pieces[from];
        pieceObj.userData.square = to;
    }
}
