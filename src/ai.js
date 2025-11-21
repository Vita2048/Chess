import { game } from './chessLogic.js';

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
// Flip for black? Yes, we need to handle perspective.
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

function evaluateBoard(board) {
    let totalEvaluation = 0;
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            totalEvaluation = totalEvaluation + getPieceValue(board[i][j], i, j);
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
    // Note: x is row (0-7), y is col (0-7) in chess.js board?
    // chess.js board[0][0] is a8.
    // So row 0 is Rank 8. Row 7 is Rank 1.
    // My tables are defined for Rank 1 at bottom?
    // Usually tables are defined 0..7 where 0 is back rank?
    // Let's assume tables are 0=Rank 1 (White Back), 7=Rank 8.
    // If chess.js has 0=Rank 8.
    // Then for White, we map row i to 7-i.

    let row = isWhite ? 7 - x : x;
    let col = y; // Mirror col? No, tables are symmetric mostly, except King/Queen side?
    // Actually tables are usually symmetric.

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

export function getBestMove() {
    // Minimax depth
    const depth = 3;
    const isMaximizingPlayer = game.turn() === 'w';

    // We want to find the best move for the current player
    // If it's White's turn, we want to Maximize score.
    // If it's Black's turn, we want to Minimize score.
    // But standard Minimax usually maximizes for "current player" if we flip score.
    // Here, evaluateBoard returns positive for White advantage.

    const bestMove = minimaxRoot(depth, isMaximizingPlayer);
    return bestMove;
}

function minimaxRoot(depth, isMaximizingPlayer) {
    const newGameMoves = game.moves({ verbose: true });
    let bestMove = -9999;
    let bestMoveFound = undefined;

    // Shuffle moves to add randomness if scores are equal
    newGameMoves.sort(() => Math.random() - 0.5);

    // Shuffle moves to add randomness if scores are equal
    newGameMoves.sort(() => Math.random() - 0.5);

    // Refactor to handle both sides properly
    if (isMaximizingPlayer) {
        bestMove = -Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            const value = minimax(depth - 1, -Infinity, Infinity, false);
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
            const value = minimax(depth - 1, -Infinity, Infinity, true);
            game.undo();
            if (value <= bestMove) {
                bestMove = value;
                bestMoveFound = newGameMoves[i];
            }
        }
    }

    return bestMoveFound;
}

function minimax(depth, alpha, beta, isMaximizingPlayer) {
    if (depth === 0) {
        return -evaluateBoard(game.board());
    }

    const newGameMoves = game.moves();

    if (isMaximizingPlayer) {
        let bestMove = -Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.max(bestMove, minimax(depth - 1, alpha, beta, !isMaximizingPlayer));
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
            bestMove = Math.min(bestMove, minimax(depth - 1, alpha, beta, !isMaximizingPlayer));
            game.undo();
            beta = Math.min(beta, bestMove);
            if (beta <= alpha) {
                return bestMove;
            }
        }
        return bestMove;
    }
}
