type ObjectValue = Record<string, unknown>

const forbiddenKey = /(?:access.?token|refresh.?token|authorization|cookie|client.?secret|database.?url|password|credential|api.?key|private.?key|email|phone|address|document|first.?name|last.?name|nickname|full.?name|user.?id|seller.?id|cpf|cnpj|birth|postal.?code)/i
const statusFlag = /(?:allow|blocked|restricted|suspended|pending|validation)/i
const consumedKey = /^(?:applications?|consumed_applications|data|results|items|app_id|application_id|http|https|http_status|http_statuses|http_code|http_codes|status_codes?|response_codes?|responses?|requests?|counters?|metrics?|statistics?|counts?|total|quantity|volume|forbidden|(?:http_|status_|count_|total_|requests_)?(?:403|[1-5]xx|[1-5][0-9][0-9])|period|date|date_from|date_to|from|to|start|end|started_at|ended_at|created_at|updated_at|timestamp)$/i
const countKey = /(?:count|total|quantity|volume|requests|responses|forbidden|403|[1-5]xx|[1-5][0-9][0-9])/i
const dateKey = /^(?:period|date|date_from|date_to|from|to|start|end|started_at|ended_at|created_at|updated_at|timestamp)$/i
const actionKey = /^(?:required_action|action|actions|pending_action)$/i
const validationKey = /(?:validat|verif|mandatory|required|kyc|identity)/i
const actionDetailKey = /^(?:required_action|action|actions|pending_action|code|codes|type|status|state|value|allow|required|mandatory|pending|validation|verification)$/i
const applicationFields = ['active', 'status', 'blocked', 'block_reason', 'blocking_reason', 'reason',
  'restriction', 'restrictions', 'policy', 'policies', 'moderation', 'disabled', 'disabled_reason',
  'suspension', 'infractions', 'tags', 'certification_status'] as const
const applicationTerms = ['block', 'reason', 'restrict', 'policy', 'infraction', 'suspend', 'disable', 'moderation'] as const
const applicationSecretKey = /(?:secret|token|auth|cookie|password|credential|database|private|session|api.?key|signature)/i
const applicationCodeKey = /(?:^|_)(?:code|codes|status|state|reason|reasons|restriction|restrictions|policy|policies|moderation|suspension|infraction|infractions|tag|tags|type)(?:$|_)/i
const applicationStatusValue = /^(?:active|inactive|blocked|pending|approved|rejected|suspended|disabled|enabled|certified|not_certified|restricted|none|open|closed|review|under_review)$/i

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

function safeAction(value: unknown, secrets: string[], depth = 0): unknown {
  if (depth > 8) return undefined
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => safeAction(entry, secrets, depth + 1)).filter((entry) => entry !== undefined)
  const source = object(value)
  if (!source) return safeValue(value, secrets, depth)
  const selected: ObjectValue = {}
  for (const [key, entry] of Object.entries(source).slice(0, 100)) {
    if (!actionDetailKey.test(key) || forbiddenKey.test(key)) continue
    const safe = safeAction(entry, secrets, depth + 1)
    if (safe !== undefined) selected[key] = safe
  }
  return Object.keys(selected).length ? selected : undefined
}

