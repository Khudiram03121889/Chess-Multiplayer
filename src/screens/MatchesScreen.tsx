import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, getGlowStyle } from '../theme/theme';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../firebase/config';
import { ref, get } from 'firebase/database';

interface MatchItem {
  id: string;
  opponent: string;
  outcome: string;
  timestamp: number;
  durationSec: number;
}

export default function MatchesScreen() {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const navigation = useNavigation();

  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const snap = await get(ref(db, `users/${user.uid}/matchHistory`));
        if (snap.exists()) {
          const data = snap.val();
          // Convert object to array and sort by descending timestamp
          const items: MatchItem[] = Object.keys(data).map(key => {
            const item = data[key];
            const ts = item.timestamp || item.at || Date.now();
            const opp = item.opponent || item.opponentName || 'Unknown';
            const rawOutcome = item.outcome || 'Draw';
            const outcome = rawOutcome.charAt(0).toUpperCase() + rawOutcome.slice(1).toLowerCase();
            return {
              id: key,
              opponent: opp,
              outcome,
              timestamp: ts,
              durationSec: item.durationSec || 0
            };
          }).sort((a, b) => b.timestamp - a.timestamp);
          setMatches(items);
        }
      } catch (err) {
        console.warn('Failed to load matches', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const renderItem = ({ item }: { item: MatchItem }) => {
    const mins = Math.floor((item.durationSec || 0) / 60);
    const secs = (item.durationSec || 0) % 60;
    const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString() : 'Unknown date';
    const durationStr = `${mins}m ${secs}s`;
    
    return (
      <View style={[styles.card, getGlowStyle(theme.colors.border)]}>
        <View style={styles.cardLeft}>
          <View style={styles.avatar}><Ionicons name="person" size={20} color={theme.colors.surface} /></View>
          <Text style={styles.opponent}>{item.opponent || 'Unknown'}</Text>
        </View>
        
        <View style={styles.cardRight}>
          <Text style={[
            styles.result, 
            item.outcome === 'Win' ? styles.win : item.outcome === 'Loss' ? styles.loss : styles.draw
          ]}>{item.outcome}</Text>
          <Text style={styles.meta}>{dateStr} • {durationStr}</Text>
          
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (navigation as any).toggleDrawer()}>
          <Ionicons name="menu" size={32} color={theme.colors.text} style={{ marginRight: 16 }} />
        </TouchableOpacity>
        <Text style={styles.title}>Match History</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : matches.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: theme.colors.textMuted }}>No match history yet.</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (theme: any) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: 24, paddingBottom: 16, flexDirection: 'row', alignItems: 'center' },
  title: { color: theme.colors.text, fontSize: 24, fontWeight: '700' },
  list: { padding: 24, gap: 16 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
  opponent: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  result: { fontSize: 14, fontWeight: '700' },
  win: { color: theme.colors.primary },
  loss: { color: theme.colors.danger },
  draw: { color: theme.colors.textMuted },
  meta: { color: theme.colors.textMuted, fontSize: 12 }
});