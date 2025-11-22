import * as THREE from 'three';
import { pieces, boardSquares, stepRank, stepFile, boardY, pieceYOffset, boardMesh, pieceTemplates, BOARD_SCALE, BOARD_ROTATION_Y, rankDir, fileDir, syncBoardVisuals } from './scene.js';
import { getMoves, makeMove, game, resetGame, undoMove, saveGameXML, loadGameXML } from './chessLogic.js';

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

    initToolbar();
}

function initToolbar() {
    document.getElementById('btn-new-game').addEventListener('click', () => {
        showNewGameModal();
    });

    document.getElementById('btn-undo').addEventListener('click', () => {
        if (game.turn() !== 'w') {
            alert("You can only undo when it is your turn!");
            return;
        }
        undoMove();
        syncBoardVisuals(game.board());
        clearHighlights();
        clearSelected();
    });

    document.getElementById('btn-save-game').addEventListener('click', () => {
        const xml = saveGameXML();
        const blob = new Blob([xml], { type: 'text/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chess_game.xml';
        a.click();
        URL.revokeObjectURL(url);
    });

    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-load-game').addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const xml = e.target.result;
            if (loadGameXML(xml)) {
                syncBoardVisuals(game.board());
                clearHighlights();
                clearSelected();
                // alert("Game loaded successfully!");
            } else {
                alert("Failed to load game. Invalid XML.");
            }
        };
        reader.readAsText(file);
        // Reset input so same file can be selected again
        fileInput.value = '';
    });
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
        // Check for promotion using chess.js validation
        // This ensures we only show the dialog for VALID promotion moves
        const moves = game.moves({ square: selectedSquare, verbose: true });
        const promotionMove = moves.find(m => m.to === square && m.promotion);

        const move = {
            from: selectedSquare,
            to: square,
        };

        if (promotionMove) {
            // Show promotion dialog and wait for user input
            showPromotionDialog((promotionPiece) => {
                move.promotion = promotionPiece;
                executeMove(move);
            });
            return; // Stop here, wait for callback
        }

        // Normal move (or invalid move, executeMove will handle it)
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

function showNewGameModal() {
    const modal = document.getElementById('new-game-modal');
    modal.classList.remove('hidden');

    const yesBtn = document.getElementById('new-game-yes');
    const noBtn = document.getElementById('new-game-no');

    const yesHandler = () => {
        modal.classList.add('hidden');
        yesBtn.removeEventListener('click', yesHandler);
        noBtn.removeEventListener('click', noHandler);
        resetGame();
        syncBoardVisuals(game.board());
        clearHighlights();
        clearSelected();
    };

    const noHandler = () => {
        modal.classList.add('hidden');
        yesBtn.removeEventListener('click', yesHandler);
        noBtn.removeEventListener('click', noHandler);
    };

    yesBtn.addEventListener('click', yesHandler);
    noBtn.addEventListener('click', noHandler);
}

function showGameOverOverlay(message) {
    const overlay = document.getElementById('game-over-overlay');
    const messageDiv = document.getElementById('game-over-message');
    messageDiv.innerText = message;
    overlay.classList.remove('hidden');

    // Hide after 5 seconds
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 5000);
}

