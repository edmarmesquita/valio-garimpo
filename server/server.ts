import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import OpenAI from 'openai'
import mercadoLivreAuth from './mercadoLivreAuth.js'

const app = express()

app.use(cors())
app.use(express.json())
app.use('/api/mercadolivre', mercadoLivreAuth)

app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        message: 'Valiô Garimpo API funcionando!',
    })
})

app.get('/api/garimpo/status', (_req, res) => {
    res.json({
        ok: true,
        garimpo: 'Valiô Garimpo',
        status: 'pronto',
    })
})

app.post('/api/garimpo/teste-ia', async (_req, res) => {
    if (!process.env.OPENAI_API_KEY) {
        res.status(503).json({
            ok: false,
            error: 'A integração com a OpenAI não está configurada.',
        })
        return
    }

    try {
        const openai = new OpenAI({ timeout: 30_000, maxRetries: 0 })
        const response = await openai.responses.create({
            model: 'gpt-4.1-mini',
            input: 'Responda apenas: Valiô Garimpo conectado à OpenAI com sucesso.',
        })

        if (!response.output_text.trim()) {
            res.status(502).json({
                ok: false,
                error: 'A OpenAI não retornou uma resposta de texto.',
            })
            return
        }

        res.json({ ok: true, resposta: response.output_text })
    } catch (error: unknown) {
        const sanitize = (value: unknown) => {
            if (typeof value !== 'string') return undefined

            const apiKey = process.env.OPENAI_API_KEY
            const text = apiKey ? value.split(apiKey).join('[REDACTED]') : value

            return text
                .replace(/sk-[A-Za-z0-9_*.-]+/gi, '[REDACTED]')
                .replace(/Bearer\s+[^\s,"';]+/gi, '[REDACTED]')
                .replace(/(?:authorization|api[_-]?key|token|secret|password)\s*[=:]\s*[^\r\n]+/gi, '[REDACTED]')
        }
        const details = typeof error === 'object' && error !== null
            ? error as Record<string, unknown>
            : {}

        console.error('Falha na integração com a OpenAI:', {
            name: sanitize(details.name),
            status: typeof details.status === 'number' ? details.status : undefined,
            code: sanitize(details.code),
            type: sanitize(details.type),
            message: sanitize(details.message) ?? 'Erro sem mensagem disponível.',
        })

        res.status(502).json({
            ok: false,
            error: 'Não foi possível obter uma resposta da OpenAI. Tente novamente.',
        })
    }
})

export default app
