import { lazy, Suspense } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './app/AppShell'
import MobileShell, { ChaoProvider } from './app/MobileShell'
import { ThemeProvider } from './app/theme'
import { StoreProvider } from './domain/store'

const Login = lazy(() => import('./pages/Login'))
const Painel = lazy(() => import('./pages/Painel'))
const LinhaDeHoje = lazy(() => import('./pages/producao/LinhaDeHoje'))
const Etiquetas = lazy(() => import('./pages/producao/Etiquetas'))
const Apontamentos = lazy(() => import('./pages/producao/Apontamentos'))
const Estoque = lazy(() => import('./pages/estoque/Estoque'))
const Necessidade = lazy(() => import('./pages/compras/Necessidade'))
const Ordens = lazy(() => import('./pages/compras/Ordens'))
const OrdemDetalhe = lazy(() => import('./pages/compras/OrdemDetalhe'))
const Recebimento = lazy(() => import('./pages/recebimento/Recebimento'))
const Produtos = lazy(() => import('./pages/cadastros/Produtos'))
const Fichas = lazy(() => import('./pages/cadastros/Fichas'))
const Insumos = lazy(() => import('./pages/cadastros/Insumos'))
const Fornecedores = lazy(() => import('./pages/cadastros/Fornecedores'))
const Conectores = lazy(() => import('./pages/sistema/Conectores'))
const Configuracoes = lazy(() => import('./pages/sistema/Configuracoes'))
const ChaoPin = lazy(() => import('./pages/chao/Pin'))
const ChaoBipe = lazy(() => import('./pages/chao/Bipe'))
const ChaoReceber = lazy(() => import('./pages/chao/Receber'))
const ChaoReceberNfe = lazy(() => import('./pages/chao/ReceberNfe'))
const ChaoInventario = lazy(() => import('./pages/chao/Inventario'))

const Router = import.meta.env.VITE_HASH_ROUTER ? HashRouter : BrowserRouter

function Loading() {
  return <div className="p-8 text-sm text-muted">Carregando…</div>
}

export default function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <Router>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Navigate to="/painel" replace />} />
              <Route path="/login" element={<Login />} />
              <Route element={<AppShell />}>
                <Route path="/painel" element={<Painel />} />
                <Route path="/producao/linha-de-hoje" element={<LinhaDeHoje />} />
                <Route path="/producao/etiquetas" element={<Etiquetas />} />
                <Route path="/producao/apontamentos" element={<Apontamentos />} />
                <Route path="/estoque" element={<Estoque />} />
                <Route path="/compras/necessidade" element={<Necessidade />} />
                <Route path="/compras/ordens" element={<Ordens />} />
                <Route path="/compras/ordens/:id" element={<OrdemDetalhe />} />
                <Route path="/recebimento" element={<Recebimento />} />
                <Route path="/cadastros/produtos" element={<Produtos />} />
                <Route path="/cadastros/fichas" element={<Fichas />} />
                <Route path="/cadastros/insumos" element={<Insumos />} />
                <Route path="/cadastros/fornecedores" element={<Fornecedores />} />
                <Route path="/conectores" element={<Conectores />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
              </Route>
              <Route
                path="/chao"
                element={
                  <ChaoProvider>
                    <ChaoPin />
                  </ChaoProvider>
                }
              />
              <Route
                element={
                  <ChaoProvider>
                    <MobileShell />
                  </ChaoProvider>
                }
              >
                <Route path="/chao/bipe" element={<ChaoBipe />} />
                <Route path="/chao/receber" element={<ChaoReceber />} />
                <Route path="/chao/receber/:chave" element={<ChaoReceberNfe />} />
                <Route path="/chao/inventario" element={<ChaoInventario />} />
              </Route>
              <Route path="*" element={<Navigate to="/painel" replace />} />
            </Routes>
          </Suspense>
        </Router>
      </StoreProvider>
    </ThemeProvider>
  )
}
