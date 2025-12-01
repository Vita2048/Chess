import * as THREE from 'three';
import { pieces, boardSquares, stepRank, stepFile, boardY, pieceYOffset, boardMesh, pieceTemplates, BOARD_SCALE, BOARD_ROTATION_Y, rankDir, fileDir, syncBoardVisuals, showCalculationVideo, hideCalculationVideo } from './scene.js';
import { getMoves, makeMove, game, resetGame, undoMove, saveGameXML, loadGameXML } from './chessLogic.js';

let raycaster;
let mouse;
let camera;
let scene;
let selectedSquare = null;
let highlightedSquares = [];
let selectedHighlight = null;
let selectedPieceGlow = null;
let moveHighlightAnimations = [];
let currentHoveredSquare = null;
let hoverHighlight = null;
let hoverFlashingInterval = null;
let currentDifficulty = 'stockfish_3';
let currentTurnText = 'White\'s Turn';
let isMoveInProgress = false;

function updateStatusDisplay() {
    // Update difficulty display
    const difficultyDiv = document.getElementById('difficulty-display');
    if (difficultyDiv) {
        let level = currentDifficulty;
        if (currentDifficulty.startsWith('stockfish_')) {
            const skill = currentDifficulty.split('_')[1];
            const labels = {
                '3': 'SL3 Learning 1', '4': 'SL4 Learning 2',
                '5': 'SL5 Novice', '7': 'SL7 Moderate', '10': 'SL10 Advanced',
                '15': 'SL15 Expert', '18': 'SL18 Unbeatable', '20': 'SL20 God-Mode'
            };
            level = labels[skill] || `SL${skill}`;
        } else {
            level = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
        }
        difficultyDiv.innerText = level;
    }

    // Update turn status
    const statusDiv = document.getElementById('top-center-status');
    if (statusDiv) {
        statusDiv.innerText = currentTurnText;
    }
}

export function initInput(cam, sc) {
    camera = cam;
    scene = sc;
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    console.log("Input initialized! Click listener attached.");
    window.addEventListener('click', onMouseClick, false);
    window.addEventListener('mousemove', onMouseMove, false);

    initToolbar();
    updateStatusDisplay();
}

function updateUndoButton() {
    const undoBtn = document.getElementById('btn-undo');
    const hasHistory = game.history().length > 0;
    const isWhiteTurn = game.turn() === 'w';
    const noAnimation = !isMoveInProgress;

    const shouldEnable = hasHistory && isWhiteTurn && noAnimation;
    undoBtn.disabled = !shouldEnable;

    console.log('updateUndoButton:', { hasHistory, isWhiteTurn, noAnimation, shouldEnable, disabled: undoBtn.disabled });
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
        if (isMoveInProgress) {
            alert("Cannot undo while pieces are moving!");
            return;
        }
        if (game.history().length === 0) {
            alert("No moves to undo!");
            return;
        }
        undoMove();
        syncBoardVisuals(game.board());
        clearHighlights();
        clearSelected();
        clearHoverHighlight();
        updateUndoButton();
    });

    updateUndoButton();

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
                updateUndoButton();
                // Show difficulty dialog for loaded game
                showNewGameModal(false);
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

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -boardY);
    const intersection = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(plane, intersection)) {
        handleBoardClick(intersection);
    }
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -boardY);
    const intersection = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(plane, intersection)) {
        handleCellHover(intersection);
    } else {
        clearHoverHighlight();
    }
}

function handleCellHover(point) {
    let closestSquare = null;
    let minDist = Infinity;

    for (const [sq, pos] of Object.entries(boardSquares)) {
        const dist = point.distanceTo(pos);
        const avgStep = (stepRank + stepFile) / 2;
        if (dist < avgStep * 0.8) {
            if (dist < minDist) {
                minDist = dist;
                closestSquare = sq;
            }
        }
    }

    if (closestSquare) {
        updateHoverHighlight(closestSquare);
    } else {
        clearHoverHighlight();
    }
}

function updateHoverHighlight(square) {
    if (currentHoveredSquare === square) return;
    clearHoverHighlight();
    currentHoveredSquare = square;

    if (isMoveInProgress || game.turn() !== 'w') return;

    const piece = game.get(square);
    if (!piece || piece.color !== 'w') return;

    let flashing = true;
    if (selectedSquare && selectedSquare === square) {
        return;
    }

    showHoverHighlight(square, flashing);
}

