import type { MoveType } from '../../domain/types'
import { Badge } from '../../ui'
import { MOVE_LABEL, MOVE_TONE } from './estoqueShared'

export default function EstoqueMoveBadge({ tipo }: { tipo: MoveType }) {
  return <Badge tone={MOVE_TONE[tipo]}>{MOVE_LABEL[tipo]}</Badge>
}
