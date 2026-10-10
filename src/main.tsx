import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ImportarProdutos from './pages/ImportarProdutos.tsx'
import ExtrairAfiliados from './pages/ExtrairAfiliados.tsx'

const caminho = window.location.pathname.replace(/\/$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {caminho === '/importar-produtos'
      ? <ImportarProdutos />
      : caminho === '/extrair-afiliados'
        ? <ExtrairAfiliados />
        : <App />}
  </StrictMode>,
)
