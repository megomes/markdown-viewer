/**
 * The marks that are slow to reach on a phone's keyboard, in a row right above
 * it. Native, not part of the note's web view: a sideways drag inside the web
 * view is taken by Android before the page sees it, and the row would not scroll.
 *
 * A tap here does not take the focus away from the text (these views cannot be
 * focused), so the keyboard stays up; the editor runs what was tapped.
 */

import type { ComponentType } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  Bold,
  Camera,
  Heading,
  Image as ImageIcon,
  Italic,
  List,
  ListChecks,
  Redo2,
  Undo2,
} from 'lucide-react-native'
import type { EditorCommand } from '../dom/NoteEditor'
import { colors, radius } from './theme'

type Icon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>

const KEYS: { command: EditorCommand; label: string; icon?: Icon; text?: string }[] = [
  { command: 'heading', label: 'Título', icon: Heading },
  { command: 'list', label: 'Lista', icon: List },
  { command: 'task', label: 'Tarefa', icon: ListChecks },
  { command: 'link', label: 'Link para nota', text: '[[ ]]' },
  { command: 'bold', label: 'Negrito', icon: Bold },
  { command: 'italic', label: 'Itálico', icon: Italic },
  { command: 'camera', label: 'Tirar foto', icon: Camera },
  { command: 'library', label: 'Imagem da galeria', icon: ImageIcon },
  { command: 'undo', label: 'Desfazer', icon: Undo2 },
  { command: 'redo', label: 'Refazer', icon: Redo2 },
]

export function MarkdownBar({ onPress }: { onPress: (command: EditorCommand) => void }) {
  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.row}
      >
        {KEYS.map(({ command, label, icon: IconOf, text }) => (
          <Pressable
            key={command}
            onPress={() => onPress(command)}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.key, pressed && styles.pressed]}
          >
            {IconOf ? (
              <IconOf size={20} color={colors.textPrimary} strokeWidth={1.9} />
            ) : (
              <Text style={styles.text}>{text}</Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface1,
    borderTopWidth: 1,
    borderTopColor: colors.borderDefault,
  },
  row: { gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  key: {
    minWidth: 46,
    height: 40,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    backgroundColor: colors.surface2,
  },
  pressed: { backgroundColor: colors.surfaceHover },
  text: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
})
