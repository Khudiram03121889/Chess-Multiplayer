import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Alert, Share, Image, Vibration } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, getGlowStyle } from '../theme/theme';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { auth, db, getServerTime } from '../firebase/config';
import { ref, onValue, update, set, get } from 'firebase/database';
import ChessBoard from '../components/ChessBoard';
import SplashingHearts from '../components/SplashingHearts';
import ChatPanel from '../components/ChatPanel';
import { Chess, Square } from 'chess.js';
import { useWebRTC, RTCView } from '../game/webrtc';
import { getFallbackBotMove, squareFromUci } from '../game/botEngine';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { WebView } from 'react-native-webview';
import { createAudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';



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

const STOCKFISH_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script>
    window.onerror = function(message) {
      window.ReactNativeWebView.postMessage("ERROR: " + message);
    };
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js" onerror="window.ReactNativeWebView.postMessage('ERROR: Stockfish script failed to load')"></script>
  <script>
    var engine;
    var ready = false;
    try {
      engine = typeof STOCKFISH === "function" ? STOCKFISH() : (typeof Stockfish === "function" ? Stockfish() : new Worker("https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js"));
      engine.onmessage = function(event) {
        var line = typeof event === "string" ? event : event.data;
        if (line) {
          window.ReactNativeWebView.postMessage(line);
          if (!ready && line === "readyok") {
            ready = true;
            window.ReactNativeWebView.postMessage("READY");
          }
        }
      };
      engine.postMessage("uci");
      engine.postMessage("isready");
    } catch(e) {
      window.ReactNativeWebView.postMessage("ERROR: " + e.message);
    }
    
    document.addEventListener("message", function(event) {
      if (engine) engine.postMessage(event.data);
    });
    window.addEventListener("message", function(event) {
      if (engine) engine.postMessage(event.data);
    });
  </script>
</head>
<body></body>
</html>
`;

export default function GameScreen() {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  const navigation = useNavigation();
  const route = useRoute<GameScreenRouteProp>();
  const gameId = route.params?.gameId || 'demo-game';
  const themeColor = (route.params as any)?.theme || 'neon';
  const isBotMode = (route.params as any)?.isBotMode || false;
  const botColorSelection = (route.params as any)?.botColorSelection || 'random';
  const showLegalMovesParam = (route.params as any)?.showLegalMoves ?? true;

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
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const showChatRef = useRef(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const myColorRef = useRef<'w' | 'b' | null>(null);
  const webViewRef = useRef<WebView>(null);
  const isEngineReady = useRef(false);
  const engineFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBotFen = useRef<string | null>(null);
  const gameHistorySaved = useRef<boolean>(false);
  const lastLoveRef = useRef<number>(0);
  const lastUndoRequestRef = useRef<number>(0);
  const lastUndoResponseRef = useRef<number>(0);
  const matchHistoryRecorded = useRef(false);
  const chatMsgCountRef = useRef(0);
  const lastReadTimestampRef = useRef<number>(0);
  const timeControlRef = useRef<string>('10m');
  const { localStream, remoteStream, cameraEnabled, audioMuted, toggleCamera, toggleAudioMute } = useWebRTC(isBotMode ? null : gameId, myColor);

  const playSound = async (type: 'move' | 'capture' | 'check' | 'end') => {
    if (!soundEnabled) return;
    try {
      let soundAsset;
      switch(type) {
        case 'move': soundAsset = require('../../assets/sounds/move.mp3'); break;
        case 'capture': soundAsset = require('../../assets/sounds/capture.mp3'); break;
        case 'check': soundAsset = require('../../assets/sounds/check.mp3'); break;
        case 'end': soundAsset = require('../../assets/sounds/end.mp3'); break;
      }
      const player = createAudioPlayer(soundAsset);
      player.play();
      // Dispose after playback finishes (approximate duration + buffer)
      setTimeout(() => {
        try { player.release(); } catch (_e) { /* already disposed */ }
      }, 3000);
    } catch (error) {
      console.warn("Failed to play sound", error);
    }
  };

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

  // Bot Mode Init
  useEffect(() => {
    if (isBotMode) {
      clearEngineFallbackTimer();
      pendingBotFen.current = null;
      chess.reset();
      const pColor = botColorSelection === 'random' ? (Math.random() > 0.5 ? 'w' : 'b') : botColorSelection;
      setMyColor(pColor as 'w' | 'b');
      myColorRef.current = pColor as 'w' | 'b';
      setFen(chess.fen());
      setLastMove(null);
      setSelectedSquare(null);
      setLegalTargets([]);
      setEndgameMessage(null);
      setShowLegalMoves(showLegalMovesParam);
      setWhiteTime(600);
      setBlackTime(600);
      setOpponentInfo({ name: 'Stockfish Bot', avatarUrl: null });
      setGameStarted(true);
    }
  }, [isBotMode, botColorSelection, chess, showLegalMovesParam]);


  // Seat claiming and heartbeats
  useEffect(() => {
    if (!gameId || isBotMode) return;
    const user = auth.currentUser;
    if (!user) return;

    const seatsRef = ref(db, `games/${gameId}/seats`);
    let isMounted = true;
    let unsubscribeSeats: (() => void) | null = null;

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
        connectedAt: getServerTime()
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

        unsubscribeSeats = onValue(seatsRef, (snap) => {
          if (!isMounted) return;
          const seats = snap.val() || {};
          const isLive = (s: any) => s && s.connectedAt && (getServerTime() - s.connectedAt < 30000);

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
         update(ref(db, `games/${gameId}/seats/${myColorRef.current}`), { connectedAt: getServerTime() }).catch(() => {});
      }
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(heartbeatInterval);
      if (unsubscribeSeats) unsubscribeSeats();
      if (myColorRef.current) {
        set(ref(db, `games/${gameId}/seats/${myColorRef.current}`), null);
      }
    };
  }, [gameId]);

  // Initialize last read timestamp from storage
  useEffect(() => {
    if (!gameId || isBotMode) return;
    const loadLastRead = async () => {
      try {
        const val = await AsyncStorage.getItem(`chat_last_read_${gameId}`);
        if (val) {
          lastReadTimestampRef.current = parseInt(val, 10);
        }
      } catch (e) {
        console.warn("Failed to load last read chat timestamp", e);
      }
    };
    loadLastRead();
  }, [gameId, isBotMode]);

  // Listen for chat messages to update unread count
  // Uses showChatRef to avoid re-creating the listener on every open/close
  useEffect(() => {
    if (!gameId || isBotMode) return;
    const chatRef = ref(db, `games/${gameId}/chat`);
    const currentUserId = auth.currentUser?.uid;

    const unsubscribe = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setUnreadChatCount(0);
        return;
      }
      
      const messages = Object.values(data) as any[];
      // Count opponent messages newer than our last read timestamp
      const unread = messages.filter((m: any) => 
        m.senderId !== currentUserId && 
        (m.timestamp > lastReadTimestampRef.current)
      ).length;

      if (!showChatRef.current) {
        setUnreadChatCount(prev => {
          if (unread > prev) {
            try { Vibration.vibrate(200); } catch(e) {}
          }
          return unread;
        });
      } else {
        // If chat is open, we mark all current messages as read
        const latestTimestamp = Math.max(...messages.map(m => m.timestamp || 0), 0);
        if (latestTimestamp > lastReadTimestampRef.current) {
          lastReadTimestampRef.current = latestTimestamp;
          AsyncStorage.setItem(`chat_last_read_${gameId}`, latestTimestamp.toString());
        }
        setUnreadChatCount(0);
      }
    });
    return () => unsubscribe();
  }, [gameId, isBotMode]);

  // Update read status when chat is opened
  useEffect(() => {
    if (showChat && gameId) {
      const markAsRead = async () => {
        const now = Date.now(); // Fallback if no messages
        lastReadTimestampRef.current = now;
        await AsyncStorage.setItem(`chat_last_read_${gameId}`, now.toString());
        setUnreadChatCount(0);
      };
      markAsRead();
    }
  }, [showChat, gameId]);

  // Active Game Tracking
  useEffect(() => {
    if (gameStarted && myColor && opponentInfo && !isBotMode) {
      const user = auth.currentUser;
      if (user) {
        set(ref(db, `users/${user.uid}/activeGame`), {
          id: gameId,
          opponent: opponentInfo.name,
          timestamp: getServerTime(),
          myColor
        }).catch(() => {});
      }
    }
  }, [gameStarted, myColor, opponentInfo]);

  // Sync game state
  useEffect(() => {
    if (!gameId || isBotMode) return;
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
               // Clear active game when sync detects game over
               set(ref(db, `users/${user.uid}/activeGame`), null).catch(() => {});

               const endedAt = getServerTime();
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

        if (state.undoRequest && state.undoRequest.from !== myColor && state.undoRequest.at > lastUndoRequestRef.current) {
          lastUndoRequestRef.current = state.undoRequest.at;
          Alert.alert("Undo Request", `${opponentInfo?.name || 'Opponent'} wants to take back their last move. Allow?`, [
            { text: "Decline", onPress: () => {
                update(ref(db, `games/${gameId}`), { undoResponse: { from: myColor, allow: false, at: getServerTime() } });
            }, style: "cancel" },
            { text: "Allow", onPress: () => {
                chess.undo();
                setFen(chess.fen());
                setLastMove(null);
                update(ref(db, `games/${gameId}`), {
                  fen: chess.fen(),
                  board: serializeBoard(chess),
                  turn: chess.turn(),
                  lastMove: null,
                  undoResponse: { from: myColor, allow: true, at: getServerTime() }
                });
            }}
          ]);
        }

        if (state.undoResponse && state.undoResponse.from !== myColor && state.undoResponse.at > lastUndoResponseRef.current) {
          lastUndoResponseRef.current = state.undoResponse.at;
          if (state.undoResponse.allow) {
            Alert.alert('Undo Accepted', 'Your opponent allowed the undo.');
          } else {
            Alert.alert('Undo Declined', 'Your opponent declined the undo request.');
          }
        }
      }
    });

    return () => unsubscribe();
  }, [gameId, chess, myColor, opponentInfo]);

  const turnRef = useRef(chess.turn());
  turnRef.current = chess.turn();

  // Timer Interval
  useEffect(() => {
    if (!gameStarted || chess.isGameOver() || yappingPaused) return;

    const interval = setInterval(() => {
      if (turnRef.current === 'w') {
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
  }, [gameStarted, chess.isGameOver(), yappingPaused, gameId]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const clearEngineFallbackTimer = () => {
    if (engineFallbackTimer.current) {
      clearTimeout(engineFallbackTimer.current);
      engineFallbackTimer.current = null;
    }
  };

  const applyBotMove = useCallback((bestMoveUci: string) => {
    if (!bestMoveUci || bestMoveUci === '(none)' || chess.turn() === myColor || chess.isGameOver()) {
      pendingBotFen.current = null;
      return;
    }

    try {
      const { from, to, promotion } = squareFromUci(bestMoveUci);
      const move = chess.move({ from, to, promotion });
      if (!move) {
        pendingBotFen.current = null;
        return;
      }

      clearEngineFallbackTimer();
      pendingBotFen.current = null;
      setFen(chess.fen());
      setLastMove({ from, to });
      if (chess.isGameOver()) {
        playSound('end');
        const endMsg = checkEndgame(chess);
        let isWin: boolean | null = null;
        if (chess.isCheckmate()) {
          isWin = chess.turn() !== myColor;
        }
        handleGameOver(endMsg?.title || 'Game Over', isWin);
      } else if (chess.inCheck()) {
        playSound('check');
      } else if (move.captured) {
        playSound('capture');
      } else {
        playSound('move');
      }
    } catch (e) {
      pendingBotFen.current = null;
      console.warn('Bot move error', e);
    }
  }, [chess, myColor]);

  const runFallbackBot = useCallback(() => {
    if (!isBotMode || !myColor || chess.isGameOver() || chess.turn() === myColor) {
      pendingBotFen.current = null;
      return;
    }

    const fallbackMove = getFallbackBotMove(chess.fen(), 2);
    if (fallbackMove) {
      applyBotMove(fallbackMove);
    } else {
      pendingBotFen.current = null;
    }
  }, [applyBotMove, chess, isBotMode, myColor]);

  const triggerBot = useCallback((force = false) => {
    if (!isBotMode || !myColor || chess.isGameOver() || chess.turn() === myColor) return;
    const currentFen = chess.fen();
    if (!force && pendingBotFen.current === currentFen) return;

    clearEngineFallbackTimer();
    pendingBotFen.current = currentFen;

    if (webViewRef.current && isEngineReady.current) {
      webViewRef.current.postMessage(`position fen ${currentFen}`);
      webViewRef.current.postMessage('go depth 10');
      engineFallbackTimer.current = setTimeout(runFallbackBot, 1800);
    } else {
      engineFallbackTimer.current = setTimeout(runFallbackBot, 250);
    }
  }, [chess, isBotMode, myColor, runFallbackBot]);

  const onWebViewMessage = (event: any) => {
    const data = event.nativeEvent.data;
    if (data === 'READY') {
      isEngineReady.current = true;
      if (chess.turn() !== myColor) {
        pendingBotFen.current = null;
        triggerBot(true); // If bot is white, it should move first
      }
      return;
    }

    if (typeof data === 'string' && data.startsWith('ERROR:')) {
      console.warn('Stockfish WebView error', data);
      runFallbackBot();
      return;
    }
    
    if (typeof data === 'string' && data.startsWith('bestmove')) {
      const parts = data.split(' ');
      const bestMoveUci = parts[1];
      applyBotMove(bestMoveUci);
    }
  };

  useEffect(() => {
    if (isBotMode && gameStarted && myColor && chess.turn() !== myColor && !chess.isGameOver()) {
      triggerBot();
    }

    return () => clearEngineFallbackTimer();
  }, [fen, gameStarted, isBotMode, myColor, triggerBot]);

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
          if (isBotMode) {
             setFen(chess.fen());
             if (!isOver) {
                 setTimeout(() => triggerBot(), 100);
             }
             return;
          }

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
                at: getServerTime()
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
            result: isOver ? { type: chess.isCheckmate() ? 'checkmate' : chess.isStalemate() ? 'stalemate' : 'draw', winner: chess.isCheckmate() ? (chess.turn() === 'w' ? 'b' : 'w') : null, endedAt: getServerTime() } : null,
            endgameMessage: endMsg || null,
            updatedAt: getServerTime(),
            whiteTime,
            blackTime,
            clocks: { w: whiteTime, b: blackTime },
            clockStartedAt: isOver ? null : getServerTime(),
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
  }, [chess, selectedSquare, myColor, gameId, gameStarted, whiteTime, blackTime, showLegalMoves]);

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
    if (chess.history().length === 0) return;

    if (isBotMode) {
      if (chess.turn() === myColor && chess.history().length >= 2) {
        chess.undo(); // undo bot move
        chess.undo(); // undo my move
        setFen(chess.fen());
        setLastMove(null);
        clearEngineFallbackTimer();
      } else if (chess.turn() !== myColor) {
        chess.undo(); // undo my move if bot hasn't moved yet
        setFen(chess.fen());
        setLastMove(null);
        clearEngineFallbackTimer();
      } else {
        Alert.alert('Undo', 'Cannot undo right now.');
      }
    } else {
      Alert.alert('Undo Request', 'Send an undo request to your opponent?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Request',
          onPress: () => {
            update(ref(db, `games/${gameId}`), {
              undoRequest: {
                from: myColor,
                at: getServerTime()
              }
            });
            Alert.alert('Sent', 'Waiting for opponent to respond...');
          }
        }
      ]);
    }
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
    
    const endedAt = getServerTime();
    
    // Clear active game
    const user = auth.currentUser;
    if (user) {
      set(ref(db, `users/${user.uid}/activeGame`), null).catch(() => {});
    }

    const baseKey = String(gameId || 'game').replace(/[^A-Za-z0-9_-]/g, '_');
    const historyKey = `${baseKey}_${endedAt}`;

    update(ref(db, `users/${uid}/matchHistory/${historyKey}`), {
      gameId,
      at: endedAt,
      timestamp: endedAt,
      mode: isBotMode ? 'bot' : 'pvp',
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
            result: { type: 'resigned', winner: myColor === 'w' ? 'b' : 'w', endedAt: getServerTime() },
            endgameMessage: endMsg
          });
          
          if (!matchHistoryRecorded.current && myColor) {
             const user = auth.currentUser;
             if (user) {
               // Clear active game
               set(ref(db, `users/${user.uid}/activeGame`), null).catch(() => {});

               const endedAt = getServerTime();
               const baseKey = String(gameId || 'game').replace(/[^A-Za-z0-9_-]/g, '_');
               const historyKey = `${baseKey}_${endedAt}`;
               const durationSec = (600 - whiteTime) + (600 - blackTime);
               update(ref(db, `users/${user.uid}/matchHistory/${historyKey}`), {
                 gameId,
                 at: endedAt,
                 timestamp: endedAt,
                 mode: isBotMode ? 'bot' : 'pvp',
                 myColor,
                 myName: user.displayName || 'Player',
                 opponent: opponentInfo?.name || 'Opponent',
                 opponentName: opponentInfo?.name || 'Opponent',
                 outcome: 'Loss',
                 reason: 'Resignation',
                 durationSec: durationSec > 0 ? durationSec : 120
               });
               matchHistoryRecorded.current = true;
             }
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
      loveAt: getServerTime(),
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
  const remoteStreamUrl = remoteStream?.toURL?.() || null;
  const localStreamUrl = localStream?.toURL?.() || null;

  useEffect(() => {
    console.log("[WEBRTC]", "RTCView render path", {
      remoteStreamIsNull: !remoteStream,
      remoteStreamURL: remoteStreamUrl,
      remoteRTCViewReceivesStreamURL: !!remoteStreamUrl,
      localStreamIsNull: !localStream,
      localStreamURL: localStreamUrl,
      localRTCViewReceivesStreamURL: !!localStreamUrl,
    });
  }, [remoteStream, remoteStreamUrl, localStream, localStreamUrl]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Leave</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => !isBotMode && Share.share({ message: `Join my match on ChessTime using code: ${gameId}` })} 
          onLongPress={async () => {
            if (isBotMode) return;
            await Clipboard.setStringAsync(gameId);
            Alert.alert('Copied!', 'Game code copied to clipboard');
          }}
          style={styles.titleContainer}
          disabled={isBotMode}
        >
          <Text style={styles.title}>
            {isBotMode ? 'Vs Computer' : `Code: ${gameId}`} 
            {!isBotMode && <Ionicons name="share-outline" size={16} />}
          </Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => { showChatRef.current = true; setShowChat(true); setUnreadChatCount(0); }} style={styles.chatBtn}>
            <View>
              <Ionicons name="chatbubbles-outline" size={24} color={theme.colors.primary} />
              {unreadChatCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadChatCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleAudioMute}
            style={[
              styles.micBtn,
              audioMuted && styles.micMuted,
              (!cameraEnabled || isBotMode) && styles.micDisabled,
            ]}
            disabled={!cameraEnabled || isBotMode}
            accessibilityRole="button"
            accessibilityLabel={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <Ionicons
              name={audioMuted ? 'mic-off' : 'mic'}
              size={20}
              color={
                !cameraEnabled || isBotMode
                  ? theme.colors.textMuted
                  : audioMuted
                    ? theme.colors.danger
                    : theme.colors.primary
              }
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleCamera} style={styles.camBtn} disabled={isBotMode}>
            <Text style={[styles.camText, cameraEnabled && styles.camActive]}>
              {cameraEnabled ? '📹 On' : '📹 Off'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Opponent Card (Top) */}
      <View style={[styles.playerCard, quickConvo && styles.quickConvoCard]}>
         <View style={[styles.videoPlaceholder, quickConvo && styles.quickConvoVideo]}>
           {remoteStreamUrl ? (
             <RTCView key={remoteStreamUrl} streamURL={remoteStreamUrl} style={[styles.video, quickConvo && styles.quickConvoInnerVideo]} objectFit="cover" zOrder={0} />
           ) : opponentInfo?.avatarUrl ? (
             <Image source={{ uri: opponentInfo.avatarUrl }} style={[styles.avatarImage, quickConvo && styles.quickConvoInnerVideo]} />
           ) : (
             <Ionicons name="person" size={quickConvo ? 120 : 24} color={theme.colors.textMuted} />
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
      <View style={[styles.playerCard, getGlowStyle(theme.colors.border), quickConvo && styles.quickConvoCard]}>
         <View style={[styles.videoPlaceholder, quickConvo && styles.quickConvoVideo]}>
           {localStreamUrl ? (
             <RTCView key={localStreamUrl} streamURL={localStreamUrl} style={[styles.video, quickConvo && styles.quickConvoInnerVideo]} objectFit="cover" zOrder={1} mirror />
           ) : myAvatarUrl ? (
             <Image source={{ uri: myAvatarUrl }} style={[styles.avatarImage, quickConvo && styles.quickConvoInnerVideo]} />
           ) : (
             <Ionicons name="person" size={quickConvo ? 120 : 24} color={theme.colors.textMuted} />
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
             
             <View style={[styles.timerBadge, getGlowStyle(theme.colors.border)]}>
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
        <ChatPanel gameId={gameId} onClose={() => { showChatRef.current = false; setShowChat(false); setUnreadChatCount(0); }} />
      )}

      {isBotMode && (
        <View style={{ width: 1, height: 1, overflow: 'hidden', position: 'absolute', opacity: 0 }}>
          <WebView 
            ref={webViewRef}
            source={{ html: STOCKFISH_HTML }}
            onMessage={onWebViewMessage}
            javaScriptEnabled
            originWhitelist={['*']}
            allowFileAccess
            allowUniversalAccessFromFileURLs
            mixedContentMode="always"
            style={{ width: 1, height: 1 }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const getStyles = (theme: any) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatBtn: { padding: 4 },
  backBtn: { width: 80 },
  backText: { fontFamily: 'System', color: theme.colors.primary, fontSize: 16 },
  titleContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'System', fontWeight: '700', color: theme.colors.text, fontSize: 16, textAlign: 'center' },
  camBtn: { width: 64, alignItems: 'flex-end' },
  camText: { fontFamily: 'System', color: theme.colors.textMuted, fontSize: 14 },
  camActive: { color: theme.colors.primary },
  micBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  micMuted: { borderColor: theme.colors.danger, backgroundColor: 'rgba(255, 82, 82, 0.1)' },
  micDisabled: { opacity: 0.45 },
  
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: theme.colors.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },

  playerCard: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16, zIndex: 10, backgroundColor: theme.colors.surface, borderRadius: 16 },
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
  
  quickConvoCard: { flex: 1, padding: 0, marginHorizontal: 0, marginTop: 0, marginBottom: 0, backgroundColor: 'transparent', borderTopWidth: 0, justifyContent: 'center', alignItems: 'center' },
  quickConvoVideo: { width: '100%', height: '100%', borderRadius: 0, borderWidth: 0, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  quickConvoInnerVideo: { width: '100%', height: '100%', borderRadius: 0 },
  avatarImage: { width: 56, height: 56, borderRadius: 28 },
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

