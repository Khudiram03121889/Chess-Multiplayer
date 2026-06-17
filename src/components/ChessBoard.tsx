import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Chess, Square } from 'chess.js';
import { useTheme, Theme, getGlowStyle } from '../theme/theme';

interface ChessBoardProps {
  fen: string;
  flipped?: boolean;
  selectedSquare?: Square | null;
  onSquarePress: (square: Square) => void;
  legalTargets?: Square[];
  lastMove?: { from: Square; to: Square } | null;
  inCheck?: boolean;
  theme?: string;
}

const getThemeColors = (themeName: string, isDark: boolean) => {
  switch(themeName) {
    case 'cream': return isDark ? '#c5a076' : '#f2e8d5';
    case 'green': return isDark ? '#769656' : '#eeeed2';
    case 'og':    return isDark ? '#b58863' : '#f0d9b5';
    case 'neon':
    default:      return isDark ? '#18182a' : '#dddde8';
  }
};

const SYMBOLS: Record<string, string> = {
  wK:'♥\uFE0E', wQ:'♛\uFE0E', wR:'♜\uFE0E', wB:'♝\uFE0E', wN:'♞\uFE0E', wP:'♟\uFE0E',
  bK:'♥\uFE0E', bQ:'♛\uFE0E', bR:'♜\uFE0E', bB:'♝\uFE0E', bN:'♞\uFE0E', bP:'♟\uFE0E'
};

const FILES = ['a','b','c','d','e','f','g','h'];
const RANKS = ['8','7','6','5','4','3','2','1'];

export default function ChessBoard({ 
  fen, 
  flipped = false, 
  selectedSquare, 
  onSquarePress, 
  legalTargets = [],
  lastMove,
  inCheck,
  theme = 'neon'
}: ChessBoardProps) {
  const { theme: currentTheme, fonts } = useTheme();
  
  // Dynamically calculate board size to prevent overflowing when UI shrinks
  const { width, height } = useWindowDimensions();
  // We estimate available height: Total height - Header(~80) - 2x PlayerCards(~180) - Controls(~80) = ~340 padding
  const maxAvailableHeight = height - 340;
  const BOARD_SIZE = Math.max(200, Math.min(width - 48, maxAvailableHeight, 400));
  const SQUARE_SIZE = BOARD_SIZE / 8;
  
  const styles = getStyles(currentTheme, fonts, BOARD_SIZE, SQUARE_SIZE);

  const chess = new Chess(fen);
  const board = chess.board();

  const ranks = flipped ? [...RANKS].reverse() : RANKS;
  const files = flipped ? [...FILES].reverse() : FILES;

  return (
    <View style={styles.boardWrapper}>
      {/* Top Files */}
      <View style={styles.fileLabels}>
        {files.map(f => <Text key={`top-${f}`} style={styles.label}>{f}</Text>)}
      </View>

      <View style={styles.boardRowWrapper}>
        {/* Left Ranks */}
        <View style={styles.rankLabels}>
          {ranks.map(r => <Text key={`left-${r}`} style={styles.label}>{r}</Text>)}
        </View>

        <View style={[styles.board, getGlowStyle(currentTheme.colors.border)]}>
          {ranks.map((rankStr) => {
            const rowIndex = RANKS.indexOf(rankStr);
            return (
              <View key={`row-${rowIndex}`} style={styles.row}>
                {files.map((fileStr) => {
                  const colIndex = FILES.indexOf(fileStr);
                  const square = `${fileStr}${rankStr}` as Square;
                  const piece = board[rowIndex][colIndex];
                  
                  const isDark = (rowIndex + colIndex) % 2 !== 0;
                  const isSelected = selectedSquare === square;
                  const isHint = legalTargets.includes(square);
                  const isLastMove = lastMove?.from === square || lastMove?.to === square;
                  const isKingInCheck = inCheck && piece?.type === 'k' && piece.color === chess.turn();

                  let squareColor = getThemeColors(theme, isDark);
                  if (isSelected) squareColor = 'rgba(201,164,76,0.45)';
                  else if (isLastMove) squareColor = 'rgba(142, 202, 230, 0.25)';

                  return (
                    <TouchableOpacity
                      key={square}
                      activeOpacity={0.8}
                      onPress={() => onSquarePress(square)}
                      style={[
                        styles.square,
                        { backgroundColor: squareColor }
                      ]}
                    >
                      {piece && (
                        <Text style={[
                          styles.piece,
                          piece.color === 'w' ? styles.pieceWhite : styles.pieceBlack,
                          piece.type === 'k' && isKingInCheck && styles.pieceCheck
                        ]}>
                          {SYMBOLS[`${piece.color}${piece.type.toUpperCase()}`]}
                        </Text>
                      )}
                      
                      {isHint && (
                        <View style={[
                          styles.hint, 
                          piece ? styles.hintCapture : styles.hintMove
                        ]} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* Right Ranks */}
        <View style={styles.rankLabels}>
          {ranks.map(r => <Text key={`right-${r}`} style={styles.label}>{r}</Text>)}
        </View>
      </View>

      {/* Bottom Files */}
      <View style={styles.fileLabels}>
        {files.map(f => <Text key={`bottom-${f}`} style={styles.label}>{f}</Text>)}
      </View>
    </View>
  );
}

const getStyles = (theme: any, fonts: any, boardSize: number, squareSize: number) => StyleSheet.create({
  boardWrapper: { alignItems: 'center' },
  boardRowWrapper: { flexDirection: 'row', alignItems: 'stretch' },
  board: {
    width: boardSize,
    height: boardSize,
    borderWidth: 3,
    borderColor: '#6aaed6',
    borderRadius: 4,
    flexDirection: 'column',
    backgroundColor: '#18182a', // Safe fallback
    shadowColor: '#8ecae6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  row: { flex: 1, flexDirection: 'row' },
  square: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative'
  },
  piece: {
    fontSize: squareSize * 0.7,
    fontFamily: fonts.cinzel,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  pieceWhite: { color: '#ffffff', textShadowColor: 'rgba(0, 0, 0, 0.7)', textShadowRadius: 5, textShadowOffset: { width: 1, height: 2 } },
  pieceBlack: { color: '#000000', textShadowColor: 'rgba(255, 255, 255, 0.4)', textShadowRadius: 5, textShadowOffset: { width: 1, height: 2 } },
  pieceCheck: { textShadowColor: 'rgba(192,57,43,0.8)', textShadowRadius: 10 },
  hint: {
    position: 'absolute',
    borderRadius: 50,
  },
  hintMove: {
    width: squareSize * 0.25,
    height: squareSize * 0.25,
    backgroundColor: 'rgba(201,164,76,0.25)',
  },
  hintCapture: {
    width: squareSize * 0.8,
    height: squareSize * 0.8,
    borderWidth: 3,
    borderColor: 'rgba(139,105,20,0.45)',
  },
  fileLabels: {
    flexDirection: 'row',
    width: boardSize,
    justifyContent: 'space-around',
    marginVertical: 4,
  },
  rankLabels: {
    flexDirection: 'column',
    height: boardSize,
    justifyContent: 'space-around',
    marginHorizontal: 4,
  },
  label: {
    color: theme.colors.textMuted,
    fontFamily: fonts.cinzel,
    fontSize: 12,
    textAlign: 'center',
  }
});