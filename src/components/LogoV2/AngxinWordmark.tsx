import * as React from 'react'
import { Box, Text, stringWidth } from '@anthropic/ink'

export type AngxinWordmarkVariant = 'compact' | 'hero'
type WordChar = 'A' | 'N' | 'G' | 'S' | 'H' | 'E'

const WORD: readonly WordChar[] = ['A', 'N', 'G', 'S', 'H', 'E', 'N', 'G']
const BLUE_MACARON_PALETTE = [
  '#90caf9',
  '#81d4fa',
  '#9fc5ff',
  '#8fb8ff',
  '#9caeff',
  '#8ab9ff',
  '#73c2fb',
  '#64b5f6',
] as const

const COMPACT_FONT: Record<WordChar, readonly string[]> = {
  A: ['  /\\   ', ' /__\\  ', '/    \\ ', '||  || '],
  N: ['|\\  | ', '| \\ | ', '|  \\| ', '|   \\|'],
  G: [' /~~\\ ', '|     ', '|  __ ', ' \\__/ '],
  S: [' /~~\\ ', '|     ', ' \\~~\\ ', ' __/ /'],
  H: ['|   | ', '|---| ', '|   | ', '|   | '],
  E: ['|---- ', '|---  ', '|---  ', '|____ '],
}

const HERO_FONT: Record<WordChar, readonly string[]> = {
  A: [
    '   █████╗ ',
    '  ██╔══██╗',
    '  ███████║',
    '  ██╔══██║',
    '  ██║  ██║',
    '  ╚═╝  ╚═╝',
  ],
  N: [
    ' ███╗   ██╗',
    ' ████╗  ██║',
    ' ██╔██╗ ██║',
    ' ██║╚██╗██║',
    ' ██║ ╚████║',
    ' ╚═╝  ╚═══╝',
  ],
  G: [
    '  ██████╗ ',
    ' ██╔════╝ ',
    ' ██║  ███╗',
    ' ██║   ██║',
    ' ╚██████╔╝',
    '  ╚═════╝ ',
  ],
  S: [
    ' ███████╗ ',
    ' ██╔════╝ ',
    ' ███████╗ ',
    ' ╚════██║ ',
    ' ███████║ ',
    ' ╚══════╝ ',
  ],
  H: [
    ' ██╗  ██╗ ',
    ' ██║  ██║ ',
    ' ███████║ ',
    ' ██╔══██║ ',
    ' ██║  ██║ ',
    ' ╚═╝  ╚═╝ ',
  ],
  E: [
    ' ███████╗ ',
    ' ██╔════╝ ',
    ' █████╗   ',
    ' ██╔══╝   ',
    ' ███████╗ ',
    ' ╚══════╝ ',
  ],
}

function getFont(
  variant: AngxinWordmarkVariant,
): Record<WordChar, readonly string[]> {
  return variant === 'hero' ? HERO_FONT : COMPACT_FONT
}

function getLetterGap(variant: AngxinWordmarkVariant): string {
  return variant === 'hero' ? ' ' : '  '
}

function getGlyphWidth(lines: readonly string[]): number {
  return Math.max(...lines.map(line => stringWidth(line)))
}

export function getAngxinWordmarkWidth(
  variant: AngxinWordmarkVariant,
): number {
  const font = getFont(variant)
  const gapWidth = stringWidth(getLetterGap(variant))

  return WORD.reduce((total, char, index) => {
    const glyphWidth = getGlyphWidth(font[char])
    return total + glyphWidth + (index < WORD.length - 1 ? gapWidth : 0)
  }, 0)
}

export function AngxinWordmark({
  variant = 'compact',
}: {
  variant?: AngxinWordmarkVariant
}): React.ReactNode {
  const font = getFont(variant)
  const gap = getLetterGap(variant)
  const rowCount = font.A.length

  return (
    <Box flexDirection="column" alignItems="center">
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <Text key={rowIndex} bold>
          {WORD.map((char, letterIndex) => (
            <Text
              key={`${char}-${rowIndex}-${letterIndex}`}
              color={BLUE_MACARON_PALETTE[letterIndex]}
              bold
            >
              {font[char][rowIndex]}
              {letterIndex < WORD.length - 1 ? gap : ''}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}
