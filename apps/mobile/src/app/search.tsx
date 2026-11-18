/**
 * Search in the text of every note, as on the desktop: the results show the
 * lines that matched, with the words lit, and a tap opens the note.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { router, Stack } from 'expo-router'
import { Search } from 'lucide-react-native'
import type { SearchResult } from '@markdown-viewer/core/search'
import { idAt, useVault } from '../vault/runtime'
import { searchVault, warmSearch } from '../vault/search'
import { colors, radius } from '../ui/theme'

/** The words of a line, with the hits in their own style. */
function Lit({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = []
  let at = 0
  ranges.forEach(([from, to], i) => {
    if (from < at) return
    parts.push(text.slice(at, from))
    parts.push(
      <Text key={i} style={styles.hit}>
        {text.slice(from, to)}
      </Text>,
    )
    at = to
  })
  parts.push(text.slice(at))
  return (
    <Text style={styles.line} numberOfLines={2}>
      {parts}
    </Text>
  )
}

export default function SearchScreen() {
  const vault = useVault()
  const [query, setQuery] = useState('')
  const [answered, setAnswered] = useState<{ query: string; items: SearchResult[] } | null>(null)
  const trimmed = query.trim()
  const busy = trimmed !== '' && answered?.query !== trimmed

  // The first search reads every note; it starts as the screen opens.
  useEffect(() => {
    void warmSearch(vault.index, vault.files)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!trimmed) return
    let live = true
    // Typing is not held up by a search per letter.
    const timer = setTimeout(() => {
      void searchVault(trimmed, vault.index, vault.files).then((items) => {
        if (live) setAnswered({ query: trimmed, items })
      })
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [trimmed, vault.index, vault.files])

  const results = trimmed && answered?.query === trimmed ? answered.items : []

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Buscar' }} />
      <View style={styles.field}>
        <Search size={18} color={colors.textTertiary} strokeWidth={1.75} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          placeholder='Palavras, "frase", #tag, path:Pasta'
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      </View>
      {trimmed && !busy ? (
        <Text style={styles.count}>
          {results.length === 0
            ? 'Nada encontrado.'
            : results.length === 1
              ? '1 nota'
              : `${results.length >= 100 ? 'Mais de 100' : results.length} notas`}
        </Text>
      ) : null}
      <FlatList
        data={results}
        keyExtractor={(item) => item.path}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              const id = idAt(item.path)
              if (id) router.push({ pathname: '/note', params: { id } })
            }}
            style={({ pressed }) => [styles.result, pressed && styles.pressed]}
          >
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.path} numberOfLines={1}>
              {item.path}
            </Text>
            {item.matches.slice(0, 3).map((match) => (
              <Lit key={match.line} text={match.preview} ranges={match.ranges} />
            ))}
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgApp },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 14,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 16, paddingVertical: 10 },
  count: { color: colors.textTertiary, fontSize: 13, paddingHorizontal: 20, paddingVertical: 6 },
  result: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  pressed: { backgroundColor: colors.surface1 },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  path: { color: colors.textTertiary, fontSize: 12 },
  line: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 2 },
  hit: { color: colors.textPrimary, backgroundColor: 'rgba(255, 77, 79, 0.22)', fontWeight: '600' },
})
