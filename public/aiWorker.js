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

// --- NEW HEURISTIC: Order Moves to improve Alpha-Beta Pruning ---
// Prioritize Captures: MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
function orderMoves(moves, game) {
    return moves.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        // Prioritize captures
        if (a.captured) {
            scoreA = 10 * getPieceValueSimple(a.captured) - getPieceValueSimple(a.piece);
        }
        if (b.captured) {
            scoreB = 10 * getPieceValueSimple(b.captured) - getPieceValueSimple(b.piece);
        }
        
        // Prioritize promotions
        if (a.promotion) scoreA += 1000;
        if (b.promotion) scoreB += 1000;

        // Prioritize checks (often forces a response, narrowing search tree)
        // Note: Chess.js move object doesn't always flag check immediately without executing,
        // but 'san' (Standard Algebraic Notation) usually contains '+' for checks.
        if (a.san.includes('+')) scoreA += 500;
        if (b.san.includes('+')) scoreB += 500;

        return scoreB - scoreA;
    });
}

function getPieceValueSimple(pieceType) {
    if (!pieceType) return 0;
    // We only need relative values for sorting, so simple integer values work best
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    return values[pieceType] || 0;
}
// -------------------------------------------------------------

function evaluateBoard(game) {
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
        case 'easy': depth = 2; break;
        case 'moderate': depth = 3; break;
        case 'hard': depth = 4; break;
        default: depth = 3;
    }
    const isMaximizingPlayer = game.turn() === 'w';
    const bestMove = minimaxRoot(depth, isMaximizingPlayer, game);
    return bestMove;
}

function minimaxRoot(depth, isMaximizingPlayer, game) {
    // Generate moves with verbose: true to get details on captures/promotions
    let newGameMoves = game.moves({ verbose: true });
    
    // Sort moves to check the most promising ones first
    newGameMoves = orderMoves(newGameMoves, game);

    let bestMove = -9999;
    let bestMoveFound = undefined;

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

    let newGameMoves = game.moves({ verbose: true });
    
    // HEURISTIC: Order moves here too! 
    // This is crucial for recursive pruning deep in the tree.
    newGameMoves = orderMoves(newGameMoves, game);

    if (isMaximizingPlayer) {
        let bestMove = -Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.max(bestMove, minimax(depth - 1, alpha, beta, !isMaximizingPlayer, game));
            game.undo();
            
            // Alpha Beta Pruning
            alpha = Math.max(alpha, bestMove);
            if (beta <= alpha) {
                return bestMove; // Pruning happens here
            }
        }
        return bestMove;
    } else {
        let bestMove = Infinity;
        for (let i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.min(bestMove, minimax(depth - 1, alpha, beta, !isMaximizingPlayer, game));
            game.undo();
            
            // Alpha Beta Pruning
            beta = Math.min(beta, bestMove);
            if (beta <= alpha) {
                return bestMove; // Pruning happens here
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