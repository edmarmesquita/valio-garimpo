import type { ReactNode } from 'react'
import AcessoVitrine from './AcessoVitrine'
import '../pages/ExtrairAfiliados.css'

export default function AreaOperacional({ titulo, descricao, children }: { titulo: string; descricao: string; children: ReactNode }) {
  return <main className="extrair-afiliados">
    <header><p className="extrair-marca">VALIÔ GARIMPO</p><h1>{titulo}</h1><p>{descricao}</p></header>
    <AcessoVitrine />
    {children}
  </main>
}
