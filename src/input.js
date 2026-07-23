import * as THREE from 'three';
import { pieces, boardSquares, stepRank, stepFile, boardY, pieceYOffset, pieceTemplates, BOARD_SCALE, BOARD_ROTATION_Y, rankDir, fileDir, syncBoardVisuals, showCalculationVideo, hideCalculationVideo, controls, renderer } from './scene.js';
import { getMoves, makeMove, game, resetGame, undoMove, saveGameXML, loadGameXML } from './chessLogic.js';

let raycaster;
let mouse;
let camera;
let scene;
let selectedSquare = null;
let highlightedSquares = [];
let selectedHighlight = null;
let selectedPieceGlow = null;
let currentHoveredSquare = null;
let hoverHighlight = null;
// Active highlight meshes whose shaders need a time uniform each frame.
const activeHighlightMeshes = new Set();
let currentDifficulty = 'stockfish_5';
let currentTurnText = 'White\'s Turn';
let isMoveInProgress = false;

const SKILL_MAX = 20;

const SKILL_TIERS = [
    { name: 'Beginner', blurb: 'Makes frequent blunders. Perfect for your first games.', range: [0, 2], color: 'oklch(0.72 0.16 150)' },
    { name: 'Learning', blurb: 'Plays simple, predictable moves while you find your footing.', range: [3, 4], color: 'oklch(0.74 0.15 175)' },
    { name: 'Novice', blurb: 'Knows the basics and punishes obvious mistakes.', range: [5, 6], color: 'oklch(0.68 0.16 230)' },
    { name: 'Intermediate', blurb: 'Plays solid positional chess with real tactics.', range: [7, 9], color: 'oklch(0.66 0.17 255)' },
    { name: 'Advanced', blurb: 'Calculates deeply and rarely lets advantages slip.', range: [10, 12], color: 'oklch(0.78 0.15 85)' },
    { name: 'Expert', blurb: 'Sharp, aggressive, and unforgiving of inaccuracies.', range: [13, 15], color: 'oklch(0.72 0.18 55)' },
    { name: 'Master', blurb: 'Near-flawless play. Expect to be outmaneuvered.', range: [16, 18], color: 'oklch(0.66 0.2 30)' },
    { name: 'God-Mode', blurb: 'Maximum strength. Survival itself is a victory.', range: [19, 20], color: 'oklch(0.62 0.23 22)' },
];

function tierForLevel(level) {
    return SKILL_TIERS.find((t) => level >= t.range[0] && level <= t.range[1]) ?? SKILL_TIERS[0];
}

function estimatedElo(level) {
    const raw = 800 + (level / SKILL_MAX) * 2400;
    return Math.round(raw / 25) * 25;
}

function getCurrentSkillLevel() {
    if (currentDifficulty.startsWith('stockfish_')) {
        return parseInt(currentDifficulty.split('_')[1], 10);
    }
    return 5;
}

function updateSkillDialogUI(level) {
    const tier = tierForLevel(level);
    const dialog = document.getElementById('skill-dialog');
    if (dialog) dialog.style.setProperty('--tier', tier.color);

    const pct = (level / SKILL_MAX) * 100;
    document.getElementById('skill-level-value').textContent = level;
    document.getElementById('skill-tier-name').textContent = tier.name;
    document.getElementById('skill-blurb').textContent = tier.blurb;
    document.getElementById('skill-elo-badge').textContent = `~${estimatedElo(level)} Elo`;
    document.getElementById('skill-slider-count').textContent = `${level} / ${SKILL_MAX}`;
    document.getElementById('skill-slider-fill').style.width = `${pct}%`;
    document.getElementById('skill-slider').value = level;
    document.getElementById('new-game-start').textContent = `Start Game · Level ${level}`;

    const crown = document.getElementById('skill-crown');
    crown.classList.toggle('hidden', level < 19);

    document.getElementById('skill-decrease').disabled = level === 0;
    document.getElementById('skill-increase').disabled = level === SKILL_MAX;

    document.querySelectorAll('.skill-tick').forEach((tick) => {
        tick.classList.toggle('active', parseInt(tick.dataset.level, 10) === level);
    });

    document.querySelectorAll('.skill-preset').forEach((preset) => {
        preset.classList.toggle('active', parseInt(preset.dataset.level, 10) === level);
    });
}

