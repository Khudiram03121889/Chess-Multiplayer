import { Chess, Square, Move } from 'chess.js';

export interface FirebaseGameState {
  board: string[][];
  turn: string;
  enPassant: [number, number] | null;
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  capturedByWhite: string[];
  capturedByBlack: string[];
  lastMove: [number, number, number, number] | null;
  inCheck: boolean;
  gameOver: boolean;
  clocks: { w: number; b: number };
  clockStartedAt: number | null;
  result: string | null;
  moveHistory: string[];
}

export function squareToCoords(sq: Square | string): [number, number] {
  const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = 8 - parseInt(sq[1], 10);
  return [rank, file];
}

export function coordsToSquare(r: number, c: number): Square {
  const file = String.fromCharCode('a'.charCodeAt(0) + c);
  const rank = 8 - r;
  return `${file}${rank}` as Square;
}

export function chessToFirebase(chess: Chess, clocks: any, capturedWhite: string[], capturedBlack: string[]): Partial<FirebaseGameState> {
  const board2D: string[][] = Array(8).fill(null).map(() => Array(8).fill(''));
  const chessBoard = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = chessBoard[r][c];
      if (piece) {
        board2D[r][c] = `${piece.color}${piece.type.toUpperCase()}`;
      }
    }
  }

  let lastMoveArr: [number, number, number, number] | null = null;
  const history = chess.history({ verbose: true }) as Move[];
  if (history.length > 0) {
    const last = history[history.length - 1];
    const fromCoords = squareToCoords(last.from);
    const toCoords = squareToCoords(last.to);
    lastMoveArr = [...fromCoords, ...toCoords] as [number, number, number, number];
  }

  return {
    board: board2D,
    turn: chess.turn(),
    inCheck: chess.inCheck(),
    gameOver: chess.isGameOver(),
    lastMove: lastMoveArr,
    capturedByWhite: capturedWhite,
    capturedByBlack: capturedBlack,
    clocks: clocks,
    moveHistory: chess.history() as string[]
  };
}

export function firebaseToChess(firebaseState: FirebaseGameState): Chess {
  const chess = new Chess();
  // We can rebuild chess.js state by applying move history
  if (firebaseState.moveHistory && Array.isArray(firebaseState.moveHistory)) {
    for (const move of firebaseState.moveHistory) {
      try {
        chess.move(move);
      } catch (e) {
        console.error("Failed to parse move from history", move);
      }
    }
  }
  return chess;
}
