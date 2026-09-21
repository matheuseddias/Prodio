import { Check, Copy, CreditCard, Laptop, Mail, Monitor, Moon, Plus, QrCode, Smartphone, Sun, Trash2, UserPlus, WifiOff } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTheme } from '../../app/theme'
import * as mock from '../../domain/mock'
import { useStore } from '../../domain/store'
import { brl, cnpjFmt, dataBR, dataHoraBR, num, relativo } from '../../domain/format'
import type { Device, Location, Member, Operator, Tenant } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Stat, Table, Tabs, Td, Th, Toggle, cx } from '../../ui'

type Aba = 'empresa' | 'producao' | 'usuarios' | 'dispositivos' | 'locais' | 'notificacoes' | 'plano' | 'aparencia'

const uid = () => Math.random().toString(36).slice(2, 10)

const PAPEL_LABEL: Record<Member['papel'], string> = { admin: 'Admin', compras: 'Compras', producao: 'Produção', leitura: 'Leitura', dispositivo: 'Dispositivo' }
const PAPEL_TONE: Record<Member['papel'], 'accent' | 'info' | 'ok' | 'neutral' | 'warn'> = { admin: 'accent', compras: 'info', producao: 'ok', leitura: 'neutral', dispositivo: 'warn' }
const PAPEL_DESC: Record<Member['papel'], string> = {
  admin: 'Tudo, inclusive conectores, cobrança e usuários.',
  compras: 'Insumos, fornecedores, ordens de compra e recebimento de NF-e.',
  producao: 'Linha de hoje, etiquetas, apontamentos e ficha técnica do seu local.',
  leitura: 'Só visualiza relatórios e cadastros (contabilidade, sócio).',
  dispositivo: 'Aparelho do chão de fábrica: só bipa e imprime, sem acesso ao painel.',
}
const LOCAL_TIPO: Record<Location['tipo'], string> = { fabrica: 'Fábrica', terceiro: 'Terceiro', deposito: 'Depósito' }

function SaveBar({ onSave, dirty }: { onSave: () => void; dirty: boolean }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
      {ok && (
        <span className="inline-flex items-center gap-1 text-[13px] text-ok">
          <Check size={14} /> Salvo
        </span>
      )}
      <Button
        variant="primary"
        disabled={!dirty}
        onClick={() => {
          onSave()
          setOk(true)
          window.setTimeout(() => setOk(false), 1500)
        }}
      >
        Salvar alterações
      </Button>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-4 border-b border-border/70 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-6 sm:items-start">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// ---------- Empresa ----------
function AbaEmpresa() {
  const { tenant, setTenant } = useStore()
  const [f, setF] = useState<Tenant>(tenant)
  const [copiado, setCopiado] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(tenant)
  const slug = tenant.nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  const email = `xml@${slug}.prodio.app`
  const copiar = () => {
    try {
      void navigator.clipboard?.writeText(email)
    } catch {
      /* ignore */
    }
    setCopiado(true)
    window.setTimeout(() => setCopiado(false), 1200)
  }
  return (
    <Card title="Empresa">
      <Row label="Nome da empresa">
        <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      </Row>
      <Row label="CNPJ" hint="Um CNPJ por conta. Filiais entram como outra empresa.">
        <Input value={cnpjFmt(f.cnpj)} onChange={(e) => setF({ ...f, cnpj: e.target.value.replace(/\D/g, '').slice(0, 14) })} inputMode="numeric" className="font-mono max-w-xs" />
      </Row>
      <Row label="Regime tributário" hint="Define se o custo do insumo entra com ou sem os impostos recuperáveis.">
        <div className="space-y-3">
          <Select value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value as Tenant['regime'] })} className="max-w-xs">
            <option value="simples">Simples Nacional</option>
            <option value="presumido">Lucro Presumido</option>
            <option value="real">Lucro Real</option>
          </Select>
          <Toggle checked={f.creditaImpostos} onChange={(v) => setF({ ...f, creditaImpostos: v })} label="Credita impostos na compra (ICMS/IPI/PIS/COFINS)" />
          <p className="text-[12px] text-muted">
            A partir de 01/2027 a CBS substitui PIS/COFINS; o Prodio usa os valores destacados no XML por tributo com vigência.
          </p>
        </div>
      </Row>
      <Row label="E-mail de recebimento de XML" hint="Peça aos fornecedores para copiar este endereço no envio da NF-e. O XML entra direto em Recebimento.">
        <div className="flex items-center gap-2">
          <Input readOnly value={email} className="font-mono bg-surface-2" />
          <Button onClick={copiar} className="shrink-0" aria-label="Copiar e-mail">
            {copiado ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
            <span className="hidden sm:inline">{copiado ? 'Copiado' : 'Copiar'}</span>
          </Button>
        </div>
      </Row>
      <SaveBar dirty={dirty} onSave={() => setTenant(f)} />
    </Card>
  )
}

