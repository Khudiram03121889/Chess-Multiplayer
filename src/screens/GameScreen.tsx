import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Alert, Share, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { auth, db } from '../firebase/config';
import { ref, onValue, update, set, get } from 'firebase/database';
import ChessBoard from '../components/ChessBoard';
import SplashingHearts from '../components/SplashingHearts';
import ChatPanel from '../components/ChatPanel';
import { Chess, Square } from 'chess.js';
import { useWebRTC, RTCView } from '../game/webrtc';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;

const coordsToSquare = (r: number, c: number): Square => {
  const file = String.fromCharCode('a'.charCodeAt(0) + c);
  const rank = 8 - r;
  return `${file}${rank}` as Square;
};

const stateToFen = (state: any): string => {
  const { board, turn, castling, enPassant, moveHistory } = state;
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) {
        empty++;
      } else {
        if (empty) { row += empty; empty = 0; }
        const color = piece[0];
        const type = piece[1];
        row += color === 'w' ? type.toUpperCase() : type.toLowerCase();
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }

  let castlingStr = '';
  if (castling) {
    if (castling.wK) castlingStr += 'K';
    if (castling.wQ) castlingStr += 'Q';
    if (castling.bK) castlingStr += 'k';
    if (castling.bQ) castlingStr += 'q';
  }
  if (!castlingStr) castlingStr = '-';

  let epStr = '-';
  if (enPassant) {
    const [epR, epC] = enPassant;
    epStr = String.fromCharCode(97 + epC) + (8 - epR);
  }

  const fullmove = Math.floor((moveHistory?.length || 0) / 2) + 1;
  return `${rows.join('/')} ${turn || 'w'} ${castlingStr} ${epStr} 0 ${fullmove}`;
};

const getCapturedPieces = (colorToCount: 'w' | 'b', fenStr: string): string[] => {
  const counts: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, P: 8, N: 2, B: 2, R: 2, Q: 1 };
  const boardPart = fenStr.split(' ')[0];
  for (let char of boardPart) {
    if (counts[char] !== undefined) counts[char]--;
  }
  const captured: string[] = [];
  const piecesToCheck = colorToCount === 'w' ? ['p', 'n', 'b', 'r', 'q'] : ['P', 'N', 'B', 'R', 'Q'];
  piecesToCheck.forEach(p => {
    for (let i = 0; i < counts[p]; i++) {
      captured.push(p.toLowerCase());
    }
  });
  return captured;
};

const serializeBoard = (c: Chess) => {
  const board = c.board();
  return board.map(row => row.map(sq => sq ? `${sq.color}${sq.type}` : ''));
};

