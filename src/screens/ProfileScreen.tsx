import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, getGlowStyle } from '../theme/theme';
import { auth, db } from '../firebase/config';
import { signOut } from 'firebase/auth';
import { ref, get, update } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function ProfileScreen() {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const navigation = useNavigation();

  const [displayName, setDisplayName] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [reunionDate, setReunionDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const snap = await get(ref(db, `users/${user.uid}/profile`));
        if (snap.exists()) {
          const p = snap.val();
          setDisplayName(p.displayName || '');
          setPartnerEmail(p.reunionPartnerEmail || '');
          if (p.reunionAt) setReunionDate(new Date(p.reunionAt));
          if (p.avatarUri) setAvatarUri(p.avatarUri);
          else if (p.avatarDataUrl) setAvatarUri(p.avatarDataUrl);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setSaving(true);
    try {
      await update(ref(db, `users/${user.uid}/profile`), {
        displayName: displayName.trim(),
        reunionPartnerEmail: partnerEmail.trim(),
        reunionAt: reunionDate ? reunionDate.getTime() : null,
        avatarUri,
        avatarDataUrl: avatarUri,
        updatedAt: Date.now()
      });
      Alert.alert('Success', 'Profile updated successfully.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handlePickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission needed', 'Permission to access gallery is required!');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      setAvatarUri(`data:image/jpeg;base64,${result.assets[0].base64}`);
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (navigation as any).toggleDrawer()}>
          <Ionicons name="menu" size={32} color={theme.colors.text} style={{ marginRight: 16 }} />
        </TouchableOpacity>
        <Text style={styles.title}>Profile & Settings</Text>
      </View>

      <View style={styles.container}>
        <View style={styles.panel}>
          
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={{ width: 100, height: 100, borderRadius: 50 }} />
              ) : (
                <Image source={require('../../assets/images/profile_avatar.png')} style={{ width: 100, height: 100, borderRadius: 50 }} />
              )}
            </View>
            <TouchableOpacity style={styles.editIcon} onPress={handlePickImage}>
              <Ionicons name="pencil" size={16} color={theme.colors.background} />
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Display Name</Text>
            <TextInput 
              style={styles.input} 
              placeholderTextColor={theme.colors.textMuted}
              value={displayName}
              onChangeText={setDisplayName}
            />

            <Text style={styles.label}>Partner's Email</Text>
            <TextInput 
              style={styles.input} 
              placeholder="For Reunion Link"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              value={partnerEmail}
              onChangeText={setPartnerEmail}
            />
            
            <Text style={styles.label}>Reunion Date</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
              <Text style={{ color: reunionDate ? theme.colors.text : theme.colors.textMuted }}>
                {reunionDate ? reunionDate.toLocaleDateString() : 'Select Date...'}
              </Text>
            </TouchableOpacity>

            {showDatePicker && (
              <DateTimePicker
                value={reunionDate || new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(event, selectedDate) => {
                  setShowDatePicker(Platform.OS === 'ios');
                  if (selectedDate) setReunionDate(selectedDate);
                }}
                themeVariant="dark"
              />
            )}
          </View>

        </View>

        <TouchableOpacity style={[styles.saveBtn, getGlowStyle(theme.colors.primary)]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={theme.colors.background} /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Log Out</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const getStyles = (theme: any) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 24, paddingBottom: 16, flexDirection: 'row', alignItems: 'center' },
  title: { color: theme.colors.text, fontSize: 24, fontWeight: '700' },
  container: { padding: 24, gap: 24 },
  panel: { backgroundColor: theme.colors.surface, borderRadius: 16, padding: 24, alignItems: 'center' },
  avatarContainer: { position: 'relative', marginBottom: 32 },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
  editIcon: { position: 'absolute', bottom: 0, right: 0, backgroundColor: theme.colors.primary, width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: theme.colors.surface },
  form: { width: '100%', gap: 12 },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 14, color: theme.colors.text, fontSize: 16 },
  saveBtn: { backgroundColor: theme.colors.primary, padding: 18, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: theme.colors.background, fontSize: 16, fontWeight: '700' },
  logoutBtn: { padding: 16, alignItems: 'center' },
  logoutBtnText: { color: theme.colors.danger, fontSize: 16, fontWeight: '600' }
});