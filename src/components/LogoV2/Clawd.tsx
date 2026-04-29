import * as React from 'react'
import { AngxinWordmark } from './AngxinWordmark.js'

export type ClawdPose = 'default' | 'arms-up' | 'look-left' | 'look-right'

export function Clawd({
  // Kept for compatibility with AnimatedClawd; the wordmark stays static.
  pose: _pose = 'default',
}: {
  pose?: ClawdPose
} = {}): React.ReactNode {
  return <AngxinWordmark variant="compact" />
}
