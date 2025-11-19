import { Chess } from 'chess.js';

export const game = new Chess();

export function resetGame() {
    game.reset();
}

export function getMoves(square) {
    return game.moves({ square: square, verbose: true });
}

export function makeMove(move) {
    return game.move(move);
}

export function isGameOver() {
    return game.isGameOver();
}

export function getFen() {
    return game.fen();
}
