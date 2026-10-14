import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { SessaoOperacionalProvider } from './app/SessaoOperacional.tsx'
import Roteador from './app/Roteador.tsx'
import './app/DesignSystem.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessaoOperacionalProvider><Roteador /></SessaoOperacionalProvider>
  </StrictMode>,
)