function updateStatusDisplay() {
    const difficultyDiv = document.getElementById('difficulty-display');
    if (difficultyDiv) {
        const level = getCurrentSkillLevel();
        const tier = tierForLevel(level);
        difficultyDiv.textContent = `SL${level} · ${tier.name}`;
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

    // Capture pointerdown before OrbitControls so rotation can be blocked
    // when the press starts on top of the board.
    if (renderer && renderer.domElement) {
        renderer.domElement.addEventListener('pointerdown', onPointerDownCapture, true);
    }

    initToolbar();
    updateStatusDisplay();
}

function onPointerDownCapture(event) {
    updateRotateAllowed(event.clientX, event.clientY);
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

let _boardBounds = null;
function getBoardBounds() {
    if (_boardBounds) return _boardBounds;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const pos of Object.values(boardSquares)) {
        if (pos.x < minX) minX = pos.x;
        if (pos.x > maxX) maxX = pos.x;
        if (pos.z < minZ) minZ = pos.z;
        if (pos.z > maxZ) maxZ = pos.z;
    }
    const pad = (stepRank + stepFile) / 2;
    _boardBounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
    return _boardBounds;
}

function isPointerOverBoard(point) {
    const b = getBoardBounds();
    return point.x >= b.minX && point.x <= b.maxX && point.z >= b.minZ && point.z <= b.maxZ;
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -boardY);
    const intersection = new THREE.Vector3();

    // Only allow left-mouse orbit rotation/tilt when the pointer is outside the board area.
    updateRotateAllowed(event.clientX, event.clientY);

    if (raycaster.ray.intersectPlane(plane, intersection)) {
        handleCellHover(intersection);
    } else {
        clearHoverHighlight();
    }
}

function updateRotateAllowed(clientX, clientY) {
    if (!controls) return;
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -boardY);
    const intersection = new THREE.Vector3();
    const overBoard = raycaster.ray.intersectPlane(plane, intersection) && isPointerOverBoard(intersection);
    controls.enableRotate = !overBoard;
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

    // Match Godot: only white pieces get a hover frame; never stack on the selected square.
    const piece = game.get(square);
    if (!piece || piece.color !== 'w') return;
    if (selectedSquare && selectedSquare === square) return;

    hoverHighlight = createHighlight(square, { animated: true, isHover: true });
}

