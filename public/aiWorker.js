// aiWorker.js - Web Worker for AI calculations

importScripts('https://cdn.jsdelivr.net/npm/chess.js@0.12.1/chess.min.js');

// Piece values
const pieceValues = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000
};

// Piece-Square Tables (simplified)
// These are for White. For Black, we mirror the rank index.
const pawnEvalWhite = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0]
];

const knightEval = [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50]
];

const bishopEvalWhite = [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20]
];

const rookEvalWhite = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0]
];

const queenEval = [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20]
];

const kingEvalWhite = [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20]
];

function evaluateBoard(game) {
    // Check for game over states
    if (game.in_checkmate()) {
        return game.turn() === 'w' ? -20000 : 20000;
    }
    if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) {
        return 0;
    }

    let totalEvaluation = 0;
    const board = game.board();
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            totalEvaluation += getPieceValue(board[i][j], i, j);
        }
    }
    return totalEvaluation;
}

function getPieceValue(piece, x, y) {
    if (piece === null) {
        return 0;
    }

    const absoluteValue = getAbsoluteValue(piece, piece.color === 'w', x, y);
    return piece.color === 'w' ? absoluteValue : -absoluteValue;
}

function getAbsoluteValue(piece, isWhite, x, y) {
    let row = isWhite ? x : 7 - x;
    let col = y;

    const value = pieceValues[piece.type];
    let positionValue = 0;

    switch (piece.type) {
        case 'p': positionValue = pawnEvalWhite[row][col]; break;
        case 'r': positionValue = rookEvalWhite[row][col]; break;
        case 'n': positionValue = knightEval[row][col]; break;
        case 'b': positionValue = bishopEvalWhite[row][col]; break;
        case 'q': positionValue = queenEval[row][col]; break;
        case 'k': positionValue = kingEvalWhite[row][col]; break;
    }

    return value + positionValue;
}

function getBestMove(game, difficulty) {
    let depth;
    switch (difficulty) {
        case 'easy':
            depth = 2;
            break;
        case 'moderate':
            depth = 3;
            break;
        case 'hard':
            depth = 4;
            break;
        default:
            depth = 3;
    }
    const isMaximizingPlayer = game.turn() === 'w';
    const bestMove = minimaxRoot(depth, isMaximizingPlayer, game);
    return bestMove;
}

function minimaxRoot(depth, isMaximizingPlayer, game) {
    const newGameMoves = game.moves({ verbose: true });
    let bestMove = -9999;
    let bestMoveFound = undefined;

    newGameMoves.sort(() => Math.random() - 0.5);

    if (isMaximizingPlayer) {
        bestMove = -Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            const value = minimax(depth - 1, -Infinity, Infinity, false, game);
            game.undo();
            if (value >= bestMove) {
                bestMove = value;
                bestMoveFound = newGameMoves[i];
            }
        }
    } else {
        bestMove = Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            const value = minimax(depth - 1, -Infinity, Infinity, true, game);
            game.undo();
            if (value <= bestMove) {
                bestMove = value;
                bestMoveFound = newGameMoves[i];
            }
        }
    }

    return bestMoveFound;
}

function minimax(depth, alpha, beta, isMaximizingPlayer, game) {
    if (depth === 0) {
        return evaluateBoard(game);
    }

    const newGameMoves = game.moves();

    if (isMaximizingPlayer) {
        let bestMove = -Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.max(bestMove, minimax(depth - 1, alpha, beta, !isMaximizingPlayer, game));
            game.undo();
            alpha = Math.max(alpha, bestMove);
            if (beta <= alpha) {
                return bestMove;
            }
        }
        return bestMove;
    } else {
        let bestMove = Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.min(bestMove, minimax(depth - 1, alpha, beta, !isMaximizingPlayer, game));
            game.undo();
            beta = Math.min(beta, bestMove);
            if (beta <= alpha) {
                return bestMove;
            }
        }
        return bestMove;
    }
}

// Worker message handler
onmessage = function(e) {
    const fen = e.data.fen;
    const difficulty = e.data.difficulty;
    const game = new Chess(fen);
    const bestMove = getBestMove(game, difficulty);
    postMessage(bestMove);
};