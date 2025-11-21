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
        // Check for promotion
        const piece = game.get(selectedSquare);
        const isPawn = piece && piece.type === 'p';
        const targetRank = square[1];
        const isPromotion = isPawn && (targetRank === '1' || targetRank === '8');

        const move = {
            from: selectedSquare,
            to: square,
        };

        if (isPromotion) {
            // Show promotion dialog and wait for user input
            showPromotionDialog((promotionPiece) => {
                move.promotion = promotionPiece;
                executeMove(move);
            });
            return; // Stop here, wait for callback
        }

        // Normal move
        executeMove(move);
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

function showPromotionDialog(callback) {
    const modal = document.getElementById('promotion-modal');
    modal.classList.remove('hidden');

    const buttons = modal.querySelectorAll('button');
    const handler = (event) => {
        const piece = event.target.getAttribute('data-piece');
        if (piece) {
            modal.classList.add('hidden');
            // Remove listeners to prevent duplicates
            buttons.forEach(btn => btn.removeEventListener('click', handler));
            callback(piece);
        }
    };

    buttons.forEach(btn => btn.addEventListener('click', handler));
}

function executeMove(move) {
    try {
        const result = makeMove(move);
        if (result) {
            movePieceVisual(move.from, move.to, move.promotion);
            selectedSquare = null;
            clearHighlights();
            clearSelected();

            // Check if User ended the game
            if (checkGameOver()) return;

            // Trigger AI move
            const statusDiv = document.getElementById('status');
            if (statusDiv) statusDiv.innerText = "Computer is thinking...";

            setTimeout(() => {
                import('./ai.js').then(module => {
                    const bestMove = module.getBestMove();
                    if (bestMove) {
                        makeMove(bestMove);
                        movePieceVisual(bestMove.from, bestMove.to, bestMove.promotion);
                        if (statusDiv) statusDiv.innerText = "White's Turn";
                        checkGameOver();
                    } else {
                        // AI has no moves? Check game over again
                        if (!checkGameOver()) {
                            console.error("AI returned no move but game is not over?");
                        }
                    }
                });
            }, 100);
            return;
        }
    } catch (e) {
        // Invalid move
        console.warn("Invalid move attempt:", move);
        console.error("Move error details:", e);
    }
}

function checkGameOver() {
    const statusDiv = document.getElementById('status');
    if (game.isGameOver()) {
        if (game.isCheckmate()) {
            const winner = game.turn() === 'w' ? "Black" : "White";
            if (statusDiv) statusDiv.innerText = `Checkmate! ${winner} Wins!`;
            alert(`Checkmate! ${winner} Wins!`);
        } else if (game.isDraw()) {
            if (statusDiv) statusDiv.innerText = "Draw!";
            alert("Draw!");
        } else {
            if (statusDiv) statusDiv.innerText = "Game Over";
            alert("Game Over");
        }
        return true;
    }
    return false;
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

function movePieceVisual(from, to, promotionType) {
    const pieceObj = pieces[from];
    const targetPos = boardSquares[to];

    if (pieceObj && targetPos) {
        if (pieces[to]) {
            // Correctly remove the captured piece from its parent (Scene or GLTF Model)
            pieces[to].removeFromParent();
        }

        console.log(`Moving ${from} to ${to}`);

        const startWorld = new THREE.Vector3();
        pieceObj.getWorldPosition(startWorld);

        // Calculate target World Position
        const worldTarget = new THREE.Vector3(
            targetPos.x,
            boardY + pieceYOffset,
            targetPos.z
        );

        // Attach piece to Scene to ensure it shares the same coordinate space as the boardSquares/rectangles
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

        pieces[to] = pieceObj;
        delete pieces[from];
        pieceObj.userData.square = to;

        // Handle Promotion Visuals
        if (promotionType) {
            console.log(`Promoting to ${promotionType}`);
            const color = pieceObj.userData.color;

            // Find a template piece to clone
            let template = null;
            for (const key in pieces) {
                const p = pieces[key];
                if (p.userData.type === promotionType && p.userData.color === color) {
                    template = p;
                    break;
                }
            }

            if (template) {
                const newPiece = template.clone();
                scene.add(newPiece);

                // Copy position and rotation
                newPiece.position.copy(pieceObj.position);
                newPiece.rotation.copy(pieceObj.rotation);
                newPiece.scale.copy(pieceObj.scale); // Ensure scale is preserved

                newPiece.userData = { ...pieceObj.userData, type: promotionType };
                newPiece.userData.square = to;

                // Remove the pawn
                pieceObj.removeFromParent();

                // Update pieces reference
                pieces[to] = newPiece;

                // Ensure shadows are enabled for the new piece
                newPiece.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
            } else {
                console.warn(`Could not find template for promotion to ${promotionType}`);
                // Fallback: Just keep the pawn but change its type in userData (visuals will be wrong but game continues)
                pieceObj.userData.type = promotionType;
            }
        }
    }
}
