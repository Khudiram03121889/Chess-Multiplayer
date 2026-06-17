import React, { useEffect, Component } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './src/navigation/AppNavigator';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from './src/theme/theme';
import { View, Text, ScrollView } from 'react-native';
import { 
  useFonts,
  Cinzel_400Regular,
  Cinzel_600SemiBold 
} from '@expo-google-fonts/cinzel';
import {
  CrimsonText_400Regular,
  CrimsonText_400Regular_Italic,
  CrimsonText_600SemiBold
} from '@expo-google-fonts/crimson-text';
import { setAudioModeAsync } from 'expo-audio';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Error Boundary to catch JS crashes and show them instead of silently closing
class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('App Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#1c1c1e', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#ff5252', fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
            Something went wrong
          </Text>
          <ScrollView style={{ maxHeight: 300 }}>
            <Text style={{ color: '#ffffff', fontSize: 14 }}>
              {this.state.error?.message || 'Unknown error'}
            </Text>
            <Text style={{ color: '#a1a1aa', fontSize: 12, marginTop: 8 }}>
              {this.state.error?.stack || ''}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Cinzel_400Regular,
    Cinzel_600SemiBold,
    CrimsonText_400Regular,
    CrimsonText_400Regular_Italic,
    CrimsonText_600SemiBold,
  });

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    }).catch((err) => {
      console.warn("Failed to set audio mode:", err);
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider style={{ flex: 1 }}>
          <ThemeProvider>
            <NavigationContainer>
              <StatusBar style="light" />
              <AppNavigator />
            </NavigationContainer>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}