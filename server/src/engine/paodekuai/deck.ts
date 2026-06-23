import type { Card } from './card'
import { makeFullDeck } from './card'

type CardWithId = Card & { id: string }

export function shuffle(deck: CardWithId[], rng: () => number): CardWithId[] {
  const out = [...deck]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!; out[i] = out[j]!; out[j] = tmp
  }
  return out
}

export function deal(
  deck: CardWithId[], players: number, perPlayer: number,
): { hands: CardWithId[][]; kitty: CardWithId[] } {
  const hands: CardWithId[][] = Array.from({ length: players }, () => [])
  let idx = 0
  for (let n = 0; n < perPlayer; n++)
    for (let p = 0; p < players; p++) { hands[p]!.push(deck[idx]!); idx++ }
  return { hands, kitty: deck.slice(idx) }
}

export type DeckVariant = 'classic16' | 'classic15'

// classic16：整副 52 张。classic15：去 3 个 2（留黑桃2）、3 个 A（留黑桃A）、
// 1 个方块 K，共 45 张，3 人各 15 发完无 kitty。其余规则不变。
export function makeDeck(variant: DeckVariant): CardWithId[] {
  const full = makeFullDeck()
  if (variant === 'classic16') return full
  return full.filter((c) => {
    if (c.rank === '2' && c.suit !== 'S') return false
    if (c.rank === 'A' && c.suit !== 'S') return false
    if (c.rank === 'K' && c.suit === 'D') return false
    return true
  })
}