function clearHoverHighlight() {
    if (hoverHighlight) {
        disposeHighlightMesh(hoverHighlight);
        hoverHighlight = null;
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

    const buttons = modal.querySelectorAll('.promotion-piece');
    const handler = (event) => {
        const piece = event.currentTarget.getAttribute('data-piece');
        if (piece) {
            modal.classList.add('hidden');
            buttons.forEach(btn => btn.removeEventListener('click', handler));
            callback(piece);
        }
    };

    buttons.forEach(btn => btn.addEventListener('click', handler));
}

export function showNewGameModal(isNewGame = true) {
    const modal = document.getElementById('new-game-modal');
    modal.classList.remove('hidden');

    let level = getCurrentSkillLevel();
    updateSkillDialogUI(level);

    const slider = document.getElementById('skill-slider');
    const decreaseBtn = document.getElementById('skill-decrease');
    const increaseBtn = document.getElementById('skill-increase');
    const startBtn = document.getElementById('new-game-start');
    const cancelBtn = document.getElementById('new-game-cancel');
    const closeBtn = document.getElementById('new-game-close');

    if (!isNewGame) {
        cancelBtn.style.display = 'none';
        closeBtn.style.display = 'none';
    }
    const tickBtns = document.querySelectorAll('.skill-tick');
    const presetBtns = document.querySelectorAll('.skill-preset');

    const clamp = (n) => Math.min(SKILL_MAX, Math.max(0, n));
    const setLevel = (n) => {
        level = clamp(n);
        updateSkillDialogUI(level);
    };

    const cleanup = () => {
        slider.removeEventListener('input', onSliderInput);
        decreaseBtn.removeEventListener('click', onDecrease);
        increaseBtn.removeEventListener('click', onIncrease);
        startBtn.removeEventListener('click', onStart);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
        tickBtns.forEach(btn => btn.removeEventListener('click', onTick));
        presetBtns.forEach(btn => btn.removeEventListener('click', onPreset));
        cancelBtn.style.display = '';
        closeBtn.style.display = '';
    };

    const onSliderInput = (e) => setLevel(parseInt(e.target.value, 10));
    const onDecrease = () => setLevel(level - 1);
    const onIncrease = () => setLevel(level + 1);
    const onTick = (e) => setLevel(parseInt(e.currentTarget.dataset.level, 10));
    const onPreset = (e) => setLevel(parseInt(e.currentTarget.dataset.level, 10));

    const onStart = () => {
        modal.classList.add('hidden');
        currentDifficulty = `stockfish_${level}`;
        if (isNewGame) {
            resetGame();
            syncBoardVisuals(game.board());
            clearHighlights();
            clearSelected();
            clearHoverHighlight();
            updateUndoButton();
        }
        updateStatusDisplay();
        cleanup();
    };

    const onCancel = () => {
        modal.classList.add('hidden');
        cleanup();
    };

    slider.addEventListener('input', onSliderInput);
    decreaseBtn.addEventListener('click', onDecrease);
    increaseBtn.addEventListener('click', onIncrease);
    startBtn.addEventListener('click', onStart);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    tickBtns.forEach(btn => btn.addEventListener('click', onTick));
    presetBtns.forEach(btn => btn.addEventListener('click', onPreset));
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
            // Clear selection + legal-move frames before animating so the
            // moving piece's blue glow does not reveal leftover move squares.
            selectedSquare = null;
            clearHighlights();
            clearSelected();
            clearHoverHighlight();

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
// --- Square highlights (ported from ChessGodot highlight.gdshader) ---
// mode: 0 = hover, 1 = allowed move, 2 = selected
const HIGHLIGHT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HIGHLIGHT_FRAG = /* glsl */ `
uniform float timeValue;
uniform float animSpeed;
uniform int mode;
uniform vec3 cyanRim;
uniform vec3 midBlue;
uniform vec3 innerBlue;
uniform float brightness;

varying vec2 vUv;

void main() {
    // Center-based UV (0.0 at center, 0.5 at tile borders)
    vec2 center = abs(vUv - vec2(0.5));
    float boxDist = max(center.x, center.y);

    // Clip strictly to the tile boundary
    if (boxDist > 0.495) discard;

    float t = timeValue * animSpeed;
    float pulse = 0.88 + 0.12 * sin(t * 3.5);

    // Hollow frame: fully transparent center, opacity only along the border.
    float frameAlpha = smoothstep(0.24, 0.38, boxDist) * 0.95;

    // Deep navy (inner) -> electric blue (mid) -> neon cyan (outer rim)
    float midGrad  = smoothstep(0.28, 0.42, boxDist);
    float outerRim = smoothstep(0.43, 0.485, boxDist);

    vec3 col = mix(innerBlue, midBlue, midGrad);
    col = mix(col, cyanRim, outerRim);

    if (mode == 1) {
        // Allowed move: light wave traveling along the frame bevel
        float wave = sin((boxDist * 25.0) - (t * 5.0)) * 0.5 + 0.5;
        col += cyanRim * wave * 0.35 * midGrad;
        col *= pulse;
    } else if (mode == 2) {
        // Selected: bright pulsing frame
        col *= pulse * 1.3;
        frameAlpha = clamp(frameAlpha * 1.1 * pulse, 0.0, 1.0);
    } else {
        // Hover: slightly quieter frame
        frameAlpha *= 0.85;
    }

    gl_FragColor = vec4(col * brightness, frameAlpha);
}
`;

function alignHighlightToBoard(mesh) {
    // Match Godot: plane on board with X along files, normal up.
    // Three.js PlaneGeometry lies in XY with normal +Z, so map Z -> up.
    let side = fileDir && fileDir.lengthSq() > 0.0001
        ? fileDir.clone().normalize()
        : new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    let forward = new THREE.Vector3().crossVectors(up, side).normalize();
    if (forward.lengthSq() < 0.0001) {
        forward.set(0, 0, 1);
    }
    side = new THREE.Vector3().crossVectors(forward, up).normalize();

    const rotationMatrix = new THREE.Matrix4().makeBasis(side, forward, up);
    mesh.setRotationFromMatrix(rotationMatrix);
}

function createHighlightMaterial(mode, animated) {
    const doAnim = animated || mode === 1;
    return new THREE.ShaderMaterial({
        uniforms: {
            timeValue: { value: 0 },
            animSpeed: { value: doAnim ? 1.0 : 0.0 },
            mode: { value: mode },
            cyanRim: { value: new THREE.Color(0.0, 0.85, 1.0) },
            midBlue: { value: new THREE.Color(0.0, 0.40, 0.90) },
            innerBlue: { value: new THREE.Color(0.02, 0.10, 0.45) },
            brightness: { value: 1.1 },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        // Normal alpha blend (Godot blend_mix) — hollow frame, not additive wash.
        blending: THREE.NormalBlending,
        vertexShader: HIGHLIGHT_VERT,
        fragmentShader: HIGHLIGHT_FRAG,
    });
}

/**
 * @param {string} square
 * @param {{ animated?: boolean, isHover?: boolean, isMove?: boolean }} opts
 */
function createHighlight(square, opts = {}) {
    const { animated = true, isHover = false, isMove = false } = opts;
    const pos = boardSquares[square];
    if (!pos) return null;

    // 0 = hover, 1 = allowed move, 2 = selected
    let mode = 2;
    if (isHover) mode = 0;
    else if (isMove) mode = 1;

    const avgStep = (stepRank + stepFile) / 2;
    // Slight oversize so the blue rim sits cleanly on the square edge (Godot: 1.04).
    const size = avgStep * 1.04;

    const geometry = new THREE.PlaneGeometry(size, size);
    const material = createHighlightMaterial(mode, animated);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;

    mesh.position.copy(pos);
    // Sit clearly above the board surface to avoid z-fight.
    const surfaceY = boardY !== undefined ? boardY : pos.y;
    mesh.position.y = surfaceY + 0.004;

    alignHighlightToBoard(mesh);

    scene.add(mesh);
    activeHighlightMeshes.add(mesh);
    return mesh;
}

function disposeHighlightMesh(mesh) {
    if (!mesh) return;
    activeHighlightMeshes.delete(mesh);
    if (mesh.parent) mesh.parent.remove(mesh);
    else scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
}

export function updateInput(time) {
    for (const mesh of activeHighlightMeshes) {
        const mat = mesh.material;
        if (!mat || !mat.uniforms || !mat.uniforms.timeValue) continue;
        const aspeed = mat.uniforms.animSpeed ? mat.uniforms.animSpeed.value : 1.0;
        if (aspeed > 0.0) {
            mat.uniforms.timeValue.value = time;
        }
    }
}

function highlightMoves(square) {
    clearHighlights();
    const moves = getMoves(square);
    moves.forEach((move) => {
        const mesh = createHighlight(move.to, { animated: true, isMove: true });
        if (mesh) highlightedSquares.push(mesh);
    });
}

function highlightSelected(square) {
    clearSelected();
    // Selected frame is bright but non-animated (Godot: animated=false).
    selectedHighlight = createHighlight(square, { animated: false, isHover: false, isMove: false });
}

function clearHighlights() {
    highlightedSquares.forEach((mesh) => disposeHighlightMesh(mesh));
    highlightedSquares = [];
}

function clearSelected() {
    if (selectedHighlight) {
        disposeHighlightMesh(selectedHighlight);
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
    const duration = 1225; // 1.625 seconds animation (30% slower)
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

// --- Capture crack / fragment effect (ported from ChessGodot) ---
const CAPTURE_DURATION = 1180;
const CAPTURE_FRAGMENT_COUNT = 7;
const CAPTURE_MAT_POOL_CAP = 32;

const captureCrackMatPool = [];
const captureFragmentMatPool = [];

const CAPTURE_CRACK_VERT = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vNormalW;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const CAPTURE_CRACK_FRAG = /* glsl */ `
uniform vec3 baseColor;
uniform vec3 crackColor;
uniform float fractureProgress;
uniform float seed;

varying vec3 vWorldPosition;
varying vec3 vNormalW;

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Voronoi-edge pattern: lower values lie closer to a cell boundary (the seam).
float fractureLines(vec3 p) {
    vec2 q = p.xz * 7.5 + p.y * vec2(3.7, -2.9) + seed;
    vec2 cell = floor(q);
    vec2 local = fract(q);
    float nearest = 8.0;
    float second = 8.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y));
            vec2 feature = offset + vec2(hash21(cell + offset), hash21(cell + offset + 19.7));
            float d = length(feature - local);
            if (d < nearest) {
                second = nearest;
                nearest = d;
            } else if (d < second) {
                second = d;
            }
        }
    }
    return second - nearest;
}

void main() {
    float edge = fractureLines(vWorldPosition);
    float reveal = smoothstep(0.07, 0.40, fractureProgress);
    float holeHalf = mix(0.0, 0.078, reveal);
    float rimOuter = holeHalf + mix(0.055, 0.095, reveal);

    // See-through core so the board shows through the seams.
    if (edge < holeHalf) discard;

    float rim = 1.0 - smoothstep(holeHalf, rimOuter, edge);
    float preCrack = 1.0 - smoothstep(0.045, 0.165, edge);
    float preStrength = preCrack * reveal * (1.0 - rim);

    vec3 albedo = mix(baseColor, crackColor, rim * 0.92 + preStrength * 0.55);
    float roughness = mix(0.42, 0.88, max(rim, preStrength));
    vec3 emission = crackColor * rim * 0.14;

    // Simple directional shade so pieces stay readable without full PBR.
    vec3 N = normalize(vNormalW);
    float ndl = max(dot(N, normalize(vec3(0.35, 1.0, 0.45))), 0.0);
    float amb = 0.55 + 0.45 * ndl;
    // Roughness slightly flattens the highlight response.
    amb = mix(amb, 0.72, roughness * 0.35);

    gl_FragColor = vec4(albedo * amb + emission, 1.0);
}
`;

const CAPTURE_FRAGMENT_VERT = /* glsl */ `
varying vec3 vLocalPosition;
varying vec3 vNormalW;

void main() {
    vLocalPosition = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CAPTURE_FRAGMENT_FRAG = /* glsl */ `
uniform vec3 baseColor;
uniform vec3 localMin;
uniform vec3 localSize;
uniform int fragmentIndex;
uniform int fragmentCount;
uniform float seed;

varying vec3 vLocalPosition;
varying vec3 vNormalW;

float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

void main() {
    vec3 size = max(localSize, vec3(0.0001));
    vec3 normalizedPosition = (vLocalPosition - localMin) / size;
    vec3 cell = floor(normalizedPosition * 6.0);
    int assigned = int(floor(hash31(cell + seed) * float(fragmentCount)));
    if (assigned != fragmentIndex) discard;

    vec3 N = normalize(vNormalW);
    float ndl = max(dot(N, normalize(vec3(0.35, 1.0, 0.45))), 0.0);
    float amb = 0.58 + 0.42 * ndl;
    gl_FragColor = vec4(baseColor * amb, 1.0);
}
`;

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInQuad(t) {
    return t * t;
}

function getMaterialBaseColor(material) {
    if (!material) return new THREE.Color(0.55, 0.55, 0.55);
    const mat = Array.isArray(material) ? material[0] : material;
    if (mat && mat.color && mat.color.isColor) {
        return mat.color.clone();
    }
    return new THREE.Color(0.55, 0.55, 0.55);
}

function colorLuminance(c) {
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function acquireCaptureMaterial(pool, kind) {
    while (pool.length > 0) {
        const mat = pool.pop();
        if (mat) return mat;
    }
    if (kind === 'crack') {
        return new THREE.ShaderMaterial({
            uniforms: {
                baseColor: { value: new THREE.Color(0.8, 0.8, 0.8) },
                crackColor: { value: new THREE.Color(0.018, 0.013, 0.011) },
                fractureProgress: { value: 0 },
                seed: { value: 0 },
            },
            vertexShader: CAPTURE_CRACK_VERT,
            fragmentShader: CAPTURE_CRACK_FRAG,
            side: THREE.FrontSide,
        });
    }
    return new THREE.ShaderMaterial({
        uniforms: {
            baseColor: { value: new THREE.Color(0.8, 0.8, 0.8) },
            localMin: { value: new THREE.Vector3(-0.5, -0.5, -0.5) },
            localSize: { value: new THREE.Vector3(1, 1, 1) },
            fragmentIndex: { value: 0 },
            fragmentCount: { value: CAPTURE_FRAGMENT_COUNT },
            seed: { value: 0 },
        },
        vertexShader: CAPTURE_FRAGMENT_VERT,
        fragmentShader: CAPTURE_FRAGMENT_FRAG,
        side: THREE.FrontSide,
    });
}

function releaseCaptureMaterial(pool, mat) {
    if (!mat) return;
    if (pool.length < CAPTURE_MAT_POOL_CAP) {
        pool.push(mat);
    } else {
        mat.dispose();
    }
}

function applyCaptureCrackMaterials(pieceObj) {
    const states = [];
    const worldPos = new THREE.Vector3();
    pieceObj.getWorldPosition(worldPos);
    const seed = Math.abs(worldPos.x * 31.7 + worldPos.z * 67.3) % 97.0;

    pieceObj.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;

        const original = child.material;
        const baseColor = getMaterialBaseColor(original);
        // Charcoal rims on light pieces; warm stone-grey on dark pieces.
        const crackColor = colorLuminance(baseColor) < 0.45
            ? new THREE.Color(0.62, 0.58, 0.52)
            : new THREE.Color(0.018, 0.013, 0.011);

        const fractured = acquireCaptureMaterial(captureCrackMatPool, 'crack');
        fractured.uniforms.baseColor.value.copy(baseColor);
        fractured.uniforms.crackColor.value.copy(crackColor);
        fractured.uniforms.seed.value = seed;
        fractured.uniforms.fractureProgress.value = 0;
        fractured.needsUpdate = true;

        child.material = fractured;
        states.push({ mesh: child, original, fractured });
    });

    return { states, seed };
}

function restoreCaptureMaterials(states) {
    for (const state of states) {
        if (state.mesh) {
            state.mesh.material = state.original;
        }
        if (state.fractured) {
            releaseCaptureMaterial(captureCrackMatPool, state.fractured);
            state.fractured = null;
        }
    }
}

function collectSourceMeshInfos(pieceObj) {
    const infos = [];
    pieceObj.updateMatrixWorld(true);
    const rootInv = pieceObj.matrixWorld.clone().invert();

    pieceObj.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;

        const geom = child.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox();
        const box = geom.boundingBox;
        const localXf = new THREE.Matrix4().multiplyMatrices(rootInv, child.matrixWorld);

        infos.push({
            geometry: geom,
            localMatrix: localXf,
            baseColor: getMaterialBaseColor(child.material),
            localMin: box.min.clone(),
            localSize: box.getSize(new THREE.Vector3()),
        });
    });

    return infos;
}

function animateCaptureFragment(fragment, fragmentIndex, seed) {
    const start = fragment.position.clone();
    const angle = seed + (fragmentIndex * Math.PI * 2) / CAPTURE_FRAGMENT_COUNT;
    // Same world-space offsets as ChessGodot (board is already at BOARD_SCALE).
    const distance = 0.018 + 0.055 * ((fragmentIndex * 5) % 4);
    const end = start.clone().add(new THREE.Vector3(
        Math.cos(angle) * distance,
        -0.10 - 0.018 * (fragmentIndex % 3),
        Math.sin(angle) * distance
    ));
    end.y = Math.min(end.y, boardY + 0.018);

    const startRot = fragment.rotation.clone();
    const tumble = new THREE.Euler(
        startRot.x + 0.10 * Math.sin(angle * 1.7),
        startRot.y + 0.18 * Math.cos(angle),
        startRot.z + 0.10 * Math.sin(angle * 0.7)
    );
    const startScale = fragment.scale.clone();
    const midScale = startScale.clone().multiplyScalar(0.88);

    const fallMs = 560;
    const shrinkMs = 200;
    const t0 = performance.now();

    return new Promise((resolve) => {
        function step(now) {
            const elapsed = now - t0;
            if (elapsed < fallMs) {
                const t = easeInQuad(elapsed / fallMs);
                fragment.position.lerpVectors(start, end, t);
                fragment.rotation.x = THREE.MathUtils.lerp(startRot.x, tumble.x, t);
                fragment.rotation.y = THREE.MathUtils.lerp(startRot.y, tumble.y, t);
                fragment.rotation.z = THREE.MathUtils.lerp(startRot.z, tumble.z, t);
                fragment.scale.lerpVectors(startScale, midScale, t);
                requestAnimationFrame(step);
                return;
            }

            const shrinkT = Math.min((elapsed - fallMs) / shrinkMs, 1);
            const st = easeInQuad(shrinkT);
            fragment.position.copy(end);
            fragment.rotation.copy(tumble);
            fragment.scale.copy(midScale).multiplyScalar(1 - st);

            if (shrinkT < 1) {
                requestAnimationFrame(step);
                return;
            }

            // Detach materials before pooling; free the fragment group.
            fragment.traverse((child) => {
                if (!child.isMesh) return;
                const mat = child.material;
                if (mat && mat.isShaderMaterial) {
                    child.material = null;
                    releaseCaptureMaterial(captureFragmentMatPool, mat);
                }
            });
            if (fragment.parent) fragment.parent.remove(fragment);
            resolve();
        }
        requestAnimationFrame(step);
    });
}

function spawnCaptureFragments(pieceObj, seed) {
    const sourceTransform = pieceObj.matrixWorld.clone();
    const meshInfos = collectSourceMeshInfos(pieceObj);
    if (meshInfos.length === 0) return;

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    sourceTransform.decompose(pos, quat, scl);

    for (let fragmentIndex = 0; fragmentIndex < CAPTURE_FRAGMENT_COUNT; fragmentIndex++) {
        const fragment = new THREE.Group();
        fragment.name = 'CaptureFragment';
        fragment.position.copy(pos);
        fragment.quaternion.copy(quat);
        fragment.scale.copy(scl);
        scene.add(fragment);

        for (const info of meshInfos) {
            const mesh = new THREE.Mesh(info.geometry);
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            // Local pose relative to the piece root.
            const lp = new THREE.Vector3();
            const lq = new THREE.Quaternion();
            const ls = new THREE.Vector3();
            info.localMatrix.decompose(lp, lq, ls);
            mesh.position.copy(lp);
            mesh.quaternion.copy(lq);
            mesh.scale.copy(ls);

            const material = acquireCaptureMaterial(captureFragmentMatPool, 'fragment');
            material.uniforms.baseColor.value.copy(info.baseColor);
            material.uniforms.localMin.value.copy(info.localMin);
            material.uniforms.localSize.value.copy(info.localSize);
            material.uniforms.fragmentIndex.value = fragmentIndex;
            material.uniforms.fragmentCount.value = CAPTURE_FRAGMENT_COUNT;
            material.uniforms.seed.value = seed;
            material.needsUpdate = true;
            mesh.material = material;
            fragment.add(mesh);
        }

        // Fire-and-forget: fragments continue after the main capture promise resolves.
        animateCaptureFragment(fragment, fragmentIndex, seed);
    }
}

function animateCapture(pieceObj) {
    return new Promise((resolve) => {
        if (!pieceObj) {
            resolve();
            return;
        }

        const startScale = pieceObj.scale.clone();
        const startQuaternion = pieceObj.quaternion.clone();
        const startPosition = pieceObj.position.clone();
        const { states, seed } = applyCaptureCrackMaterials(pieceObj);
        let fragmentsStarted = false;
        const startTime = performance.now();

        function finish() {
            restoreCaptureMaterials(states);
            pieceObj.visible = true;
            pieceObj.scale.copy(startScale);
            pieceObj.quaternion.copy(startQuaternion);
            pieceObj.position.copy(startPosition);
            if (pieceObj.parent) pieceObj.parent.remove(pieceObj);
            resolve();
        }

        function animate(now) {
            const progress = Math.min((now - startTime) / CAPTURE_DURATION, 1);
            // Partly-open seam on frame 0 so the player sees an immediate reaction.
            const fracture = THREE.MathUtils.lerp(0.18, 1.0, easeInOutCubic(progress));

            for (const state of states) {
                if (state.fractured) {
                    state.fractured.uniforms.fractureProgress.value = fracture;
                }
            }

            // Hold the full piece still while seams form.
            pieceObj.scale.copy(startScale);
            pieceObj.quaternion.copy(startQuaternion);
            pieceObj.position.copy(startPosition);

            if (fracture >= 0.64 && !fragmentsStarted) {
                // Restore originals before sampling base colors for fragments.
                restoreCaptureMaterials(states);
                spawnCaptureFragments(pieceObj, seed);
                pieceObj.visible = false;
                fragmentsStarted = true;
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                finish();
            }
        }

        requestAnimationFrame(animate);
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