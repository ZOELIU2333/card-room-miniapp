// 引擎一步产出：新状态 + 本步事件。纯函数，无 IO。
export interface StepResult<S, E> {
  state: S
  events: E[]
}

// 名次条目。score 含义由各玩法定义（如跑得快=负的剩牌数、麻将=番数），
// 房间/持久层只负责落库，不解释含义。
export interface RankEntry {
  playerId: string
  rank: number   // 1 为冠军
  score: number
}

/**
 * 所有牌类玩法引擎实现的契约。S/A/E 由各玩法自定义。
 *
 * 约定：
 * - step 是纯函数，不得触碰网络/存储/时间/随机。随机性只能经
 *   createInitialState 注入的 rng 进入。
 * - 动作类型 A 允许包含一种"系统/超时"动作（由房间层计时器触发），
 *   用于表达"等待外部响应窗口"（如麻将碰杠胡）。跑得快暂不使用，
 *   但契约据此约定，未来玩法无需改签名。
 * - 服务端权威：客户端只发意图，合法性与结果一律由 step 判定。
 */
export interface GameEngine<S, A, E, V = unknown> {
  readonly kind: string
  createInitialState(playerIds: string[], rng: () => number, variant: V): S
  step(state: S, action: A): StepResult<S, E>
  isFinished(state: S): boolean
  ranking(state: S): RankEntry[]
}
