import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, getGlowStyle } from '../theme/theme';
import { auth, db } from '../firebase/config';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { ref, set } from 'firebase/database';

export default function AuthScreen() {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password.');
      return;
    }

    if (!isLogin && !displayName.trim()) {
      Alert.alert('Error', 'Please enter a display name.');
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;
        
        await set(ref(db, `users/${uid}/profile`), {
          displayName: displayName.trim(),
          avatarUri: '', 
          reunionPartnerEmail: '',
          reunionAt: null,
          updatedAt: Date.now()
        });
      }
    } catch (error: any) {
      Alert.alert('Authentication Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <Text style={styles.title}>ChessTime</Text>

        <View style={[styles.segmentedControl, getGlowStyle(theme.colors.border)]}>
          <TouchableOpacity onPress={() => setIsLogin(true)} style={[styles.segment, isLogin && styles.segmentActive]}>
            <Text style={[styles.segmentText, isLogin && styles.segmentTextActive]}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsLogin(false)} style={[styles.segment, !isLogin && styles.segmentActive]}>
            <Text style={[styles.segmentText, !isLogin && styles.segmentTextActive]}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.form}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput 
              style={styles.input} 
              placeholder="e.g. magnus@chesstime.com"
              placeholderTextColor={theme.colors.textMuted} 
              keyboardType="email-address" 
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            
            <Text style={styles.label}>Password</Text>
            <TextInput 
              style={styles.input} 
              placeholder="••••••••"
              placeholderTextColor={theme.colors.textMuted} 
              secureTextEntry 
              value={password}
              onChangeText={setPassword}
            />

            {!isLogin && (
              <>
                <Text style={styles.label}>Display Name</Text>
                <TextInput 
                  style={styles.input} 
                  placeholder="e.g. Grandmaster"
                  placeholderTextColor={theme.colors.textMuted} 
                  value={displayName}
                  onChangeText={setDisplayName}
                />
              </>
            )}

            <TouchableOpacity style={[styles.submitBtn, getGlowStyle(theme.colors.primary)]} onPress={handleAuth} disabled={loading}>
              {loading ? (
                <ActivityIndicator color={theme.colors.background} />
              ) : (
                <Text style={styles.submitBtnText}>{isLogin ? 'Log In' : 'Create Account'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (theme: any) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 24 },
  title: {
    fontFamily: 'System',
    fontWeight: '700',
    fontSize: 32,
    color: theme.colors.text,
    textAlign: 'center',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentActive: {
    backgroundColor: theme.colors.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    color: theme.colors.textMuted,
    fontWeight: '600',
    fontSize: 14,
  },
  segmentTextActive: {
    color: theme.colors.text,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 24,
  },
  form: { gap: 16 },
  label: { color: theme.colors.text, fontSize: 12, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.surface,
    borderRadius: 8,
    padding: 14,
    color: theme.colors.text,
    fontSize: 16,
  },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnText: {
    color: theme.colors.background,
    fontWeight: '700',
    fontSize: 16,
  }
});