// ---------- Produção ----------
function AbaProducao() {
  const { tenant, setTenant, products } = useStore()
  const [f, setF] = useState<Tenant>(tenant)
  // Estado local: sem campos correspondentes no Tenant
  const [exigirProjecao, setExigirProjecao] = useState(true)
  const [modoEtiqueta, setModoEtiqueta] = useState<'unidade' | 'caixa'>('unidade')
  const [tamanho, setTamanho] = useState('50x30')
  const familias = useMemo(() => Array.from(new Set(products.map((p) => p.familia))), [products])
  const [prefixos, setPrefixos] = useState<Record<string, string>>(() => Object.fromEntries(familias.map((fam) => [fam, fam === 'Espelho' ? 'EH' : 'ED'])))
  const [localDirty, setLocalDirty] = useState(false)
  const dirty = localDirty || JSON.stringify(f) !== JSON.stringify(tenant)
  const touch = () => setLocalDirty(true)

  return (
    <Card title="Produção">
      <Row label="Hora de virada do dia" hint="Bipes antes desta hora contam no dia anterior (turno da madrugada).">
        <Input type="time" value={f.horaVirada} onChange={(e) => setF({ ...f, horaVirada: e.target.value })} className="max-w-[160px]" />
      </Row>
      <Row label="Dias úteis no mês" hint="Usado para converter a venda mensal em demanda diária.">
        <Input type="number" min={1} max={31} value={f.diasUteisMes} onChange={(e) => setF({ ...f, diasUteisMes: Number(e.target.value) })} className="max-w-[160px]" />
      </Row>
      <Row label="Margem de projeção" hint="Percentual acima da média de vendas sugerido na Linha de hoje.">
        <div className="flex items-center gap-2 max-w-[160px]">
          <Input type="number" min={0} max={100} value={Math.round(f.margemProjecao * 100)} onChange={(e) => setF({ ...f, margemProjecao: Number(e.target.value) / 100 })} />
          <span className="text-sm text-muted">%</span>
        </div>
      </Row>
      <Row label="Dias de cobertura" hint="Quantos dias de venda o estoque de insumos deve cobrir para sugerir compra.">
        <Input type="number" min={1} value={f.diasCobertura} onChange={(e) => setF({ ...f, diasCobertura: Number(e.target.value) })} className="max-w-[160px]" />
      </Row>
      <Row label="Exigir projeção do dia para imprimir etiquetas" hint="Evita imprimir sem a encarregada ter confirmado a meta.">
        <Toggle
          checked={exigirProjecao}
          onChange={(v) => {
            setExigirProjecao(v)
            touch()
          }}
          label={exigirProjecao ? 'Exigido' : 'Livre'}
        />
      </Row>
      <Row label="Modo de etiqueta padrão">
        <Select
          value={modoEtiqueta}
          onChange={(e) => {
            setModoEtiqueta(e.target.value as typeof modoEtiqueta)
            touch()
          }}
          className="max-w-xs"
        >
          <option value="unidade">Unidade (1 etiqueta = 1 peça)</option>
          <option value="caixa">Caixa (1 etiqueta = 1 caixa)</option>
        </Select>
      </Row>
      <Row label="Tamanho de etiqueta padrão" hint="Em mm, conforme a impressora térmica.">
        <Select
          value={tamanho}
          onChange={(e) => {
            setTamanho(e.target.value)
            touch()
          }}
          className="max-w-xs"
        >
          <option value="50x30">50 × 30 mm</option>
          <option value="60x40">60 × 40 mm</option>
          <option value="100x50">100 × 50 mm</option>
          <option value="100x150">100 × 150 mm</option>
        </Select>
      </Row>
      <Row label="Prefixo de serial por família" hint="O serial da etiqueta começa com o prefixo da família do produto.">
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-left font-medium">Família</th>
                <th className="px-3 py-2 text-left font-medium">Prefixo</th>
              </tr>
            </thead>
            <tbody>
              {familias.map((fam) => (
                <tr key={fam} className="border-t border-border/70">
                  <td className="px-3 py-2">{fam}</td>
                  <td className="px-3 py-2">
                    <Input
                      value={prefixos[fam] ?? ''}
                      maxLength={3}
                      onChange={(e) => {
                        setPrefixos((p) => ({ ...p, [fam]: e.target.value.toUpperCase() }))
                        touch()
                      }}
                      className="h-9 w-20 font-mono uppercase"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Row>
      <SaveBar
        dirty={dirty}
        onSave={() => {
          setTenant(f)
          setLocalDirty(false)
        }}
      />
    </Card>
  )
}

// ---------- Usuários ----------
function AbaUsuarios() {
  const { members, upsertMember } = useStore()
  const [convite, setConvite] = useState(false)
  const [editando, setEditando] = useState<Member | null>(null)
  const [removendo, setRemovendo] = useState<Member | null>(null)
  const [removidos, setRemovidos] = useState<string[]>([]) // sem ação de remoção no store
  const [form, setForm] = useState<{ email: string; papel: Member['papel']; localId: string }>({ email: '', papel: 'producao', localId: '' })
  const lista = members.filter((m) => !removidos.includes(m.id))
  const local = (id?: string) => mock.locations.find((l) => l.id === id)?.nome

  const convidar = () => {
    upsertMember({ id: uid(), nome: form.email.split('@')[0], email: form.email, papel: form.papel, localId: form.localId || undefined })
    setConvite(false)
    setForm({ email: '', papel: 'producao', localId: '' })
  }

  return (
    <div className="space-y-5">
      <Card
        title="Usuários"
        actions={
          <Button variant="primary" size="sm" onClick={() => setConvite(true)}>
            <UserPlus size={14} /> Convidar por e-mail
          </Button>
        }
      >
        <Table>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th>Papel</Th>
              <Th>Local</Th>
              <Th>Último acesso</Th>
              <Th right />
            </tr>
          </thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">{m.nome}</Td>
                <Td className="text-muted">{m.email ?? '—'}</Td>
                <Td>
                  <Badge tone={PAPEL_TONE[m.papel]}>{PAPEL_LABEL[m.papel]}</Badge>
                </Td>
                <Td className="text-muted">{local(m.localId) ?? 'Todos'}</Td>
                <Td className="text-muted whitespace-nowrap">{m.ultimoAcesso ? relativo(m.ultimoAcesso) : 'Convite pendente'}</Td>
                <Td right>
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditando(m)}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemovendo(m)} aria-label="Remover">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Papéis">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PAPEL_DESC) as Member['papel'][]).map((p) => (
            <div key={p} className="rounded-lg border border-border p-3">
              <Badge tone={PAPEL_TONE[p]}>{PAPEL_LABEL[p]}</Badge>
              <p className="mt-2 text-[13px] text-muted">{PAPEL_DESC[p]}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={convite}
        onClose={() => setConvite(false)}
        title="Convidar por e-mail"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConvite(false)}>Cancelar</Button>
            <Button variant="primary" disabled={!/.+@.+\..+/.test(form.email)} onClick={convidar}>
              <Mail size={15} /> Enviar convite
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nome@empresa.com.br" autoFocus />
          </Field>
          <Field label="Papel" hint={PAPEL_DESC[form.papel]}>
            <Select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value as Member['papel'] })}>
              {(Object.keys(PAPEL_LABEL) as Member['papel'][]).map((p) => (
                <option key={p} value={p}>
                  {PAPEL_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Local" hint="Restringe o que a pessoa vê à unidade escolhida.">
            <Select value={form.localId} onChange={(e) => setForm({ ...form, localId: e.target.value })}>
              <option value="">Todos os locais</option>
              {mock.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      {editando && (
        <Modal
          open
          onClose={() => setEditando(null)}
          title={`Editar ${editando.nome}`}
          size="sm"
          footer={
            <>
              <Button onClick={() => setEditando(null)}>Cancelar</Button>
              <Button
                variant="primary"
                onClick={() => {
                  upsertMember(editando)
                  setEditando(null)
                }}
              >
                Salvar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Papel" hint={PAPEL_DESC[editando.papel]}>
              <Select value={editando.papel} onChange={(e) => setEditando({ ...editando, papel: e.target.value as Member['papel'] })}>
                {(Object.keys(PAPEL_LABEL) as Member['papel'][]).map((p) => (
                  <option key={p} value={p}>
                    {PAPEL_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Local">
              <Select value={editando.localId ?? ''} onChange={(e) => setEditando({ ...editando, localId: e.target.value || undefined })}>
                <option value="">Todos os locais</option>
                {mock.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Modal>
      )}

      {removendo && (
        <Modal
          open
          onClose={() => setRemovendo(null)}
          title="Remover usuário"
          size="sm"
          footer={
            <>
              <Button onClick={() => setRemovendo(null)}>Cancelar</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setRemovidos((r) => [...r, removendo.id])
                  setRemovendo(null)
                }}
              >
                Remover
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <strong>{removendo.nome}</strong> perde o acesso imediatamente. Os apontamentos e ações registrados por essa pessoa continuam no histórico.
          </p>
        </Modal>
      )}
    </div>
  )
}

// ---------- Dispositivos e operadores ----------
function AbaDispositivos() {
  const { devices, upsertDevice } = useStore()
  const [registrar, setRegistrar] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [novo, setNovo] = useState<{ nome: string; localId: string }>({ nome: '', localId: 'l1' })
  const [revogados, setRevogados] = useState<string[]>([]) // sem ação de remoção no store
  const [revogando, setRevogando] = useState<Device | null>(null)
  const [operadores, setOperadores] = useState<Operator[]>(mock.operators) // sem operadores no store
  const [pinDe, setPinDe] = useState<Operator | null>(null)
  const [pin, setPin] = useState('')
  const [novoOp, setNovoOp] = useState<{ nome: string; pin: string } | null>(null)
  const local = (id: string) => mock.locations.find((l) => l.id === id)?.nome ?? id
  const lista = devices.filter((d) => !revogados.includes(d.id))

  const abrirRegistro = () => {
    setCodigo(String(Math.floor(1000 + Math.random() * 9000)))
    setNovo({ nome: '', localId: 'l1' })
    setRegistrar(true)
  }
  const concluirRegistro = () => {
    upsertDevice({ id: uid(), nome: novo.nome || `Aparelho ${codigo}`, localId: novo.localId, registradoEm: new Date().toISOString(), pendentesOffline: 0 })
    setRegistrar(false)
  }

  return (
    <div className="space-y-5">
      <Card
        title="Dispositivos"
        actions={
          <Button variant="primary" size="sm" onClick={abrirRegistro}>
            <Smartphone size={14} /> Registrar dispositivo
          </Button>
        }
      >
        {lista.length === 0 ? (
          <EmptyState title="Nenhum dispositivo" description="Registre o celular ou tablet que vai bipar na linha." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Local</Th>
                <Th>Registrado em</Th>
                <Th>Último bipe</Th>
                <Th>Offline</Th>
                <Th right />
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium">{d.nome}</Td>
                  <Td className="text-muted">{local(d.localId)}</Td>
                  <Td className="text-muted whitespace-nowrap">{dataBR(d.registradoEm)}</Td>
                  <Td className="text-muted whitespace-nowrap">{d.ultimoBipe ? relativo(d.ultimoBipe) : '—'}</Td>
                  <Td>
                    {d.pendentesOffline > 0 ? (
                      <Badge tone="warn">
                        <WifiOff size={12} /> {d.pendentesOffline} pendentes
                      </Badge>
                    ) : (
                      <Badge tone="ok">sincronizado</Badge>
                    )}
                  </Td>
                  <Td right>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevogando(d)}>
                      Revogar
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card
        title="Operadores"
        actions={
          <Button size="sm" onClick={() => setNovoOp({ nome: '', pin: '' })}>
            <Plus size={14} /> Novo operador
          </Button>
        }
      >
        <p className="mb-3 text-[13px] text-muted">Quem bipa se identifica pelo PIN no aparelho. O PIN é só para atribuir o apontamento, não dá acesso ao painel.</p>
        <ul className="divide-y divide-border/70">
          {operadores.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-muted">{o.nome.slice(0, 2).toUpperCase()}</span>
                <span className="truncate font-medium">{o.nome}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm tracking-[0.3em] text-muted">••••</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPinDe(o)
                    setPin('')
                  }}
                >
                  Redefinir PIN
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={registrar}
        onClose={() => setRegistrar(false)}
        title="Registrar dispositivo"
        size="sm"
        footer={
          <>
            <Button onClick={() => setRegistrar(false)}>Cancelar</Button>
            <Button variant="primary" onClick={concluirRegistro}>
              Concluir pareamento
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-5 text-center">
            <QrCode size={40} className="mx-auto text-faint" />
            <div className="mt-3 font-mono text-2xl font-semibold tracking-wider">PRODIO-PAIR-{codigo}</div>
            <p className="mt-2 text-[13px] text-muted">
              Abra <span className="font-mono">/chao</span> neste aparelho e leia o código. Ele expira em 10 minutos.
            </p>
          </div>
          <Field label="Nome do aparelho">
            <Input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex.: Celular linha 3" />
          </Field>
          <Field label="Local">
            <Select value={novo.localId} onChange={(e) => setNovo({ ...novo, localId: e.target.value })}>
              {mock.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      {revogando && (
        <Modal
          open
          onClose={() => setRevogando(null)}
          title="Revogar dispositivo"
          size="sm"
          footer={
            <>
              <Button onClick={() => setRevogando(null)}>Cancelar</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setRevogados((r) => [...r, revogando.id])
                  setRevogando(null)
                }}
              >
                Revogar
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <strong>{revogando.nome}</strong> deixa de bipar na hora.
            {revogando.pendentesOffline > 0 && (
              <span className="text-warn"> Há {revogando.pendentesOffline} bipes offline que ainda não subiram e serão perdidos.</span>
            )}
          </p>
        </Modal>
      )}

      {pinDe && (
        <Modal
          open
          onClose={() => setPinDe(null)}
          title={`Redefinir PIN de ${pinDe.nome}`}
          size="sm"
          footer={
            <>
              <Button onClick={() => setPinDe(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={pin.length !== 4}
                onClick={() => {
                  setOperadores((l) => l.map((o) => (o.id === pinDe.id ? { ...o, pin } : o)))
                  setPinDe(null)
                }}
              >
                Salvar PIN
              </Button>
            </>
          }
        >
          <Field label="Novo PIN (4 dígitos)">
            <Input value={pin} inputMode="numeric" maxLength={4} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} className="max-w-[140px] text-center font-mono text-lg tracking-[0.4em]" autoFocus />
          </Field>
        </Modal>
      )}

      {novoOp && (
        <Modal
          open
          onClose={() => setNovoOp(null)}
          title="Novo operador"
          size="sm"
          footer={
            <>
              <Button onClick={() => setNovoOp(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={!novoOp.nome.trim() || novoOp.pin.length !== 4}
                onClick={() => {
                  setOperadores((l) => [...l, { id: uid(), nome: novoOp.nome.trim(), pin: novoOp.pin }])
                  setNovoOp(null)
                }}
              >
                Criar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Nome">
              <Input value={novoOp.nome} onChange={(e) => setNovoOp({ ...novoOp, nome: e.target.value })} autoFocus />
            </Field>
            <Field label="PIN (4 dígitos)">
              <Input value={novoOp.pin} inputMode="numeric" maxLength={4} onChange={(e) => setNovoOp({ ...novoOp, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} className="max-w-[140px] text-center font-mono text-lg tracking-[0.4em]" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ---------- Locais ----------
function AbaLocais() {
  const [locais, setLocais] = useState<Location[]>(mock.locations) // sem locais no store
  const [edit, setEdit] = useState<Location | null>(null)
  const { devices, members } = useStore()
  return (
    <>
      <Card
        title="Locais"
        actions={
          <Button variant="primary" size="sm" onClick={() => setEdit({ id: '', nome: '', tipo: 'fabrica' })}>
            <Plus size={14} /> Adicionar local
          </Button>
        }
      >
        <p className="mb-3 text-[13px] text-muted">Fábricas próprias, terceiros que produzem para você e depósitos. Dispositivos e usuários de produção ficam presos a um local.</p>
        <ul className="divide-y divide-border/70">
          {locais.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{l.nome}</span>
                  <Badge tone={l.tipo === 'fabrica' ? 'accent' : l.tipo === 'terceiro' ? 'info' : 'neutral'}>{LOCAL_TIPO[l.tipo]}</Badge>
                </div>
                <div className="text-[12px] text-muted">
                  {devices.filter((d) => d.localId === l.id).length} dispositivos · {members.filter((m) => m.localId === l.id).length} usuários
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEdit(l)}>
                Editar
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? 'Editar local' : 'Novo local'}
          size="sm"
          footer={
            <>
              <Button onClick={() => setEdit(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={!edit.nome.trim()}
                onClick={() => {
                  const item = { ...edit, id: edit.id || uid() }
                  setLocais((ls) => (ls.some((x) => x.id === item.id) ? ls.map((x) => (x.id === item.id ? item : x)) : [...ls, item]))
                  setEdit(null)
                }}
              >
                Salvar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Nome">
              <Input value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} autoFocus />
            </Field>
            <Field label="Tipo">
              <Select value={edit.tipo} onChange={(e) => setEdit({ ...edit, tipo: e.target.value as Location['tipo'] })}>
                <option value="fabrica">Fábrica</option>
                <option value="terceiro">Terceiro</option>
                <option value="deposito">Depósito</option>
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}

// ---------- Notificações ----------
const EVENTOS = [
  { id: 'minimo', label: 'Insumo cruzou o mínimo' },
  { id: 'oc_atrasada', label: 'OC atrasada' },
  { id: 'nfe', label: 'NF-e sem De-Para' },
  { id: 'outbox', label: 'Outbox com erro' },
  { id: 'auditor', label: 'Divergência do auditor' },
] as const
const CANAIS = [
  { id: 'email', label: 'E-mail', ativo: true },
  { id: 'chat', label: 'Google Chat', ativo: true },
  { id: 'whatsapp', label: 'WhatsApp', ativo: false },
] as const

function AbaNotificacoes() {
  const [m, setM] = useState<Record<string, boolean>>({ 'minimo.email': true, 'oc_atrasada.email': true, 'nfe.email': true, 'outbox.email': true, 'outbox.chat': true, 'auditor.chat': true })
  const [webhook, setWebhook] = useState('https://chat.googleapis.com/v1/spaces/AAAA…/messages?key=…')
  const [dirty, setDirty] = useState(false)
  const toggle = (k: string, v: boolean) => {
    setM((s) => ({ ...s, [k]: v }))
    setDirty(true)
  }
  return (
    <Card title="Notificações">
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-[12px] uppercase tracking-wide text-muted">
              <th className="py-2 text-left font-medium">Evento</th>
              {CANAIS.map((c) => (
                <th key={c.id} className="py-2 text-center font-medium">
                  {c.label}
                  {!c.ativo && (
                    <Badge tone="neutral" className="ml-1.5 normal-case tracking-normal">
                      em breve
                    </Badge>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EVENTOS.map((ev) => (
              <tr key={ev.id} className="border-t border-border/70">
                <td className="py-3 pr-3">{ev.label}</td>
                {CANAIS.map((c) => {
                  const k = `${ev.id}.${c.id}`
                  return (
                    <td key={c.id} className="py-3 text-center">
                      <span className={cx('inline-flex', !c.ativo && 'opacity-40 pointer-events-none')}>
                        <Toggle checked={!!m[k]} onChange={(v) => toggle(k, v)} />
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5">
        <Field label="URL do webhook do Google Chat" hint="Crie um webhook de entrada no espaço do Google Chat e cole a URL aqui.">
          <Input
            value={webhook}
            onChange={(e) => {
              setWebhook(e.target.value)
              setDirty(true)
            }}
            className="font-mono"
          />
        </Field>
      </div>
      <SaveBar dirty={dirty} onSave={() => setDirty(false)} />
    </Card>
  )
}

// ---------- Plano e cobrança ----------
function AbaPlano() {
  const { labels, connectors, devices } = useStore()
  const [alterar, setAlterar] = useState(false)
  const conectados = connectors.filter((c) => c.status === 'conectado').length
  const faturas = useMemo(() => {
    const out: { id: string; competencia: string; valor: number; status: 'paga' | 'aberta' }[] = []
    for (let i = 0; i < 4; i++) {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - i)
      out.push({ id: `F${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`, competencia: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), valor: 349, status: i === 0 ? 'aberta' : 'paga' })
    }
    return out
  }, [])
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] uppercase tracking-wide text-muted">Plano atual</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">Fábrica</div>
              <div className="mt-1 text-sm text-muted">
                <span className="text-lg font-semibold text-text">{brl(349)}</span> /mês por CNPJ
              </div>
            </div>
            <Badge tone="ok">Ativo</Badge>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {['Bipadores e dispositivos ilimitados', 'Todos os conectores inclusos', 'Etiquetas e apontamentos sem limite', 'Recebimento de NF-e por e-mail e XML', 'Suporte por WhatsApp em horário comercial'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check size={15} className="text-ok shrink-0" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setAlterar(true)}>
              Alterar plano
            </Button>
            <Button>
              <CreditCard size={15} /> Forma de pagamento
            </Button>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 content-start">
          <Stat label="Etiquetas impressas no mês" value={num(labels.length)} />
          <Stat label="Conectores ativos" value={conectados} hint={`de ${connectors.length} disponíveis`} />
          <Stat label="Dispositivos" value={devices.length} hint="ilimitados" />
          <Stat label="Próxima cobrança" value={dataBR(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 5).toISOString())} />
        </div>
      </div>

      <Card title="Faturas">
        <Table>
          <thead>
            <tr>
              <Th>Nº</Th>
              <Th>Competência</Th>
              <Th right>Valor</Th>
              <Th>Status</Th>
              <Th right />
            </tr>
          </thead>
          <tbody>
            {faturas.map((f) => (
              <tr key={f.id}>
                <Td mono>{f.id}</Td>
                <Td className="capitalize">{f.competencia}</Td>
                <Td right>{brl(f.valor)}</Td>
                <Td>{f.status === 'paga' ? <Badge tone="ok">paga</Badge> : <Badge tone="warn">em aberto</Badge>}</Td>
                <Td right>
                  <Button size="sm" variant="ghost">
                    {f.status === 'paga' ? 'Recibo' : 'Pagar'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Modal open={alterar} onClose={() => setAlterar(false)} title="Alterar plano" footer={<Button onClick={() => setAlterar(false)}>Fechar</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { nome: 'Fábrica', preco: 349, d: '1 CNPJ, tudo incluso.', atual: true },
            { nome: 'Grupo', preco: 899, d: 'Até 4 CNPJs, consolidação de compras entre empresas.', atual: false },
          ].map((p) => (
            <div key={p.nome} className={cx('rounded-lg border p-4', p.atual ? 'border-accent bg-accent-soft/30' : 'border-border')}>
              <div className="flex items-center justify-between">
                <div className="font-semibold">{p.nome}</div>
                {p.atual && <Badge tone="accent">atual</Badge>}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {brl(p.preco)} <span className="text-sm font-normal text-muted">/mês</span>
              </div>
              <p className="mt-1 text-[13px] text-muted">{p.d}</p>
              <Button size="sm" className="mt-3 w-full" disabled={p.atual} variant={p.atual ? 'secondary' : 'primary'}>
                {p.atual ? 'Plano atual' : 'Falar com o time'}
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

// ---------- Aparência ----------
function AbaAparencia() {
  const { theme, setTheme } = useTheme()
  const [densidade, setDensidade] = useState<'confortavel' | 'compacta'>('confortavel')
  const temas = [
    { id: 'system', label: 'Sistema', icon: Monitor },
    { id: 'light', label: 'Claro', icon: Sun },
    { id: 'dark', label: 'Escuro', icon: Moon },
  ] as const
  return (
    <Card title="Aparência">
      <Row label="Tema" hint="Sistema segue a preferência do aparelho.">
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {temas.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={cx('flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors', theme === t.id ? 'border-accent bg-accent-soft/40 font-medium' : 'border-border hover:bg-surface-2')}
            >
              <t.icon size={18} />
              {t.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Densidade" hint="Compacta mostra mais linhas por tela nas tabelas.">
        <div className="grid grid-cols-2 gap-2 max-w-md">
          {(
            [
              { id: 'confortavel', label: 'Confortável' },
              { id: 'compacta', label: 'Compacta' },
            ] as const
          ).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDensidade(d.id)}
              className={cx('rounded-lg border p-3 text-sm transition-colors', densidade === d.id ? 'border-accent bg-accent-soft/40 font-medium' : 'border-border hover:bg-surface-2')}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Idioma">
        <Select value="pt-BR" disabled className="max-w-xs">
          <option value="pt-BR">Português (Brasil)</option>
        </Select>
      </Row>
      <p className="mt-3 text-[12px] text-faint inline-flex items-center gap-1">
        <Laptop size={12} /> Preferências de aparência ficam neste navegador. Último acesso {dataHoraBR(new Date().toISOString())}.
      </p>
    </Card>
  )
}

// ---------- Página ----------
export default function Configuracoes() {
  const [aba, setAba] = useState<Aba>('empresa')
  return (
    <>
      <PageHeader title="Configurações" subtitle="Empresa, produção, pessoas, aparelhos e cobrança." />
      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'empresa', label: 'Empresa' },
          { id: 'producao', label: 'Produção' },
          { id: 'usuarios', label: 'Usuários' },
          { id: 'dispositivos', label: 'Dispositivos e operadores' },
          { id: 'locais', label: 'Locais' },
          { id: 'notificacoes', label: 'Notificações' },
          { id: 'plano', label: 'Plano e cobrança' },
          { id: 'aparencia', label: 'Aparência' },
        ]}
      />
      {aba === 'empresa' && <AbaEmpresa />}
      {aba === 'producao' && <AbaProducao />}
      {aba === 'usuarios' && <AbaUsuarios />}
      {aba === 'dispositivos' && <AbaDispositivos />}
      {aba === 'locais' && <AbaLocais />}
      {aba === 'notificacoes' && <AbaNotificacoes />}
      {aba === 'plano' && <AbaPlano />}
      {aba === 'aparencia' && <AbaAparencia />}
    </>
  )
}