function showHoverHighlight(square, flashing) {
    clearHoverHighlight();

    const pos = boardSquares[square];
    const avgStep = (stepRank + stepFile) / 2;
    const size = avgStep * 1.22;

    const geometry = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geometry, highlightMaterial.clone());

    mesh.position.copy(pos);
    mesh.position.y = boardY + 0.01;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(BOARD_ROTATION_Y));

    scene.add(mesh);
    hoverHighlight = mesh;

    if (flashing) {
        hoverFlashingInterval = setInterval(() => {
            mesh.visible = !mesh.visible;
        }, 250);
    }
}

function clearHoverHighlight() {
    if (hoverHighlight) {
        scene.remove(hoverHighlight);
        hoverHighlight = null;
    }
    if (hoverFlashingInterval) {
        clearInterval(hoverFlashingInterval);
        hoverFlashingInterval = null;
    }
    currentHoveredSquare = null;
}

async function handleSquareClick(square) {
    console.log("Clicked square:", square);

    // Prevent user input during animations or when it's not their turn
    if (isMoveInProgress || game.turn() !== 'w') {
        console.log("Ignoring click during animation or opponent's turn");
        return;
    }

    const piece = game.get(square);
    console.log("handleSquareClick: square =", square, "current turn =", game.turn(), "piece =", piece ? piece.color + piece.type : 'none');

    // If clicking on a different white piece while another is selected, select the new one
    if (piece && piece.color === game.turn() && selectedSquare && selectedSquare !== square) {
        console.log("Reselecting piece at", square);
        selectedSquare = square;
        highlightSelected(square);
        highlightMoves(square);
        clearHoverHighlight();
        return;
    }

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
        await executeMove(move);
        return; // Don't continue to piece selection after executing a move
    }

    if (piece && piece.color === game.turn()) {
        console.log("Selecting piece at", square);
        selectedSquare = square;
        highlightSelected(square);
        highlightMoves(square);
        clearHoverHighlight();
    } else {
        console.log("Not selecting piece at", square, "- either no piece or wrong color/turn");
        selectedSquare = null;
        clearHighlights();
        clearSelected();
        clearHoverHighlight();
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

export function showNewGameModal(isNewGame = true) {
    const modal = document.getElementById('new-game-modal');
    modal.classList.remove('hidden');

    const stockfishBtns = document.querySelectorAll('.stockfish-btn');
    const cancelBtn = document.getElementById('new-game-cancel');

    const startNewGame = (difficulty) => {
        modal.classList.add('hidden');
        currentDifficulty = difficulty;
        if (isNewGame) {
            resetGame();
            syncBoardVisuals(game.board());
            clearHighlights();
            clearSelected();
            clearHoverHighlight();
            updateUndoButton();
        }
        updateStatusDisplay();
        // Remove listeners
        stockfishBtns.forEach(btn => btn.removeEventListener('click', stockfishHandler));
        cancelBtn.removeEventListener('click', cancelHandler);
    };

    const stockfishHandler = (e) => {
        const level = e.target.getAttribute('data-level');
        startNewGame(`stockfish_${level}`);
    };

    const cancelHandler = () => {
        modal.classList.add('hidden');
        stockfishBtns.forEach(btn => btn.removeEventListener('click', stockfishHandler));
        cancelBtn.removeEventListener('click', cancelHandler);
    };

    stockfishBtns.forEach(btn => btn.addEventListener('click', stockfishHandler));
    cancelBtn.addEventListener('click', cancelHandler);
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

async function executeMove(move) {
    console.log("Executing move:", move);
    console.log("Current FEN:", game.fen());
    console.log("Current Turn:", game.turn());

    try {
        const result = makeMove(move);
        console.log("Move result:", result);
        if (result && result.flags) {
            console.log("Move flags:", result.flags);
            if (result.flags.includes('e')) {
                console.log("En passant capture detected");
            }
        }
        console.log("Board after move:", game.board());
        if (result) {
            // Clear selection glow before animating (restore original materials first)
            clearSelected();

            // Wait for move and capture animations to complete
            await movePieceVisual(move.from, move.to, move.promotion, true);
            console.log("Pieces after visual move:", Object.keys(pieces));

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
                    console.log(`Before rook move: pieces[${rookFrom}] =`, !!pieces[rookFrom], `game.get(${rookFrom}) =`, game.get(rookFrom));
                    await movePieceVisual(rookFrom, rookTo, null, true);
                    console.log(`After rook move: pieces[${rookTo}] =`, !!pieces[rookTo], `game.get(${rookTo}) =`, game.get(rookTo));
                }
            }

            await removeCapturedPieces();
            console.log("Pieces after removeCapturedPieces:", Object.keys(pieces));

            selectedSquare = null;
            clearHighlights();
            clearSelected();

            // Check if User ended the game
            if (await checkGameOver()) return;

            updateUndoButton();

            // Trigger AI move
            currentTurnText = "Computer is thinking...";
            updateStatusDisplay();

            // Show calculation video
            showCalculationVideo();

            // Use Web Worker for AI calculation to keep UI responsive
            const worker = new Worker('/Chess/aiWorker.js');
            worker.postMessage({ fen: game.fen(), difficulty: currentDifficulty });
            worker.onmessage = async function (e) {
                const bestMove = e.data;
                worker.terminate(); // Clean up worker
                if (bestMove) {
                    isMoveInProgress = true;
                    console.log("AI executing move:", bestMove);
                    const result = makeMove(bestMove);
                    console.log("AI move result:", result);
                    if (result && result.flags) {
                        console.log("AI move flags:", result.flags);
                        if (result.flags.includes('e')) {
                            console.log("AI en passant capture detected");
                        }
                    }
                    console.log("Board after AI move:", game.board());
                    await movePieceVisual(bestMove.from, bestMove.to, bestMove.promotion, true);
                    console.log("Pieces after AI visual move:", Object.keys(pieces));

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
                            await movePieceVisual(rookFrom, rookTo, null, true);
                        }
                    }

                    await removeCapturedPieces();
                    console.log("Pieces after AI removeCapturedPieces:", Object.keys(pieces));

                    // Hide calculation video and update status after move completes
                    hideCalculationVideo();
                    currentTurnText = "White's Turn";
                    updateStatusDisplay();
                    isMoveInProgress = false;
                    checkGameOver();
                    updateUndoButton();
                } else {
                    // AI has no moves? Check game over again
                    if (!await checkGameOver()) {
                        console.error("AI returned no move but game is not over?");
                    }
                }
            };
            worker.onerror = function (error) {
                // Hide calculation video on error
                hideCalculationVideo();
                console.error('AI Worker error:', error);
                worker.terminate();
            };
            return;
        } else {
            // Move was invalid (chess.js rejected it)
            console.warn("Invalid move - chess.js rejected:", move);
            selectedSquare = null;
            clearHighlights();
            clearSelected();
            clearHoverHighlight();
        }
    } catch (e) {
        // Invalid move
        console.warn("Invalid move attempt:", move);
        console.error("Move error details:", e);
        selectedSquare = null;
        clearHighlights();
        clearSelected();
        clearHoverHighlight();
        clearHoverHighlight();
    }
}

