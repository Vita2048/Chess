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
let selectedPieceGlow = null;
let moveHighlightAnimations = [];

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
            // Clear selection glow before animating (restore original materials first)
            clearSelected();
            movePieceVisual(move.from, move.to, move.promotion, true); // Animate white pieces with blue glow

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
                        movePieceVisual(bestMove.from, bestMove.to, bestMove.promotion, true);

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
                                movePieceVisual(rookFrom, rookTo, null, true);
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
            }, 1700); // Wait for white piece animation to complete (1625ms + buffer)
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
    const pieceObj = pieces[square];

    if (pieceObj) {
        // === STATIC BLUE GLOW ON SELECTED PIECE (no selection box) ===
        const originalMaterials = [];
        pieceObj.traverse((child) => {
            if (child.isMesh && child.material) {
                originalMaterials.push({
                    mesh: child,
                    material: child.material
                });

                child.material = child.material.clone();
                child.material.emissive = new THREE.Color(0x114488);
                child.material.emissiveIntensity = 1.75;
                if (child.material.color) {
                    child.material.color = new THREE.Color(0x5588bb);
                }
                child.material.needsUpdate = true;
            }
        });

        selectedPieceGlow = { originalMaterials: originalMaterials };
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

    if (selectedPieceGlow && selectedPieceGlow.originalMaterials) {
        selectedPieceGlow.originalMaterials.forEach(({ mesh, material }) => {
            mesh.material = material;
            mesh.material.needsUpdate = true;
        });
        selectedPieceGlow = null;
    }
}

function movePieceVisual(from, to, promotionType, animate = false) {
    const pieceObj = pieces[from];
    const targetPos = boardSquares[to];

    if (pieceObj && targetPos) {
        if (pieces[to]) {
            // Trigger capture animation
            console.log(`Capturing piece at ${to}`);
            animateCapture(pieces[to]);
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
            animatePieceMove(pieceObj, finalPosition, () => {
                finalizeMove(pieceObj, to, from, promotionType, finalPosition);
            });
        } else {
            // Set position immediately
            pieceObj.position.copy(finalPosition);
            finalizeMove(pieceObj, to, from, promotionType, finalPosition);
        }
    }
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

        // Update all glow elements to follow piece
        coreLight.position.copy(pieceObj.position);
        midGlow.position.copy(pieceObj.position);
        outerGlow.position.copy(pieceObj.position);
        innerGlowSphere.position.copy(pieceObj.position);
        outerGlowSphere.position.copy(pieceObj.position);
        raysMesh.position.copy(pieceObj.position);
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

        // Pulse piece emissive
        const emissivePulse = 1.75 + pulse * 0.75;
        pieceObj.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.emissiveIntensity = emissivePulse;
                child.material.needsUpdate = true;
            }
        });

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Cleanup - remove all glow effects
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

            callback();
        }
    }

    animate();
}