export default function GameScreen() {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  const navigation = useNavigation();
  const route = useRoute<GameScreenRouteProp>();
  const gameId = route.params?.gameId || 'demo-game';
  const themeColor = (route.params as any)?.theme || 'neon';

  const [chess] = useState(new Chess());
  const [fen, setFen] = useState(chess.fen());
  const [myColor, setMyColor] = useState<'w' | 'b' | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<{from: Square, to: Square} | null>(null);
  const [loveMessage, setLoveMessage] = useState<string | null>(null);
  const [loveTriggerCount, setLoveTriggerCount] = useState<number>(0);
  const [manualFlip, setManualFlip] = useState<boolean>(false);
  const [whiteTime, setWhiteTime] = useState<number>(600);
  const [blackTime, setBlackTime] = useState<number>(600);
  const [gameStarted, setGameStarted] = useState(false);
  const [opponentInfo, setOpponentInfo] = useState<{id?: string, name?: string, avatarUrl?: string | null} | null>(null);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [endgameMessage, setEndgameMessage] = useState<{title: string, subtitle: string} | null>(null);
  const [showLegalMoves, setShowLegalMoves] = useState(true);
  const [yappingPaused, setYappingPaused] = useState(false);
  const [quickConvo, setQuickConvo] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const myColorRef = useRef<'w' | 'b' | null>(null);
  const gameHistorySaved = useRef<boolean>(false);
  const lastLoveRef = useRef<number>(0);
  const matchHistoryRecorded = useRef(false);
  const timeControlRef = useRef<string>('10m');
  const { localStream, remoteStream, cameraEnabled, toggleCamera } = useWebRTC(gameId, myColor);

  const checkEndgame = (c: Chess) => {
    if (c.isCheckmate()) {
      return { title: 'Checkmate', subtitle: c.turn() === 'w' ? 'Black wins' : 'White wins' };
    }
    if (c.isDraw()) return { title: 'Draw', subtitle: 'Game drawn' };
    if (c.isStalemate()) return { title: 'Stalemate', subtitle: 'Game drawn' };
    if (c.isThreefoldRepetition()) return { title: 'Draw', subtitle: 'Threefold repetition' };
    if (c.isInsufficientMaterial()) return { title: 'Draw', subtitle: 'Insufficient material' };
    return null;
  };

  const parseTime = (tc: string) => {
    if (tc === '3m') return 180;
    if (tc === '5m') return 300;
    if (tc === '10m') return 600;
    if (tc === '30m') return 1800;
    if (tc === '1h') return 3600;
    return 600;
  };


  // Seat claiming and heartbeats
  useEffect(() => {
    if (!gameId) return;
    const user = auth.currentUser;
    if (!user) return;

    const seatsRef = ref(db, `games/${gameId}/seats`);
    let isMounted = true;

    // We do a simple claim seat implementation for React Native
    const claimSeat = async () => {
      const myId = user.uid;
      let displayName = user.email?.split('@')[0] || 'Player';
      let avatarUrl = '';
      let partnerEmail = '';
      let reunionAt: number | null = null;

      try {
        const profileSnap = await get(ref(db, `users/${user.uid}/profile`));
        if (profileSnap.exists()) {
          const p = profileSnap.val();
          if (p.displayName) displayName = p.displayName;
          if (p.avatarUri) avatarUrl = p.avatarUri;
          else if (p.avatarDataUrl) avatarUrl = p.avatarDataUrl;
          if (p.reunionPartnerEmail) partnerEmail = p.reunionPartnerEmail;
          if (p.reunionAt) reunionAt = p.reunionAt;
        }
      } catch (err) {
        console.warn('Failed to load profile for seat claim', err);
      }

      if (avatarUrl) {
        setMyAvatarUrl(avatarUrl);
      }

      const seatData = {
        id: myId,
        uid: myId,
        email: user.email || '',
        name: displayName,
        avatarDataUrl: avatarUrl,
        avatarUri: avatarUrl,
        reunionPartnerEmail: partnerEmail,
        reunionAt: reunionAt,
        connectedAt: Date.now()
      };

      try {
        const metaSnap = await get(ref(db, `games/${gameId}/meta`));
        const meta = metaSnap.val();
        if (!meta) return;

        const isHost = meta.createdBy === myId;
        const hostColor = meta.settings?.hostColor || 'w';
        const myDesignatedColor = isHost ? hostColor : (hostColor === 'w' ? 'b' : 'w');
        const oppColor = myDesignatedColor === 'w' ? 'b' : 'w';

        if (meta.settings) {
           timeControlRef.current = meta.settings.timeControl || '10m';
           const t = parseTime(timeControlRef.current);
           setWhiteTime(t);
           setBlackTime(t);
           if (meta.settings.showLegalMoves !== undefined) {
               setShowLegalMoves(meta.settings.showLegalMoves);
           }
        }

        onValue(seatsRef, (snap) => {
          if (!isMounted) return;
          const seats = snap.val() || {};
          const isLive = (s: any) => s && s.connectedAt && (Date.now() - s.connectedAt < 30000);

          setGameStarted(isLive(seats.w) && isLive(seats.b));

          let resolvedMyColor: 'w' | 'b' | null = null;
          if (seats[myDesignatedColor]?.id === myId) {
            resolvedMyColor = myDesignatedColor;
          } else if (!isLive(seats[myDesignatedColor]) && (!isLive(seats[oppColor]) || seats[oppColor]?.id !== myId)) {
            resolvedMyColor = myDesignatedColor;
            set(ref(db, `games/${gameId}/seats/${myDesignatedColor}`), seatData);
          } else if (seats[oppColor]?.id === myId) {
            resolvedMyColor = oppColor;
          }

          setMyColor(resolvedMyColor);
          myColorRef.current = resolvedMyColor;

          if (resolvedMyColor) {
            const oppColorName = resolvedMyColor === 'w' ? 'b' : 'w';
            const oppSeat = seats[oppColorName];
            if (oppSeat) {
              setOpponentInfo({
                id: oppSeat.id,
                name: oppSeat.name || oppSeat.email?.split('@')[0] || 'Opponent',
                avatarUrl: oppSeat.avatarDataUrl || oppSeat.avatarUri || null
              });
            } else {
              setOpponentInfo(null);
            }
          } else {
            setOpponentInfo(null);
          }
        });
      } catch (e) {
        console.error('Failed to claim seat', e);
      }
    };

    claimSeat();

    const heartbeatInterval = setInterval(() => {
      if (isMounted && myColorRef.current) {
         update(ref(db, `games/${gameId}/seats/${myColorRef.current}`), { connectedAt: Date.now() }).catch(() => {});
      }
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(heartbeatInterval);
      if (myColorRef.current) {
        set(ref(db, `games/${gameId}/seats/${myColorRef.current}`), null);
      }
    };
  }, [gameId]);

  // Sync game state
  useEffect(() => {
    if (!gameId) return;
    const gameRef = ref(db, `games/${gameId}`);

    const unsubscribe = onValue(gameRef, (snap) => {
      const state = snap.val();
      if (state) {
        let targetFen = state.fen;
        if (!targetFen && state.board) {
          targetFen = stateToFen(state);
        }

        if (targetFen && targetFen !== chess.fen()) {
          try {
            chess.load(targetFen);
            setFen(chess.fen());
            
            if (state.lastMove) {
              if (Array.isArray(state.lastMove) && state.lastMove.length === 4) {
                const [fr, fc, tr, tc] = state.lastMove;
                setLastMove({ from: coordsToSquare(fr, fc), to: coordsToSquare(tr, tc) });
              } else if (state.lastMove.from && state.lastMove.to) {
                setLastMove(state.lastMove);
              }
            } else {
              setLastMove(null);
            }
          } catch (e) {
            console.error("Invalid FEN received", e);
          }
        }

        if (state.clocks) {
          if (state.clocks.w !== undefined) setWhiteTime(state.clocks.w);
          if (state.clocks.b !== undefined) setBlackTime(state.clocks.b);
        } else {
          if (state.whiteTime !== undefined) setWhiteTime(state.whiteTime);
          if (state.blackTime !== undefined) setBlackTime(state.blackTime);
        }

        if (state.gameOver) {
          const msg = state.endgameMessage || checkEndgame(chess) || {title: 'Game Over', subtitle: state.result || ''};
          setEndgameMessage(msg);
          
          if (!matchHistoryRecorded.current && myColor) {
             let outcome: 'Win' | 'Loss' | 'Draw' = 'Draw';
             const sub = msg.subtitle || state.result || '';
             if (sub.includes(myColor === 'w' ? 'White wins' : 'Black wins')) {
                outcome = 'Win';
             } else if (sub.includes(myColor === 'w' ? 'Black wins' : 'White wins')) {
                outcome = 'Loss';
             }
             
             const user = auth.currentUser;
             if (user) {
               const endedAt = Date.now();
               const baseKey = String(gameId || 'game').replace(/[^A-Za-z0-9_-]/g, '_');
               const historyKey = `${baseKey}_${endedAt}`;
               const wT = state.clocks?.w ?? state.whiteTime ?? whiteTime;
               const bT = state.clocks?.b ?? state.blackTime ?? blackTime;
               const durationSec = (600 - wT) + (600 - bT);
               update(ref(db, `users/${user.uid}/matchHistory/${historyKey}`), {
                 gameId,
                 at: endedAt,
                 timestamp: endedAt,
                 mode: 'pvp',
                 myColor,
                 myName: user.displayName || 'Player',
                 opponent: opponentInfo?.name || 'Opponent',
                 opponentName: opponentInfo?.name || 'Opponent',
                 outcome,
                 reason: msg.title || 'Game Over',
                 durationSec: durationSec > 0 ? durationSec : 120
               });
             }
             matchHistoryRecorded.current = true;
          }
        }
        
        if (state.loveAt && state.loveAt > lastLoveRef.current) {
          lastLoveRef.current = state.loveAt;
          setLoveMessage(state.loveMessage || 'I love you ❤️');
          setLoveTriggerCount(c => c + 1);
          setTimeout(() => setLoveMessage(null), 2500);
        }

        if (state.yappingPaused !== undefined) {
          setYappingPaused(state.yappingPaused);
        }
      }
    });

    return () => unsubscribe();
  }, [gameId, chess, myColor, opponentInfo]);

  // Timer Interval
  useEffect(() => {
    if (!gameStarted || chess.isGameOver() || yappingPaused) return;

    const interval = setInterval(() => {
      if (chess.turn() === 'w') {
        setWhiteTime(prev => {
          if (prev <= 1) {
            update(ref(db, `games/${gameId}`), { gameOver: true, result: 'Black wins on time' });
            return 0;
          }
          return prev - 1;
        });
      } else {
        setBlackTime(prev => {
          if (prev <= 1) {
            update(ref(db, `games/${gameId}`), { gameOver: true, result: 'White wins on time' });
            handleGameOver('White wins on time', false);
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [gameStarted, chess.fen(), chess.isGameOver(), gameId]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSquarePress = useCallback((square: Square) => {
    if (!gameStarted) {
      Alert.alert("Waiting", "Waiting for opponent to join.");
      return;
    }
    if (chess.isGameOver()) return;
    if (chess.turn() !== myColor) {
      // Not my turn
      return;
    }

    if (selectedSquare) {
      // Try to make a move
      try {
        const move = chess.move({
          from: selectedSquare,
          to: square,
          promotion: 'q' // Always promote to queen for now
        });

        if (move) {
          setFen(chess.fen());
          setLastMove({ from: selectedSquare, to: square });
          setSelectedSquare(null);
          setLegalTargets([]);

          const isOver = chess.isGameOver();
          let endMsg = null;
          if (isOver) {
            endMsg = checkEndgame(chess);
            setEndgameMessage(endMsg);
            
            let isWin: boolean | null = null;
            if (chess.isCheckmate()) {
               isWin = chess.turn() !== myColor; // If opponent's turn and checkmate, I won
            }
            handleGameOver(endMsg?.title || 'Game Over', isWin);
          }

          // Broadcast to Firebase with full Web-compatible schema!
          const history = chess.history({ verbose: true });
          let lastMoveArr: [number, number, number, number] | null = null;
          if (history.length > 0) {
            const last = history[history.length - 1];
            const fromR = 8 - parseInt(last.from[1], 10);
            const fromC = last.from.charCodeAt(0) - 'a'.charCodeAt(0);
            const toR = 8 - parseInt(last.to[1], 10);
            const toC = last.to.charCodeAt(0) - 'a'.charCodeAt(0);
            lastMoveArr = [fromR, fromC, toR, toC];
          }

          let lastCapture = null;
          if (history.length > 0) {
            const last = history[history.length - 1];
            if (last.captured) {
              lastCapture = {
                type: last.captured,
                color: last.color === 'w' ? 'b' : 'w',
                at: Date.now()
              };
            }
          }

          const castlingStr = chess.fen().split(' ')[2];
          const castling = {
            wK: castlingStr.includes('K'),
            wQ: castlingStr.includes('Q'),
            bK: castlingStr.includes('k'),
            bQ: castlingStr.includes('q')
          };

          let enPassant: [number, number] | null = null;
          if (history.length > 0) {
            const last = history[history.length - 1];
            if (last.flags && last.flags.includes('b')) {
              const epSquare = last.to[0] + (last.color === 'w' ? '3' : '6');
              const col = epSquare.charCodeAt(0) - 'a'.charCodeAt(0);
              const row = 8 - parseInt(epSquare[1], 10);
              enPassant = [row, col];
            }
          }

          const capturedByWhite = getCapturedPieces('w', chess.fen());
          const capturedByBlack = getCapturedPieces('b', chess.fen());

          update(ref(db, `games/${gameId}`), {
            fen: chess.fen(),
            board: serializeBoard(chess),
            turn: chess.turn(),
            enPassant,
            castling,
            capturedByWhite,
            capturedByBlack,
            lastMove: lastMoveArr,
            lastCapture,
            inCheck: chess.inCheck(),
            gameOver: isOver,
            result: isOver ? { type: chess.isCheckmate() ? 'checkmate' : chess.isStalemate() ? 'stalemate' : 'draw', winner: chess.isCheckmate() ? (chess.turn() === 'w' ? 'b' : 'w') : null, endedAt: Date.now() } : null,
            endgameMessage: endMsg || null,
            updatedAt: Date.now(),
            whiteTime,
            blackTime,
            clocks: { w: whiteTime, b: blackTime },
            clockStartedAt: isOver ? null : Date.now(),
            moveHistory: chess.history()
          });
        } else {
          // Invalid move or selecting a different piece
          selectPiece(square);
        }
      } catch (e) {
        // Invalid move
        selectPiece(square);
      }
    } else {
      selectPiece(square);
    }
  }, [chess, selectedSquare, myColor, gameId]);

  const selectPiece = (square: Square) => {
    const piece = chess.get(square);
    if (piece && piece.color === myColor) {
      setSelectedSquare(square);
      const moves = chess.moves({ square, verbose: true });
      if (showLegalMoves) {
        setLegalTargets(moves.map(m => m.to as Square));
      } else {
        setLegalTargets([]);
      }
    } else {
        setSelectedSquare(null);
      setLegalTargets([]);
    }
  };

  const handleUndo = () => {
    Alert.alert('😭 Undo', 'In your dreams!');
  };

  const toggleYapping = () => {
    const nextState = !yappingPaused;
    update(ref(db, `games/${gameId}`), { yappingPaused: nextState });
    if (nextState) {
      setLoveMessage("Keep yapping, I'm listening ❤️");
      setTimeout(() => setLoveMessage(null), 2500);
    }
  };

  const handleGameOver = (resultMsg: string, isWin: boolean | null) => {
    if (!auth.currentUser || gameHistorySaved.current) return;
    gameHistorySaved.current = true;
    const uid = auth.currentUser.uid;
    const outcome = isWin === true ? 'Win' : isWin === false ? 'Loss' : 'Draw';
    
    // Calculate a rough duration
    const totalSeconds = parseTime(timeControlRef.current) * 2;
    const remainingSeconds = whiteTime + blackTime;
    const durationSec = totalSeconds > remainingSeconds ? totalSeconds - remainingSeconds : 0;
    
    const endedAt = Date.now();
    const baseKey = String(gameId || 'game').replace(/[^A-Za-z0-9_-]/g, '_');
    const historyKey = `${baseKey}_${endedAt}`;

    update(ref(db, `users/${uid}/matchHistory/${historyKey}`), {
      gameId,
      at: endedAt,
      timestamp: endedAt,
      mode: 'pvp',
      myColor,
      myName: auth.currentUser.displayName || 'Player',
      opponent: opponentInfo?.name || 'Opponent',
      opponentName: opponentInfo?.name || 'Opponent',
      outcome,
      reason: resultMsg,
      durationSec
    });
  };

  const handleResign = () => {
    Alert.alert("Resign", "Are you sure you want to resign?", [
      { text: "Cancel", style: "cancel" },
      { text: "Resign", onPress: () => {
          const endMsg = { title: 'Resignation', subtitle: myColor === 'w' ? 'Black wins' : 'White wins' };
          setEndgameMessage(endMsg);
          update(ref(db, `games/${gameId}`), { 
            gameOver: true, 
            result: { type: 'resigned', winner: myColor === 'w' ? 'b' : 'w', endedAt: Date.now() },
            endgameMessage: endMsg
          });
          
          if (!matchHistoryRecorded.current && myColor) {
             const user = auth.currentUser;
             if (user) {
               const endedAt = Date.now();
               const baseKey = String(gameId || 'game').replace(/[^A-Za-z0-9_-]/g, '_');
               const historyKey = `${baseKey}_${endedAt}`;
               const durationSec = (600 - whiteTime) + (600 - blackTime);
               update(ref(db, `users/${user.uid}/matchHistory/${historyKey}`), {
                 gameId,
                 at: endedAt,
                 timestamp: endedAt,
                 mode: 'pvp',
                 myColor,
                 myName: user.displayName || 'Player',
                 opponent: opponentInfo?.name || 'Opponent',
                 opponentName: opponentInfo?.name || 'Opponent',
                 outcome: 'Loss',
                 reason: 'Resigned',
                 durationSec: durationSec > 0 ? durationSec : 120
               });
             }
             matchHistoryRecorded.current = true;
          }
          handleGameOver('Resigned', false);
      }}
    ]);
  };

  const handleHeartPress = () => {
    const msg = 'I love you ❤️';
    setLoveMessage(msg);
    setTimeout(() => setLoveMessage(null), 2500);
    
    update(ref(db, `games/${gameId}`), {
      loveAt: Date.now(),
      loveMessage: msg
    });
  };

  const isFlipped = myColor === 'b' ? !manualFlip : manualFlip;
  
  const oppTime = myColor === 'b' ? whiteTime : blackTime;
  const myTime = myColor === 'b' ? blackTime : whiteTime;

  // Calculate captured pieces dynamically
  const getCapturedText = (colorToCount: 'w' | 'b') => {
    const counts: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, P: 8, N: 2, B: 2, R: 2, Q: 1 };
    const boardPart = fen.split(' ')[0];
    for (let char of boardPart) {
      if (counts[char] !== undefined) counts[char]--;
    }
    const symbols: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕' };
    
    let captured = '';
    const piecesToCheck = colorToCount === 'w' ? ['p', 'n', 'b', 'r', 'q'] : ['P', 'N', 'B', 'R', 'Q']; // Opponent's pieces missing
    piecesToCheck.forEach(p => {
      for (let i = 0; i < counts[p]; i++) captured += symbols[p] + ' ';
    });
    return captured.trim() ? `Captured: ${captured.trim()}` : '';
  };

  const myCapturedText = getCapturedText(myColor || 'w');
  const oppCapturedText = getCapturedText(myColor === 'w' ? 'b' : 'w');

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Leave</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => Share.share({ message: `Join my match on ChessTime using code: ${gameId}` })} 
          onLongPress={async () => {
            await Clipboard.setStringAsync(gameId);
            Alert.alert('Copied!', 'Game code copied to clipboard');
          }}
          style={styles.titleContainer}
        >
          <Text style={styles.title}>Code: {gameId} <Ionicons name="share-outline" size={16} /></Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => setShowChat(true)} style={styles.chatBtn}>
            <Ionicons name="chatbubbles-outline" size={24} color={theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleCamera} style={styles.camBtn}>
            <Text style={[styles.camText, cameraEnabled && styles.camActive]}>
              {cameraEnabled ? '📹 On' : '📹 Off'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Opponent Card (Top) */}
      <View style={[styles.playerCard, quickConvo && styles.quickConvoCard]}>
         <View style={[styles.videoPlaceholder, quickConvo && styles.quickConvoVideo]}>
           {remoteStream ? (
             <RTCView streamURL={remoteStream.toURL()} style={styles.video} objectFit="cover" />
           ) : opponentInfo?.avatarUrl ? (
             <Image source={{ uri: opponentInfo.avatarUrl }} style={{ width: 56, height: 56, borderRadius: 28 }} />
           ) : (
             <Ionicons name="person" size={24} color={theme.colors.textMuted} />
           )}
         </View>
         {!quickConvo && (
           <>
             <View style={styles.playerInfo}>
                <Text style={styles.playerName}>{opponentInfo?.name || 'Opponent'}</Text>
                {oppCapturedText ? <Text style={styles.capturedText}>{oppCapturedText}</Text> : null}
             </View>
             <View style={styles.timerBadge}>
                <Text style={styles.timerText}>{formatTime(oppTime)}</Text>
             </View>
           </>
         )}
      </View>

      {yappingPaused && (
        <View style={styles.yappingOverlay}>
          <Text style={styles.yappingText}>☕ Yapping Break</Text>
          <TouchableOpacity style={styles.quickConvoBtn} onPress={() => setQuickConvo(!quickConvo)}>
            <Text style={styles.quickConvoText}>{quickConvo ? 'Show Board' : 'Quick Convo'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!quickConvo && (
        <View style={styles.boardWrapperContainer}>
          <ChessBoard 
            fen={fen} 
            flipped={isFlipped}
            selectedSquare={selectedSquare}
            onSquarePress={handleSquarePress}
            legalTargets={legalTargets}
            inCheck={chess.inCheck()}
            lastMove={lastMove}
            theme={themeColor}
          />
          <SplashingHearts triggerCount={loveTriggerCount} />
          {/* Love Message directly on the board */}
          {loveMessage && (
            <View style={styles.loveOverlay}>
              <Text style={styles.loveOverlayText}>{loveMessage}</Text>
            </View>
          )}
        </View>
      )}

      {/* User Card (Bottom) */}
      <View style={[styles.playerCard, quickConvo && styles.quickConvoCard]}>
         <View style={[styles.videoPlaceholder, quickConvo && styles.quickConvoVideo]}>
           {localStream ? (
             <RTCView streamURL={localStream.toURL()} style={styles.video} objectFit="cover" />
           ) : myAvatarUrl ? (
             <Image source={{ uri: myAvatarUrl }} style={{ width: 56, height: 56, borderRadius: 28 }} />
           ) : (
             <Ionicons name="person" size={24} color={theme.colors.textMuted} />
           )}
         </View>
         {!quickConvo && (
           <>
             <View style={styles.playerInfo}>
               <Text style={styles.playerName}>{auth.currentUser?.displayName || 'You'}</Text>
               {myCapturedText ? <Text style={styles.capturedText}>{myCapturedText}</Text> : null}
             </View>
             
             <TouchableOpacity onPress={handleHeartPress} style={{ marginRight: 16 }}>
               <Text style={styles.heart}>❤️</Text>
             </TouchableOpacity>
             
             <View style={styles.timerBadge}>
               <Text style={styles.timerText}>{formatTime(myTime)}</Text>
             </View>
           </>
         )}
      </View>

      {/* Footer */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={handleUndo}>
          <Ionicons name="return-down-back" size={24} color={theme.colors.text} />
          <Text style={styles.controlText}>Undo</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.controlBtn, yappingPaused && { backgroundColor: theme.colors.primary }]} 
          onPress={toggleYapping}
        >
          <Ionicons name="cafe" size={24} color={yappingPaused ? theme.colors.background : theme.colors.text} />
          <Text style={[styles.controlText, yappingPaused && { color: theme.colors.background }]}>
            Yapping
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.flipBtn} onPress={() => setManualFlip(!manualFlip)}>
          <Ionicons name="swap-vertical" size={18} color={theme.colors.text} />
          <Text style={styles.flipText}>Flip</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.resignBtn} onPress={handleResign}>
          <Text style={styles.resignText}>⚑ Resign</Text>
        </TouchableOpacity>
      </View>

      {/* Endgame Overlay */}
      {endgameMessage && (
        <View style={styles.endgameOverlay}>
          <View style={styles.endgameCard}>
            <Text style={styles.endgameTitle}>{endgameMessage.title}</Text>
            <Text style={styles.endgameSubtitle}>{endgameMessage.subtitle}</Text>
            <TouchableOpacity style={styles.endgameBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.endgameBtnText}>Leave Game</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showChat && (
        <ChatPanel gameId={gameId} onClose={() => setShowChat(false)} />
      )}
    </SafeAreaView>
  );
}

const getStyles = (theme: any) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chatBtn: { padding: 4 },
  backBtn: { width: 80 },
  backText: { fontFamily: 'System', color: theme.colors.primary, fontSize: 16 },
  titleContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'System', fontWeight: '700', color: theme.colors.text, fontSize: 16, textAlign: 'center' },
  camBtn: { width: 80, alignItems: 'flex-end' },
  camText: { fontFamily: 'System', color: theme.colors.textMuted, fontSize: 14 },
  camActive: { color: theme.colors.primary },
  
  playerCard: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 },
  videoPlaceholder: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: theme.colors.border, overflow: 'hidden' },
  video: { width: 56, height: 56 },
  playerInfo: { flex: 1 },
  playerName: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  capturedText: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  timerBadge: { backgroundColor: theme.colors.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },
  timerText: { color: theme.colors.text, fontSize: 16, fontWeight: '700', fontFamily: 'System' },
  
  boardWrapperContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  heartContainer: { position: 'absolute', right: 10, top: '45%' },
  heart: { fontSize: 32, textShadowColor: 'rgba(255, 0, 100, 0.8)', textShadowOffset: {width: 0, height: 0}, textShadowRadius: 15 },
  
  controls: { padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  controlBtn: { alignItems: 'center', justifyContent: 'center', padding: 8, borderRadius: 8 },
  controlText: { color: theme.colors.textMuted, fontSize: 10, marginTop: 4, fontWeight: '600', textTransform: 'uppercase' },
  flipBtn: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: theme.colors.background, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', gap: 6 },
  flipText: { color: theme.colors.text, fontWeight: '600', fontSize: 14 },
  resignBtn: { paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: theme.colors.danger, borderRadius: 8, backgroundColor: 'rgba(255, 82, 82, 0.1)' },
  resignText: { color: theme.colors.danger, fontWeight: '700' },
  
  loveOverlay: {
    ...StyleSheet.absoluteFill as any,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loveOverlayText: {
    color: '#ff4d6d',
    fontSize: 48,
    fontWeight: '800',
    textAlign: 'center',
    fontFamily: 'System',
    textShadowRadius: 20,
    paddingHorizontal: 20,
  },
  
  quickConvoCard: { flex: 1, padding: 0, marginHorizontal: 0, marginTop: 0, marginBottom: 0, backgroundColor: 'transparent', borderTopWidth: 0 },
  quickConvoVideo: { width: '100%', height: '100%', borderRadius: 0, borderWidth: 0 },
  yappingOverlay: { position: 'absolute', top: '50%', width: '100%', alignItems: 'center', zIndex: 100, transform: [{ translateY: -50 }] },
  yappingText: { color: theme.colors.text, fontSize: 32, fontWeight: '800', textShadowColor: '#000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  quickConvoBtn: { marginTop: 16, backgroundColor: theme.colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  quickConvoText: { color: theme.colors.background, fontWeight: '700', fontSize: 16 },
  
  endgameOverlay: {
    ...StyleSheet.absoluteFill as any,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  endgameCard: {
    backgroundColor: theme.colors.surface,
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.primary,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
    width: '80%'
  },
  endgameTitle: {
    color: theme.colors.primary,
    fontSize: 32,
    fontWeight: '800',
    fontFamily: 'System',
    marginBottom: 8,
    textAlign: 'center'
  },
  endgameSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 32,
    textAlign: 'center'
  },
  endgameBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center'
  },
  endgameBtnText: {
    color: theme.colors.background,
    fontSize: 18,
    fontWeight: '700'
  }
});