function executeMove(move) {
    console.log("Executing move:", move);
    console.log("Current FEN:", game.fen());
    console.log("Current Turn:", game.turn());

    try {
        const result = makeMove(move);
        if (result) {
            movePieceVisual(move.from, move.to, move.promotion);

            // Check for castling
            if (result.flags.includes('k') || result.flags.includes('q')) {
                let rookFrom, rookTo;
                if (result.color === 'w') {
                    if (result.flags.includes('k')) { // White Kingside
                        rookFrom = 'h1';
                        rookTo = 'f1';
                    } else if (result.flags.includes('q')) { // White Queenside
                        rookFrom = 'a1';
                        rookTo = 'd1';
                    }
                } else {
                    if (result.flags.includes('k')) { // Black Kingside
                        rookFrom = 'h8';
                        rookTo = 'f8';
                    } else if (result.flags.includes('q')) { // Black Queenside
                        rookFrom = 'a8';
                        rookTo = 'd8';
                    }
                }

                if (rookFrom && rookTo) {
                    console.log(`Castling detected! Moving rook from ${rookFrom} to ${rookTo}`);
                    movePieceVisual(rookFrom, rookTo);
                }
            }

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
                        const result = makeMove(bestMove);
                        movePieceVisual(bestMove.from, bestMove.to, bestMove.promotion);

                        // Check for castling (AI)
                        if (result && (result.flags.includes('k') || result.flags.includes('q'))) {
                            let rookFrom, rookTo;
                            if (result.color === 'w') {
                                if (result.flags.includes('k')) { rookFrom = 'h1'; rookTo = 'f1'; }
                                else if (result.flags.includes('q')) { rookFrom = 'a1'; rookTo = 'd1'; }
                            } else {
                                if (result.flags.includes('k')) { rookFrom = 'h8'; rookTo = 'f8'; }
                                else if (result.flags.includes('q')) { rookFrom = 'a8'; rookTo = 'd8'; }
                            }
                            if (rookFrom && rookTo) {
                                movePieceVisual(rookFrom, rookTo);
                            }
                        }

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
        let message = "";
        if (game.isCheckmate()) {
            const winner = game.turn() === 'w' ? "Black" : "White";
            message = `Checkmate! ${winner} Wins!`;
        } else if (game.isDraw()) {
            message = "Draw!";
        } else {
            message = "Game Over";
        }
        if (statusDiv) statusDiv.innerText = message;
        showGameOverOverlay(message);
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
    // Use the calibrated board vectors from scene.js
    // This ensures alignment is stable even if pieces move

    // 1. Target axes
    // Local X aligns with Rank direction
    // Local Z aligns with File direction
    const targetX = rankDir.clone();
    const targetZ = fileDir.clone();

    // 2. Calculate the normal (Up vector)
    // Z cross X = Y (Right-handed coordinate system)
    const targetY = new THREE.Vector3().crossVectors(targetZ, targetX).normalize();

    // 3. Re-orthogonalize to ensure a perfect rotation matrix
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

            // Use pieceTemplates instead of searching the board
            const key = color + '_' + promotionType;
            const template = pieceTemplates[key];

            console.log(`Looking for template with key: ${key}`);
            console.log(`Template found:`, template);
            if (template) {
                console.log("Template transforms:", {
                    rotation: template.rotation,
                    scale: template.scale,
                    type: template.type
                });

                const newPiece = template.clone();
                scene.add(newPiece);

                // Use targetPos (center of square) instead of pawn's position
                // This ensures exact centering
                // Since we normalized the template to have bottom at Y=0, we place it at boardY
                newPiece.position.set(targetPos.x, boardY, targetPos.z);

                // Scale and Rotation are now inherited from the template container

                console.log(`[PROMOTION DEBUG]`);
                console.log(`Target Pos:`, targetPos);
                console.log(`Board Y:`, boardY);
                console.log(`Piece Y Offset:`, pieceYOffset);
                console.log(`Initial NewPiece Pos:`, newPiece.position);



                console.log(`New piece created. Scale:`, newPiece.scale);
                console.log(`New piece rotation:`, newPiece.rotation);

                // Adjust Y so the bottom of the new piece is on the board surface
                newPiece.updateMatrixWorld(true);
                const newBbox = new THREE.Box3().setFromObject(newPiece);
                const size = new THREE.Vector3();
                newBbox.getSize(size);
                console.log(`[DEBUG] New Piece Size:`, size);

                const heightAdjustment = boardY - newBbox.min.y;

                newPiece.position.y += heightAdjustment;

                console.log(`Final position:`, newPiece.position);

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
                console.warn(`Could not find template for promotion to ${promotionType} (Key: ${key})`);
                console.warn(`Available templates:`, Object.keys(pieceTemplates));
                // Fallback: Just keep the pawn but change its type in userData (visuals will be wrong but game continues)
                pieceObj.userData.type = promotionType;
            }
        }
    }
}

