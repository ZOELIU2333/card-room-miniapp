export type Rank =
  | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2'
export type Suit = 'C' | 'D' | 'H' | 'S'

export interface Card { rank: Rank; suit: Suit }

const RANK_ORDER: Rank[] = ['3','4','5','6','7','8','9','10','J','Q','K','A','2']

export function rankValue(rank: Rank): number {
  return RANK_ORDER.indexOf(rank)
}

export function cardId(card: Card): string {
  return `${card.suit}${card.rank}`
}

export function makeFullDeck(): Array<Card & { id: string }> {
  const suits: Suit[] = ['C', 'D', 'H', 'S']
  const deck: Array<Card & { id: string }> = []
  for (const suit of suits)
    for (const rank of RANK_ORDER)
      deck.push({ rank, suit, id: `${suit}${rank}` })
  return deck
}
