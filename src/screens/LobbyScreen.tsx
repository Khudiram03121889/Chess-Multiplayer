import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView, Switch, Image, ImageBackground } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, getGlowStyle } from '../theme/theme';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { auth, db } from '../firebase/config';
import { ref, get, update } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'MainDrawer'>;

export default function LobbyScreen() {
  const { theme, setTheme } = useTheme();
  const styles = getStyles(theme);

  const navigation = useNavigation<NavigationProp>();
  const [profileName, setProfileName] = useState('');
  const [reunionDate, setReunionDate] = useState<number | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [gameCode, setGameCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [countdownText, setCountdownText] = useState<string>('No reunion set');
  const [countdownSubText, setCountdownSubText] = useState<string>('Set date in Profile');

  // Settings State
  const [timeControl, setTimeControl] = useState('1h');
  const [showLegalMoves, setShowLegalMoves] = useState(true);
  const [hostColorSelection, setHostColorSelection] = useState<'w' | 'b' | 'random'>('random');
  const [themeColor, setThemeColor] = useState('neon');

  useEffect(() => {
    const fetchProfile = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const snap = await get(ref(db, `users/${user.uid}/profile`));
        if (snap.exists()) {
          const p = snap.val();
          setProfileName(p.displayName || user.email?.split('@')[0] || 'Player');
          if (p.reunionAt) setReunionDate(p.reunionAt);
          if (p.avatarUri) setAvatarUri(p.avatarUri);
          else if (p.avatarDataUrl) setAvatarUri(p.avatarDataUrl);
        } else {
          setProfileName(user.email?.split('@')[0] || 'Player');
        }
      } catch (e) {
        console.error("Failed to load profile", e);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  useEffect(() => {
    if (!reunionDate) {
      setCountdownText('No reunion set');
      setCountdownSubText('Set date in Profile');
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const diff = reunionDate - now;

      if (diff <= 0) {
        setCountdownText('Reunion Day! ♥');
        setCountdownSubText('You are together!');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdownText(`${days}d ${hours}h ${minutes}m ${seconds}s`);
      setCountdownSubText('UNTIL REUNION');
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [reunionDate]);

  const generateRandomGameId = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  const handleCreateGame = async () => {
    const user = auth.currentUser;
    if (!user) return;
    
    const finalHostColor = hostColorSelection === 'random' ? (Math.random() > 0.5 ? 'w' : 'b') : hostColorSelection;
    const gameId = generateRandomGameId();
    try {
      await update(ref(db, `games/${gameId}/meta`), {
        createdBy: user.uid,
        createdByEmail: user.email || '',
        createdAt: Date.now(),
        settings: {
          timeControl,
          showLegalMoves,
          themeColor,
          hostColor: finalHostColor
        }
      });
      // @ts-ignore - Need to navigate to stack from tab
      navigation.navigate('Game', { gameId, theme: themeColor });
    } catch (e: any) {
      Alert.alert('Error', 'Could not create game: ' + e.message);
    }
  };

  const handleJoinGame = async () => {
    let extractedCode = gameCode.trim();
    if (!extractedCode) {
      Alert.alert('Invalid Code', 'Please enter a game code.');
      return;
    }

    // Try to extract just the code if a full sentence was pasted
    if (extractedCode.toLowerCase().includes('code:')) {
      const parts = extractedCode.split(/code:/i);
      extractedCode = parts[parts.length - 1].trim();
    } else if (extractedCode.includes(' ')) {
      // Fallback: assume the last word is the code
      const words = extractedCode.split(' ');
      extractedCode = words[words.length - 1];
    }

    const cleanCode = extractedCode.replace(/[^A-Za-z0-9_-]/g, '').toLowerCase();
    if (cleanCode.length < 6) {
       Alert.alert('Invalid Code', 'Game code must be at least 6 characters.');
       return;
    }
    
    try {
      const snap = await get(ref(db, `games/${cleanCode}/meta`));
      if (!snap.exists()) {
        Alert.alert('Not Found', 'Game not found. Please check the code and try again.');
        return;
      }
      // @ts-ignore
      navigation.navigate('Game', { gameId: cleanCode, theme: themeColor });
    } catch (e: any) {
      Alert.alert('Error', 'Could not join game: ' + e.message);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (navigation as any).toggleDrawer()}>
            <Ionicons name="menu" size={32} color={theme.colors.text} style={{ marginRight: 4 }} />
          </TouchableOpacity>
          <View style={styles.avatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={{ width: 40, height: 40, borderRadius: 20 }} />
            ) : (
              <Image source={require('../../assets/images/profile_avatar.png')} style={{ width: 40, height: 40, borderRadius: 20 }} />
            )}
          </View>
          <Text style={styles.welcomeText}>Welcome, {profileName}</Text>
        </View>

        {/* Reunion Banner */}
        <ImageBackground source={require('../../assets/images/chessboard_bg.png')} style={styles.reunionCard} imageStyle={{ opacity: 0.5 }}>
          <Text style={styles.reunionTitle}>REUNION COUNTDOWN</Text>
          <View>
            <Text style={styles.reunionTime}>{countdownText}</Text>
            <Text style={styles.reunionSubTime}>{countdownSubText}</Text>
          </View>
        </ImageBackground>

        {/* Settings Panel */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Game Setup</Text>
          
          {/* Time Controls */}
          <Text style={styles.label}>Time Control</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll} contentContainerStyle={styles.pillScrollContent}>
            {['3m', '5m', '10m', '30m', '1h'].map(t => (
              <TouchableOpacity key={t} onPress={() => setTimeControl(t)} style={[styles.pill, timeControl === t && styles.pillActive]}>
                <Text style={[styles.pillText, timeControl === t && styles.pillTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Toggles */}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Show legal moves</Text>
            <Switch value={showLegalMoves} onValueChange={setShowLegalMoves} trackColor={{ true: theme.colors.primary }} />
          </View>
          {/* Your Color Selection */}
          <Text style={styles.label}>Your Color</Text>
          <View style={[styles.segmentedControl, getGlowStyle(theme.colors.border)]}>
            <TouchableOpacity onPress={() => setHostColorSelection('w')} style={[styles.segment, hostColorSelection === 'w' && styles.segmentActive]}>
              <Text style={[styles.segmentText, hostColorSelection === 'w' && styles.segmentTextActive]}>White</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setHostColorSelection('random')} style={[styles.segment, hostColorSelection === 'random' && styles.segmentActive]}>
              <Text style={[styles.segmentText, hostColorSelection === 'random' && styles.segmentTextActive]}>Random</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setHostColorSelection('b')} style={[styles.segment, hostColorSelection === 'b' && styles.segmentActive]}>
              <Text style={[styles.segmentText, hostColorSelection === 'b' && styles.segmentTextActive]}>Black</Text>
            </TouchableOpacity>
          </View>

          {/* Themes */}
          <Text style={styles.label}>App Theme</Text>
          <View style={styles.themeRow}>
            {(['neon', 'cream', 'green', 'og'] as const).map(c => {
              let bg = '#1c1c1e';
              if (c === 'cream') bg = '#f2e8d5';
              if (c === 'green') bg = '#769656';
              if (c === 'og') bg = '#c19a6b';
              return (
                <TouchableOpacity key={c} onPress={() => {
                  setThemeColor(c);
                  setTheme(c);
                }} style={[styles.themeCircle, { backgroundColor: bg }, themeColor === c && styles.themeCircleActive]} />
              )
            })}
          </View>
        </View>

        {/* Actions */}
        <TouchableOpacity style={[styles.createBtn, getGlowStyle(theme.colors.primary)]} onPress={handleCreateGame}>
          <Text style={styles.createBtnText}>Create Game</Text>
        </TouchableOpacity>

        <View style={styles.joinContainer}>
          <TextInput 
            style={[styles.joinInput, getGlowStyle(theme.colors.border)]}
            placeholder="Game Code"
            placeholderTextColor={theme.colors.textMuted}
            value={gameCode}
            onChangeText={setGameCode}
            autoCapitalize="none"
          />
          <TouchableOpacity style={[styles.joinBtn, getGlowStyle(theme.colors.border)]} onPress={handleJoinGame}>
            <Text style={styles.joinBtnText}>Join</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (theme: any) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContainer: { padding: 24, paddingBottom: 40, gap: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
  welcomeText: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
  reunionCard: {
    height: 160,
    justifyContent: 'center',
    padding: 20,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  reunionTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 },
  reunionTime: { color: '#ffffff', fontSize: 32, fontWeight: '800' },
  reunionSubTime: { color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginTop: 4, letterSpacing: 1 },
  panel: { backgroundColor: theme.colors.surface, borderRadius: 16, padding: 20, gap: 16 },
  panelTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  segmentedControl: { flexDirection: 'row', backgroundColor: theme.colors.background, borderRadius: 8, padding: 4 },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: theme.colors.surface },
  segmentText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 14 },
  segmentTextActive: { color: theme.colors.text },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  pillScroll: { flexGrow: 0, marginHorizontal: -20 },
  pillScrollContent: { paddingHorizontal: 20, alignItems: 'center' },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: theme.colors.background, marginRight: 8, borderWidth: 1, borderColor: theme.colors.border },
  pillActive: { borderColor: theme.colors.primary, backgroundColor: 'rgba(142, 202, 230, 0.1)' },
  pillText: { color: theme.colors.textMuted, fontWeight: '600' },
  pillTextActive: { color: theme.colors.primary },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleLabel: { color: theme.colors.text, fontSize: 16, fontWeight: '500' },
  themeRow: { flexDirection: 'row', gap: 16 },
  themeCircle: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent' },
  themeCircleActive: { borderColor: theme.colors.primary },
  createBtn: { backgroundColor: theme.colors.primary, padding: 18, borderRadius: 12, alignItems: 'center' },
  createBtnText: { color: theme.colors.background, fontSize: 16, fontWeight: '700' },
  joinContainer: { flexDirection: 'row', gap: 12 },
  joinInput: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: 12, padding: 16, color: theme.colors.text, fontSize: 16, borderWidth: 1, borderColor: theme.colors.border },
  joinBtn: { backgroundColor: theme.colors.surface, paddingHorizontal: 24, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border },
  joinBtnText: { color: theme.colors.text, fontWeight: '600' }
});