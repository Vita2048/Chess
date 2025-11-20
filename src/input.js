import * as THREE from 'three';
import { pieces, boardSquares, stepRank, stepFile, boardY, pieceYOffset } from './scene.js';
import { getMoves, makeMove, game } from './chessLogic.js';

let raycaster;
let mouse;
let camera;
let scene;
let selectedSquare = null;
let highlightedSquares = [];

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
        highlightMoves(square);
    } else {
        selectedSquare = null;
        clearHighlights();
    }
}

function handleBoardClick(point) {
    let closestSquare = null;
    let minDist = Infinity;

    for (const [sq, pos] of Object.entries(boardSquares)) {
        const dist = point.distanceTo(pos);
        // Use average step size for tolerance
        const avgStep = (stepRank + stepFile) / 2;
        if (dist < avgStep * 0.7) {
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

function highlightMoves(square) {
    clearHighlights();
    const moves = getMoves(square);

    moves.forEach(move => {
        const targetSquare = move.to;
        const pos = boardSquares[targetSquare];
        if (pos) {
            // Make height proportional to step size (thin tile)
            const avgStep = (stepRank + stepFile) / 2;
            const height = avgStep * 0.02;

            // BoxGeometry(width, height, depth) = (X, Y, Z)
            // Board: X=rank direction, Z=file direction
            // We use stepRank for X and stepFile for Z
            const geometry = new THREE.BoxGeometry(stepRank * 0.9, height, stepFile * 0.9);

            const material = new THREE.MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.5 });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(pos);

            // Position just above the board surface (half height + small offset)
            const surfaceY = boardY !== undefined ? boardY : pos.y;
            mesh.position.y = surfaceY + height / 2 + (avgStep * 0.01);

            scene.add(mesh);
            highlightedSquares.push(mesh);
        }
    });
}

function clearHighlights() {
    highlightedSquares.forEach(mesh => scene.remove(mesh));
    highlightedSquares = [];
}

function movePieceVisual(from, to) {
    const pieceObj = pieces[from];
    const targetPos = boardSquares[to];

    if (pieceObj && targetPos) {
        if (pieces[to]) {
            scene.remove(pieces[to]);
        }

        // Preserve piece height above board
        pieceObj.position.x = targetPos.x;
        pieceObj.position.z = targetPos.z;
        pieceObj.position.y = boardY + pieceYOffset;

        pieces[to] = pieceObj;
        delete pieces[from];
        pieceObj.userData.square = to;
    }
}
