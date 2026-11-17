/**
 * What the app shows while it opens: its blue gradient with the mark in the
 * middle.
 *
 * Android's own launch screen (Android 12 on) takes one flat colour and the
 * icon, nothing else. So the system shows that colour with the mark, and this
 * screen takes over in the same place with the full gradient: the system one is
 * hidden only once this one has been drawn, so the change does not show.
 */

import { useEffect } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'

/** The gradient of the brand, top to bottom. The middle stop is the system screen's colour. */
export const LAUNCH_GRADIENT = 'linear-gradient(180deg, #3b39a8 0%, #1b1964 42%, #07061c 100%)'
/** The width the system screen gives the mark (app.json, expo-splash-screen's imageWidth). */
const MARK = 120

let hidden = false

/** Takes the system launch screen away. Safe to call more than once. */
export function hideLaunch(): void {
  if (hidden) return
  hidden = true
  void SplashScreen.hideAsync().catch(() => {})
}

export function LaunchScreen() {
  // A screen that never gets drawn would leave the system one up for good.
  useEffect(() => {
    const fallback = setTimeout(hideLaunch, 1500)
    return () => clearTimeout(fallback)
  }, [])
  return (
    <View style={styles.screen} onLayout={hideLaunch}>
      <Image source={require('../../assets/splash-icon.png')} style={styles.mark} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1b1964',
    backgroundImage: LAUNCH_GRADIENT,
  },
  mark: { width: MARK, height: MARK },
})
