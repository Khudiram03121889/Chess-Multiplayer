import React, { useEffect, useState } from 'react';
import { View, Animated, StyleSheet, Easing, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

interface Heart {
  id: number;
  startX: number;
  startY: number;
  anim: Animated.Value;
  scaleAnim: Animated.Value;
}

export default function SplashingHearts({ triggerCount }: { triggerCount: number }) {
  const [hearts, setHearts] = useState<Heart[]>([]);

  useEffect(() => {
    if (triggerCount > 0) {
      spawnHearts();
    }
  }, [triggerCount]);

  const spawnHearts = () => {
    const newHearts: Heart[] = [];
    // Spawn 15 hearts
    for (let i = 0; i < 15; i++) {
      newHearts.push({
        id: Date.now() + i,
        startX: width / 2 - 20,
        startY: height / 2 - 20,
        anim: new Animated.Value(0),
        scaleAnim: new Animated.Value(0),
      });
    }

    setHearts((prev) => [...prev, ...newHearts]);

    newHearts.forEach((heart) => {
      Animated.parallel([
        Animated.timing(heart.anim, {
          toValue: 1,
          duration: 1500 + Math.random() * 1000,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(heart.scaleAnim, {
            toValue: 1 + Math.random(),
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(heart.scaleAnim, {
            toValue: 0,
            duration: 1200 + Math.random() * 1000,
            useNativeDriver: true,
          })
        ])
      ]).start(() => {
        setHearts((prev) => prev.filter(h => h.id !== heart.id));
      });
    });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {hearts.map((heart, index) => {
        // Random explosion direction
        const angle = Math.random() * Math.PI * 2;
        const distance = 100 + Math.random() * 200;
        
        const translateX = heart.anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.cos(angle) * distance],
        });
        
        const translateY = heart.anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.sin(angle) * distance - 100], // move slightly upwards
        });

        const opacity = heart.anim.interpolate({
          inputRange: [0, 0.8, 1],
          outputRange: [1, 1, 0],
        });

        return (
          <Animated.View
            key={heart.id}
            style={[
              styles.heartContainer,
              {
                left: heart.startX,
                top: heart.startY,
                opacity,
                transform: [
                  { translateX },
                  { translateY },
                  { scale: heart.scaleAnim }
                ]
              }
            ]}
          >
            <Ionicons name="heart" size={40} color="#ff3366" />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heartContainer: {
    position: 'absolute',
  }
});
