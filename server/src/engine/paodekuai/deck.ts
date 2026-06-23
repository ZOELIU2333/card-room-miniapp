import type { Card } from './card'

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
