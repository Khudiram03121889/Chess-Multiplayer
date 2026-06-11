import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeType = 'neon' | 'cream' | 'green' | 'og';

export const THEMES = {
  neon: {
    colors: {
      background: '#1c1c1e',
      surface: '#2c2c2e',
      primary: '#8ecae6',
      danger: '#ff5252',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: 'rgba(255, 255, 255, 0.1)',
      boardDark: '#2c2c2e',
      boardLight: '#3a3a3c',
    }
  },
  cream: {
    colors: {
      background: '#f8f4e6',
      surface: '#ffffff',
      primary: '#c08552',
      danger: '#ff5252',
      text: '#2d2d2d',
      textMuted: '#8b8b8b',
      border: 'rgba(0, 0, 0, 0.1)',
      boardDark: '#d1b99f',
      boardLight: '#f3e8d6',
    }
  },
  green: {
    colors: {
      background: '#e8eed5',
      surface: '#ffffff',
      primary: '#5c8a4c',
      danger: '#d32f2f',
      text: '#1a1a1a',
      textMuted: '#666666',
      border: 'rgba(0, 0, 0, 0.1)',
      boardDark: '#769656',
      boardLight: '#eeeed2',
    }
  },
  og: {
    colors: {
      background: '#000000',
      surface: '#111111',
      primary: '#ff3366',
      danger: '#ff0000',
      text: '#ffffff',
      textMuted: '#888888',
      border: '#333333',
      boardDark: '#333333',
      boardLight: '#555555',
    }
  }
};

export const FONTS = {
  cinzel: 'Cinzel_400Regular',
  cinzelBold: 'Cinzel_600SemiBold',
  crimson: 'CrimsonText_400Regular',
  crimsonItalic: 'CrimsonText_400Regular_Italic',
  crimsonBold: 'CrimsonText_600SemiBold',
};

// Default fallback for non-component usages if absolutely needed
export const Theme = {
  colors: THEMES.neon.colors,
  fonts: FONTS
};

type ThemeContextType = {
  themeName: ThemeType;
  theme: typeof THEMES.neon;
  fonts: typeof FONTS;
  setTheme: (name: ThemeType) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  themeName: 'neon',
  theme: THEMES.neon,
  fonts: FONTS,
  setTheme: () => {},
});

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [themeName, setThemeName] = useState<ThemeType>('neon');

  useEffect(() => {
    AsyncStorage.getItem('chesstime_theme').then((saved) => {
      if (saved && THEMES[saved as ThemeType]) {
        setThemeName(saved as ThemeType);
      }
    });
  }, []);

  const handleSetTheme = (name: ThemeType) => {
    setThemeName(name);
    AsyncStorage.setItem('chesstime_theme', name);
  };

  return (
    <ThemeContext.Provider value={{ themeName, theme: THEMES[themeName], fonts: FONTS, setTheme: handleSetTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
