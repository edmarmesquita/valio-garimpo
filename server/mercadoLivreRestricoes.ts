type ObjectValue = Record<string, unknown>

const forbiddenKey = /(?:access.?token|refresh.?token|authorization|cookie|client.?secret|database.?url|password|credential|api.?key|private.?key|email|phone|address|document|first.?name|last.?name|nickname|full.?name|user.?id|seller.?id|cpf|cnpj|birth|postal.?code)/i
const statusFlag = /(?:allow|blocked|restricted|suspended|pending|validation)/i
const consumedKey = /^(?:applications?|consumed_applications|data|results|items|app_id|application_id|http|https|http_status|http_statuses|http_code|http_codes|status_codes?|response_codes?|responses?|requests?|counters?|metrics?|statistics?|counts?|total|quantity|volume|forbidden|(?:http_|status_|count_|total_|requests_)?(?:403|[1-5]xx|[1-5][0-9][0-9])|period|date|date_from|date_to|from|to|start|end|started_at|ended_at|created_at|updated_at|timestamp)$/i
const countKey = /(?:count|total|quantity|volume|requests|responses|forbidden|403|[1-5]xx|[1-5][0-9][0-9])/i
const dateKey = /^(?:period|date|date_from|date_to|from|to|start|end|started_at|ended_at|created_at|updated_at|timestamp)$/i

function object(value: unknown): ObjectValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null
}

function safeString(value: string, secrets: string[]): string | undefined {
  let safe = value
  for (const secret of secrets) if (secret) safe = safe.split(secret).join('[REDACTED]')
  safe = safe.replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
  if (safe.length > 200 || /(?:access.?token|refresh.?token|authorization|cookie|client.?secret|database.?url|password|credential|api.?key|private.?key)|https?:\/\/|@|[A-Za-z0-9+/_=-]{40,}/i.test(safe)) return undefined
  return safe
}

function safeValue(value: unknown, secrets: string[], depth = 0): unknown {
  if (depth > 8) return undefined
  if (typeof value === 'boolean' || value === null) return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return safeString(value, secrets)
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => safeValue(entry, secrets, depth + 1)).filter((entry) => entry !== undefined)
  const source = object(value)
  if (!source) return undefined
  const result: ObjectValue = {}
  for (const [key, entry] of Object.entries(source).slice(0, 100)) {
    if (!/^[a-z0-9_]{1,80}$/i.test(key) || forbiddenKey.test(key)) continue
    const safe = safeValue(entry, secrets, depth + 1)
    if (safe !== undefined) result[key] = safe
  }
  return result
}

export function safeProviderError(httpStatus: number | null, body: unknown, secrets: string[]) {
  const result: ObjectValue = { httpStatus }
  const source = object(body)
  if (!source) return result
  for (const key of ['error', 'code', 'message', 'status', 'blocked_by']) {
    const value = source[key]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && value !== null) continue
    const safe = safeValue(value, secrets)
    if (safe !== undefined) result[key] = safe
  }
  return result
}

export function safeUserRestrictions(httpStatus: number, body: unknown, secrets: string[]) {
  const result: ObjectValue = { httpStatus }
  const status = object(object(body)?.status)
  if (!status) return result
  const selected: ObjectValue = {}
  if (Object.hasOwn(status, 'site_status')) {
    const value = safeValue(status.site_status, secrets)
    if (value !== undefined) selected.site_status = value
  }
  const list = object(status.list)
  if (list) {
    const safeList: ObjectValue = {}
    for (const key of ['allow', 'codes']) {
      if (!Object.hasOwn(list, key)) continue
      const value = safeValue(list[key], secrets)
      if (value !== undefined) safeList[key] = value
    }
    if (Object.keys(safeList).length) selected.list = safeList
  }
  function visit(source: ObjectValue, target: ObjectValue, depth: number) {
    if (depth > 8) return
    for (const [key, value] of Object.entries(source)) {
      if (forbiddenKey.test(key) || !/^[a-z0-9_]{1,80}$/i.test(key)) continue
      if (key === 'codes') {
        const safe = safeValue(value, secrets)
        if (safe !== undefined) target[key] = safe
      } else if (typeof value === 'boolean' && statusFlag.test(key)) {
        target[key] = value
      } else if (key !== 'site_status') {
        const child = object(value)
        if (!child) continue
        const nested: ObjectValue = {}
        visit(child, nested, depth + 1)
        if (Object.keys(nested).length) target[key] = nested
      }
    }
  }
  visit(status, selected, 0)
  result.status = selected
  return result
}

export function safeConsumedApplications(httpStatus: number, body: unknown, secrets: string[]) {
  const result: ObjectValue = { httpStatus }
  function pick(value: unknown, key = '', depth = 0): unknown {
    if (depth > 8) return undefined
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => pick(item, key, depth + 1)).filter((item) => item !== undefined)
    const source = object(value)
    if (source) {
      const selected: ObjectValue = {}
      for (const [name, entry] of Object.entries(source).slice(0, 100)) {
        if (forbiddenKey.test(name) || !consumedKey.test(name)) continue
        const safe = pick(entry, name, depth + 1)
        if (safe !== undefined) selected[name] = safe
      }
      return Object.keys(selected).length ? selected : undefined
    }
    if ((key === 'app_id' || key === 'application_id') && (typeof value === 'number' || typeof value === 'string')) return safeValue(value, secrets)
    if (typeof value === 'number' && countKey.test(key) && Number.isFinite(value)) return value
    if (typeof value === 'string' && dateKey.test(key)) return safeString(value, secrets)
    return undefined
  }
  const selected = pick(body)
  if (Array.isArray(selected)) result.applications = selected
  else if (selected && typeof selected === 'object') Object.assign(result, selected)
  return result
}