function finalizeMove(pieceObj, to, from, promotionType, finalPosition) {
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
            newPiece.position.set(finalPosition.x, boardY, finalPosition.z);

            // Scale and Rotation are now inherited from the template container

            console.log(`[PROMOTION DEBUG]`);
            console.log(`Target Pos:`, finalPosition);
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

function animateCapture(pieceObj) {
    // 1. Clone materials for transparency
    const materials = [];
    pieceObj.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material = child.material.clone();
            child.material.transparent = true;
            materials.push(child.material);
        }
    });

    const startScale = pieceObj.scale.clone();
    const startPos = pieceObj.position.clone();
    const startTime = Date.now();
    const duration = 2000; // Slower animation (2 seconds)

    // === FLAME EFFECT ===
    // Create a "shell" mesh for the flame effect
    const flameMeshes = [];
    const flameMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            time: { value: 0 },
            color1: { value: new THREE.Color(0xffaa00) }, // Orange
            color2: { value: new THREE.Color(0xff2200) }  // Reddish
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;
            void main() {
                vUv = uv;
                vNormal = normal;
                // Expand vertices along normal to create a shell
                vec3 pos = position + normal * 0.08; 
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform vec3 color1;
            uniform vec3 color2;
            varying vec2 vUv;
            
            // Simple pseudo-random noise
            float rand(vec2 n) { 
                return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
            }

            float noise(vec2 p){
                vec2 ip = floor(p);
                vec2 u = fract(p);
                u = u*u*(3.0-2.0*u);
                float res = mix(
                    mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
                    mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
                return res;
            }

            void main() {
                // Scroll noise upwards
                float n = noise(vUv * 8.0 + vec2(0.0, -time * 3.0));
                
                // Create flame tongues
                float t = noise(vec2(vUv.x * 10.0, time * 2.0));
                
                // Intensity fades at top (vUv.y is usually 0..1)
                // We assume UV mapping is somewhat vertical. If not, this might look chaotic (which is fine for fire)
                float alpha = n * smoothstep(0.0, 0.2, t) * (1.0 - vUv.y);
                
                vec3 color = mix(color2, color1, n + 0.2);
                
                gl_FragColor = vec4(color, alpha * 1.5);
            }
        `,
        side: THREE.DoubleSide
    });

    pieceObj.traverse((child) => {
        if (child.isMesh) {
            const flameMesh = new THREE.Mesh(child.geometry, flameMaterial);
            flameMesh.position.copy(child.position);
            flameMesh.rotation.copy(child.rotation);
            flameMesh.scale.copy(child.scale);
            // Add to scene, not to pieceObj, so we can control it independently
            // But we need to sync position manually
            scene.add(flameMesh);
            flameMeshes.push({ mesh: flameMesh, offset: child.position.clone() });
        }
    });


    // === PARTICLE SYSTEM ===
    const particleCount = 40;
    const particles = [];
    const geometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);

    for (let i = 0; i < particleCount; i++) {
        // Random fire colors
        const color = Math.random() > 0.5 ? 0xffaa00 : 0xff4400;
        const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1 });

        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(startPos);
        // Spread out a bit
        particle.position.x += (Math.random() - 0.5) * 0.8;
        particle.position.y += (Math.random() - 0.5) * 1.5; // Taller spread
        particle.position.z += (Math.random() - 0.5) * 0.8;

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.1,
            Math.random() * 0.1 + 0.05, // Always up
            (Math.random() - 0.5) * 0.1
        );

        scene.add(particle);
        particles.push({ mesh: particle, velocity: velocity, life: 1.0 + Math.random() });
    }

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease for scale (slow start, fast finish)
        const ease = progress * progress;

        // 1. Scale down (Shrink to nothing)
        const scale = 1 - ease;
        pieceObj.scale.copy(startScale).multiplyScalar(scale);

        // 2. Rotate (Wobble/Spin)
        pieceObj.rotation.y += 0.1;
        pieceObj.rotation.x = Math.sin(elapsed * 0.01) * 0.2; // Wobble

        // 3. Float up slowly
        pieceObj.position.y = startPos.y + progress * 1.5;

        // 4. Fade out piece
        const opacity = 1 - progress;
        materials.forEach(mat => mat.opacity = opacity);

        // 5. Update Flame Shell
        flameMaterial.uniforms.time.value = elapsed * 0.001;
        flameMeshes.forEach(item => {
            // Sync with piece (which is moving/rotating)
            // Actually, pieceObj is moving, so we just need to copy pieceObj transform?
            // pieceObj children might have local transforms.
            // Simplest is to attach flame to scene and copy pieceObj world transform + local offset

            // But pieceObj is scaling. We want flame to scale with it? 
            // User said "shrinking its size while showing flames".
            // So flame should shrink too.

            // Let's just copy the pieceObj's current world transform
            // But pieceObj has children. 
            // We are iterating pieceObj children.

            // Actually, simpler: Attach flame meshes to the pieceObj?
            // No, because we want additive blending and maybe different scale logic.
            // But if we attach to pieceObj, they shrink with it automatically.
            // Let's try attaching to scene and copying position/rotation/scale.

            item.mesh.position.copy(pieceObj.position).add(item.offset.clone().applyEuler(pieceObj.rotation).multiply(pieceObj.scale));
            item.mesh.rotation.copy(pieceObj.rotation);
            item.mesh.scale.copy(pieceObj.scale);

            // Fade flame at the end
            item.mesh.material.opacity = 1 - ease;
        });

        // 6. Animate particles
        particles.forEach(p => {
            if (p.life > 0) {
                p.mesh.position.add(p.velocity);
                p.velocity.y += 0.002; // Rising acceleration
                p.mesh.rotation.x += 0.1;
                p.mesh.rotation.y += 0.1;
                p.life -= 0.02;
                p.mesh.scale.setScalar(p.life);
                p.mesh.material.opacity = p.life;
            } else {
                p.mesh.visible = false;
            }
        });

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            pieceObj.removeFromParent();
            // Clean up materials
            materials.forEach(mat => mat.dispose());
            flameMaterial.dispose();

            // Clean up meshes
            flameMeshes.forEach(item => {
                scene.remove(item.mesh);
                item.mesh.geometry.dispose();
            });

            // Clean up particles
            particles.forEach(p => {
                scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
            });
        }
    }
    animate();
}