async function checkGameOver() {
    const statusDiv = document.getElementById('top-center-status');
    if (game.isGameOver()) {
        let message = "";
        if (game.isCheckmate()) {
            const winner = game.turn() === 'w' ? "Black" : "White";
            message = `Checkmate! ${winner} Wins!`;

            // Animate King Perish
            const loserColor = game.turn(); // 'w' or 'b' (current turn is loser)
            const kingType = loserColor === 'w' ? 'k' : 'k'; // King type is 'k'

            // Find the King piece
            let kingSquare = null;
            for (const sq in pieces) {
                const piece = pieces[sq];
                if (piece.userData.type === 'k' && piece.userData.color === loserColor) {
                    kingSquare = sq;
                    break;
                }
            }

            if (kingSquare && pieces[kingSquare]) {
                console.log(`Checkmate! Animating King perish at ${kingSquare}`);
                await animateCapture(pieces[kingSquare]);
            }

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
        if (dist < avgStep * 0.8) {
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
const highlightUniforms = {
    time: { value: 0 }
};

const highlightMaterial = new THREE.ShaderMaterial({
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

            // VERY THICK glowing border (2.5x previous)
            float inner = 0.32;
            float outer = 0.50;

            float border = 1.0 - smoothstep(inner, inner + 0.05, box);      // Sharp inner edge
            border += smoothstep(outer - 0.12, outer, box);                 // Wide soft outer glow

            // Animated flashing energy waves flowing around the edge
            float wave = sin((box - 0.3) * 25.0 - time * 12.0) * 0.5 + 0.5;
            float flash = pow(wave, 4.0) * (0.6 + 0.4 * sin(time * 8.0));

            // Dark, intense blue (no more washed-out cyan)
            vec3 darkBlue   = vec3(0.00, 0.02, 0.18);
            vec3 midBlue    = vec3(0.00, 0.10, 0.45);
            vec3 brightBlue = vec3(0.10, 0.35, 0.95);
            vec3 whiteFlash = vec3(0.70, 0.90, 1.00);

            vec3 color = mix(darkBlue, midBlue, border);
            color = mix(color, brightBlue, border * 1.2);
            color = mix(color, whiteFlash, flash * border);

            // Strong pulsing intensity
            float pulse = 0.7 + 0.3 * sin(time * 10.0);
            float intensity = (border * 1.8 + flash * 2.5) * pulse;

            // EXTREMELY HIGH alpha → no transparency problems
            float alpha = intensity * 28.0;

            // Clean cutoff
            if (box > 0.52) discard;

            gl_FragColor = vec4(color, alpha);
        }
    `
});

export function updateInput(time) {
    highlightMaterial.uniforms.time.value = time;
}

function highlightMoves(square) {
    clearHighlights();
    const moves = getMoves(square);
    moves.forEach(move => {
        const targetSquare = move.to;
        const pos = boardSquares[targetSquare];
        if (!pos) return;

        const avgStep = (stepRank + stepFile) / 2;
        const size = avgStep * 1.22;  // Much larger to show full thick glow

        const geometry = new THREE.PlaneGeometry(size, size);
        const mesh = new THREE.Mesh(geometry, highlightMaterial);

        mesh.position.copy(pos);
        const surfaceY = boardY !== undefined ? boardY : pos.y;
        mesh.position.y = surfaceY + 0.01;  // Higher to avoid z-fighting

        mesh.rotation.x = -Math.PI / 2;
        mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(BOARD_ROTATION_Y));

        scene.add(mesh);
        highlightedSquares.push(mesh);
    });
}

function highlightSelected(square) {
    clearSelected();
    const pos = boardSquares[square];
    const avgStep = (stepRank + stepFile) / 2;
    const size = avgStep * 1.22;

    const geometry = new THREE.PlaneGeometry(size, size);
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
                float box = max(center.x, center.y);

                float inner = 0.32;
                float outer = 0.50;

                float border = 1.0 - smoothstep(inner, inner + 0.05, box);
                border += smoothstep(outer - 0.12, outer, box);

                vec3 darkBlue   = vec3(0.00, 0.02, 0.18);
                vec3 midBlue    = vec3(0.00, 0.10, 0.45);
                vec3 brightBlue = vec3(0.10, 0.35, 0.95);

                vec3 color = mix(darkBlue, midBlue, border);
                color = mix(color, brightBlue, border * 1.2);

                float intensity = border * 1.8;

                float alpha = intensity * 28.0;

                if (box > 0.52) discard;

                gl_FragColor = vec4(color, alpha);
            }
        `
    });
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.copy(pos);
    mesh.position.y = boardY + 0.01;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(BOARD_ROTATION_Y));

    scene.add(mesh);
    selectedHighlight = mesh;
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

    if (selectedPieceGlow && selectedPieceGlow.originalMaterials) {
        selectedPieceGlow.originalMaterials.forEach(({ mesh, material }) => {
            mesh.material = material;
            mesh.material.needsUpdate = true;
        });
        selectedPieceGlow = null;
    }
}

function movePieceVisual(from, to, promotionType, animate = false) {
    return new Promise((resolve) => {
        isMoveInProgress = true;
        updateUndoButton();
        const pieceObj = pieces[from];
        const targetPos = boardSquares[to];
        const promises = [];

        if (pieceObj && targetPos) {
            if (pieces[to]) {
                // Trigger capture animation
                console.log(`Capturing piece at ${to}`);
                promises.push(animateCapture(pieces[to]));
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

            // Store original position for animation
            const originalPosition = pieceObj.position.clone();

            // Calculate final position by temporarily moving piece
            pieceObj.position.copy(worldTarget);

            // Center the piece in the cell by adjusting based on its bounding box
            pieceObj.updateMatrixWorld(true);
            const bbox = new THREE.Box3().setFromObject(pieceObj);
            const currentCenter = new THREE.Vector3();
            bbox.getCenter(currentCenter);

            // Calculate horizontal offset to center the piece
            const horizontalOffset = worldTarget.clone().sub(currentCenter);
            horizontalOffset.y = 0; // Keep Y for now
            pieceObj.position.add(horizontalOffset);

            // Adjust Y so the bottom of the piece is on the board surface
            pieceObj.updateMatrixWorld(true);
            const updatedBbox = new THREE.Box3().setFromObject(pieceObj);
            pieceObj.position.y += boardY - updatedBbox.min.y;

            // Store the final position
            const finalPosition = pieceObj.position.clone();

            if (animate) {
                // Reset to original position for animation
                pieceObj.position.copy(originalPosition);
                // Animate the move with glow
                promises.push(new Promise(r => {
                    animatePieceMove(pieceObj, finalPosition, () => {
                        finalizeMove(pieceObj, to, from, promotionType, finalPosition);
                        r();
                    });
                }));
            } else {
                // Set position immediately
                pieceObj.position.copy(finalPosition);
                finalizeMove(pieceObj, to, from, promotionType, finalPosition);
            }
        }

        Promise.all(promises).then(() => {
            isMoveInProgress = false;
            resolve();
        });
    });
}

function animatePieceMove(pieceObj, targetPos, callback) {
    const startPos = pieceObj.position.clone();
    const duration = 1625; // 1.625 seconds animation (30% slower)
    const startTime = Date.now();

    // === ENHANCED MULTI-LAYER GLOW SYSTEM ===

    // 1. Bright central core light (intense white-blue)
    const coreLight = new THREE.PointLight(0x5588cc, 4.0, 12);
    coreLight.position.copy(startPos);
    scene.add(coreLight);

    // 2. Mid-range blue glow
    const midGlow = new THREE.PointLight(0x2255aa, 2.5, 18);
    midGlow.position.copy(startPos);
    scene.add(midGlow);

    // 3. Outer soft blue aura
    const outerGlow = new THREE.PointLight(0x002266, 1.5, 25);
    outerGlow.position.copy(startPos);
    scene.add(outerGlow);

    // 4. Create glowing sphere around the piece (inner glow)
    const innerGlowGeometry = new THREE.SphereGeometry(0.8, 16, 16);
    const innerGlowMaterial = new THREE.MeshBasicMaterial({
        color: 0x4488bb,
        transparent: true,
        opacity: 0.2,
        side: THREE.BackSide
    });
    const innerGlowSphere = new THREE.Mesh(innerGlowGeometry, innerGlowMaterial);
    innerGlowSphere.position.copy(startPos);
    scene.add(innerGlowSphere);

    // 5. Create outer radial glow sphere
    const outerGlowGeometry = new THREE.SphereGeometry(1.5, 16, 16);
    const outerGlowMaterial = new THREE.MeshBasicMaterial({
        color: 0x113388,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide
    });
    const outerGlowSphere = new THREE.Mesh(outerGlowGeometry, outerGlowMaterial);
    outerGlowSphere.position.copy(startPos);
    scene.add(outerGlowSphere);

    // 6. Create radial light rays effect (star burst)
    const raysMaterial = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
            time: { value: 0 },
            opacity: { value: 0.3 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform float opacity;
            varying vec2 vUv;
            void main() {
                vec2 center = vec2(0.5, 0.5);
                vec2 toCenter = vUv - center;
                float dist = length(toCenter);
                float angle = atan(toCenter.y, toCenter.x);
                
                // Create radial rays
                float rays = abs(sin(angle * 8.0 + time * 3.0));
                rays = pow(rays, 3.0);
                
                // Fade from center
                float radialFade = 1.0 - smoothstep(0.0, 0.5, dist);
                
                // Bright blue color
                vec3 color = vec3(0.15, 0.35, 0.7);
                float alpha = rays * radialFade * opacity;
                
                gl_FragColor = vec4(color, alpha);
            }
        `
    });

    const raysGeometry = new THREE.PlaneGeometry(3, 3);
    const raysMesh = new THREE.Mesh(raysGeometry, raysMaterial);
    raysMesh.position.copy(startPos);
    raysMesh.position.y += 0.1; // Slightly above board
    raysMesh.rotation.x = -Math.PI / 2; // Lay flat
    scene.add(raysMesh);

    // Make piece highly emissive for intense glow
    // IMPORTANT: Clone materials first to avoid affecting all pieces of the same type
    let originalMaterials = [];
    pieceObj.traverse((child) => {
        if (child.isMesh && child.material) {
            // Store original material
            originalMaterials.push({
                mesh: child,
                material: child.material
            });

            // Clone the material so we don't affect other pieces
            child.material = child.material.clone();

            // Apply intense blue emissive glow to the cloned material
            child.material.emissive = new THREE.Color(0x114488);
            child.material.emissiveIntensity = 1.75;
            if (child.material.color) {
                child.material.color = new THREE.Color(0x5588bb);
            }
            child.material.needsUpdate = true;
        }
    });

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Smooth easing with slight bounce at end
        const easeProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // Move piece
        pieceObj.position.lerpVectors(startPos, targetPos, easeProgress);

        // Calculate current center of the piece
        pieceObj.updateMatrixWorld(true);
        const bbox = new THREE.Box3().setFromObject(pieceObj);
        const center = new THREE.Vector3();
        bbox.getCenter(center);

        // Update all glow elements to follow piece center
        coreLight.position.copy(center);
        midGlow.position.copy(center);
        outerGlow.position.copy(center);
        innerGlowSphere.position.copy(center);
        outerGlowSphere.position.copy(center);
        raysMesh.position.copy(center);
        raysMesh.position.y += 0.1;

        // Pulsing intensity (faster, more dramatic)
        const pulse = Math.sin(progress * Math.PI * 6); // 3 full pulses
        const intensityMultiplier = 1.0 + pulse * 0.5;

        coreLight.intensity = 4.0 * intensityMultiplier;
        midGlow.intensity = 2.5 * intensityMultiplier;
        outerGlow.intensity = 1.5 * intensityMultiplier;

        // Pulsing glow spheres
        const sphereScale = 1.0 + pulse * 0.3;
        innerGlowSphere.scale.setScalar(sphereScale);
        outerGlowSphere.scale.setScalar(sphereScale * 0.9);

        // Rotate rays for dynamic effect
        raysMesh.rotation.z += 0.02;
        raysMaterial.uniforms.time.value = progress * 10;
        raysMaterial.uniforms.opacity.value = 0.3 * (1.0 - progress * 0.3);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Cleanup
            scene.remove(coreLight);
            scene.remove(midGlow);
            scene.remove(outerGlow);
            scene.remove(innerGlowSphere);
            scene.remove(outerGlowSphere);
            scene.remove(raysMesh);

            // Restore original materials
            originalMaterials.forEach(({ mesh, material }) => {
                mesh.material = material;
                mesh.material.needsUpdate = true;
            });

            if (callback) callback();
        }
    }

    animate();
}

function finalizeMove(pieceObj, to, from, promotionType, finalPosition) {
    // Update internal state
    pieces[to] = pieceObj;
    delete pieces[from];
    pieceObj.userData.square = to;

    // Handle promotion
    if (promotionType) {
        console.log(`Promoting piece at ${to} to ${promotionType}`);
        // Remove old pawn
        if (pieceObj.parent) pieceObj.parent.remove(pieceObj);

        // Create new piece
        const color = pieceObj.userData.color;
        const key = color + '_' + promotionType;
        const template = pieceTemplates[key];

        if (template) {
            const newPiece = template.clone();
            scene.add(newPiece);
            newPiece.position.copy(finalPosition);
            newPiece.userData = { square: to, color: color, type: promotionType };
            pieces[to] = newPiece;
    
            // Recalculate Y position based on new piece's bounding box to ensure it sits on the board
            newPiece.updateMatrixWorld(true);
            const bbox = new THREE.Box3().setFromObject(newPiece);
            newPiece.position.y = boardY - bbox.min.y;
    
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

function animateCapture(pieceObj) {
    return new Promise((resolve) => {
        const startScale = pieceObj.scale.clone();
        const startTime = Date.now();
        const duration = 500;

        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Shrink and spin
            const scale = 1 - progress;
            pieceObj.scale.set(startScale.x * scale, startScale.y * scale, startScale.z * scale);
            pieceObj.rotation.y += 0.2;

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                if (pieceObj.parent) pieceObj.parent.remove(pieceObj);
                resolve();
            }
        }
        animate();
    });
}

async function removeCapturedPieces() {
    const squaresToRemove = [];
    for (const sq in pieces) {
        if (!game.get(sq)) {
            squaresToRemove.push(sq);
        }
    }
    console.log(`Squares to remove:`, squaresToRemove);
    for (const sq of squaresToRemove) {
        console.log(`Removing captured piece at ${sq}`);
        await animateCapture(pieces[sq]);
        delete pieces[sq];
    }
}