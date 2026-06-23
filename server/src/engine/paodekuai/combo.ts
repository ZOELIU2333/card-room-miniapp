import { rankValue, type Card, type Rank } from './card'

export type ComboType = 'SINGLE' | 'PAIR' | 'TRIPLE' | 'TRIPLE_SINGLE' | 'STRAIGHT' | 'BOMB'

export interface Combo {
  type: ComboType
  power: number   // 同型比大小用的主牌力
  length: number  // 张数（顺子比较用）
  cards: Card[]
}

function countByRank(cards: Card[]): Map<Rank, number> {
  const m = new Map<Rank, number>()
  for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1)
  return m
}

function isConsecutive(ranks: Rank[]): boolean {
  if (ranks.includes('2')) return false
  const vals = ranks.map(rankValue).sort((a, b) => a - b)
  for (let i = 1; i < vals.length; i++)
    if (vals[i]! !== vals[i - 1]! + 1) return false
  return true
}

export function identifyCombo(cards: Card[]): Combo | null {
  if (cards.length === 0) return null
  const counts = countByRank(cards)
  const ranks = [...counts.keys()]

  if (cards.length === 4 && counts.size === 1)
    return { type: 'BOMB', power: rankValue(ranks[0]!), length: 4, cards }
  if (cards.length === 1)
    return { type: 'SINGLE', power: rankValue(cards[0]!.rank), length: 1, cards }
  if (cards.length === 2 && counts.size === 1)
    return { type: 'PAIR', power: rankValue(ranks[0]!), length: 2, cards }
  if (cards.length === 3 && counts.size === 1)
    return { type: 'TRIPLE', power: rankValue(ranks[0]!), length: 3, cards }
  if (cards.length === 4 && counts.size === 2) {
    const triple = ranks.find((r) => counts.get(r) === 3)
    const single = ranks.find((r) => counts.get(r) === 1)
    if (triple && single)
      return { type: 'TRIPLE_SINGLE', power: rankValue(triple), length: 4, cards }
    return null
  }
  if (cards.length >= 5 && counts.size === cards.length && isConsecutive(ranks)) {
    const maxVal = Math.max(...ranks.map(rankValue))
    return { type: 'STRAIGHT', power: maxVal, length: cards.length, cards }
  }
  return null
}