function indicatesValidation(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (typeof value === 'string') return validationKey.test(value)
  if (Array.isArray(value)) return value.some((entry) => indicatesValidation(entry, depth + 1))
  const source = object(value)
  return source !== null && Object.entries(source).some(([key, entry]) =>
    validationKey.test(key) || indicatesValidation(entry, depth + 1))
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
  function visit(source: ObjectValue, target: ObjectValue, depth: number, validationContext = false) {
    if (depth > 8) return
    const siblingValidation = validationContext || Object.keys(source).some((key) => validationKey.test(key))
    for (const [key, value] of Object.entries(source)) {
      if (forbiddenKey.test(key) || !/^[a-z0-9_]{1,80}$/i.test(key)) continue
      if (actionKey.test(key) && (key === 'required_action' || siblingValidation || indicatesValidation(value))) {
        const safe = safeAction(value, secrets, depth + 1)
        if (safe !== undefined) target[key] = safe
      } else if (key === 'codes') {
        const safe = safeValue(value, secrets)
        if (safe !== undefined) target[key] = safe
      } else if (typeof value === 'boolean' && statusFlag.test(key)) {
        target[key] = value
      } else if (key !== 'site_status') {
        const child = object(value)
        if (child) {
          const nested: ObjectValue = {}
          visit(child, nested, depth + 1, validationContext || validationKey.test(key))
          if (Object.keys(nested).length) target[key] = nested
        } else if (Array.isArray(value)) {
          const nested = value.slice(0, 100).map((entry) => {
            const item = object(entry)
            if (!item) return undefined
            const selectedItem: ObjectValue = {}
            visit(item, selectedItem, depth + 1, validationContext || validationKey.test(key))
            return Object.keys(selectedItem).length ? selectedItem : undefined
          }).filter((entry) => entry !== undefined)
          if (nested.length) target[key] = nested
        }
      }
    }
  }
  visit(status, selected, 0)
  result.status = selected
  return result
}

export function safeApplicationRestrictions(httpStatus: number, body: unknown, secrets: string[]) {
  const result: ObjectValue = { httpStatus }
  const source = object(body)
  if (!source) return result

  const safeKey = (key: string) => /^[a-z0-9_]{1,80}$/i.test(key) &&
    !forbiddenKey.test(key) && !applicationSecretKey.test(key)
  const entries = (value: ObjectValue) => Object.entries(value).filter(([key]) => safeKey(key))
  result.topLevelKeys = entries(source).map(([key]) => key)

  const matchingKeys: ObjectValue = Object.fromEntries(applicationTerms.map((term) => [term, []]))
  function findKeys(value: unknown, path: string[], depth: number) {
    if (depth > 8) return
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 100)) findKeys(item, path, depth + 1)
      return
    }
    const node = object(value)
    if (!node) return
    for (const [key, child] of entries(node).slice(0, 100)) {
      const childPath = [...path, key]
      for (const term of applicationTerms) {
        const paths = matchingKeys[term] as string[]
        if (key.toLowerCase().includes(term) && paths.length < 100) {
          const label = childPath.join('.')
          if (!paths.includes(label)) paths.push(label)
        }
      }
      findKeys(child, childPath, depth + 1)
    }
  }
  findKeys(source, [], 0)
  result.matchingKeys = matchingKeys

  function summarize(value: unknown, key: string, depth = 0): unknown {
    if (depth > 8) return undefined
    if (typeof value === 'boolean' || value === null) return value
    if (typeof value === 'number') return /(?:^|_)(?:code|status|reason)(?:$|_)/i.test(key) &&
      Number.isFinite(value) ? value : undefined
    if (typeof value === 'string') {
      if (!applicationCodeKey.test(key)) return undefined
      const safe = safeString(value, secrets)
      if (!safe || safe.includes('[REDACTED]')) return undefined
      return /^[A-Z][A-Z0-9_-]{0,79}$/.test(safe) || applicationStatusValue.test(safe) ? safe : undefined
    }
    if (Array.isArray(value)) return value.slice(0, 100)
      .map((item) => summarize(item, key, depth + 1)).filter((item) => item !== undefined)
    const node = object(value)
    if (!node) return undefined
    const selected: ObjectValue = { keys: entries(node).map(([name]) => name) }
    for (const [name, child] of entries(node).slice(0, 100)) {
      const safe = summarize(child, name, depth + 1)
      if (safe !== undefined) selected[name] = safe
    }
    return selected
  }
  for (const field of applicationFields) {
    if (!Object.hasOwn(source, field)) continue
    const safe = summarize(source[field], field)
    if (safe !== undefined) result[field] = safe
  }
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
