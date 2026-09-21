import {
  Boxes,
  ClipboardList,
  Factory,
  LayoutGrid,
  Package,
  Plug,
  Settings,
  ShoppingCart,
  Tag,
  Truck,
  Users,
  BookOpen,
  BadgeDollarSign,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  papel?: Array<'admin' | 'compras' | 'producao' | 'leitura'>
}
export interface NavGroup {
  label?: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  { items: [{ to: '/painel', label: 'Painel', icon: LayoutGrid }] },
  {
    label: 'Produção',
    items: [
      { to: '/producao/linha-de-hoje', label: 'Linha de hoje', icon: Factory },
      { to: '/producao/etiquetas', label: 'Etiquetas', icon: Tag },
      { to: '/producao/apontamentos', label: 'Apontamentos', icon: ClipboardList },
    ],
  },
  {
    label: 'Suprimentos',
    items: [
      { to: '/estoque', label: 'Estoque de insumos', icon: Boxes },
      { to: '/compras/necessidade', label: 'Necessidade de compra', icon: ShoppingCart },
      { to: '/compras/ordens', label: 'Ordens de compra', icon: Package },
      { to: '/recebimento', label: 'Recebimento de NF-e', icon: Truck },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { to: '/cadastros/produtos', label: 'Produtos', icon: Package },
      { to: '/cadastros/fichas', label: 'Fichas técnicas', icon: BookOpen },
      { to: '/cadastros/insumos', label: 'Insumos', icon: Boxes },
      { to: '/cadastros/fornecedores', label: 'Fornecedores', icon: Users },
    ],
  },
  {
    label: 'Comercial',
    items: [{ to: '/precificacao', label: 'Precificação por canal', icon: BadgeDollarSign }],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/conectores', label: 'Conectores', icon: Plug },
      { to: '/configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
]
