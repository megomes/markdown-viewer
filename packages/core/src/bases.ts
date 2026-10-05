/**
 * Obsidian Bases, read-only: a `.base` file is a query over the notes' properties.
 *
 * This covers what the vault's bases use and the common rest of the language:
 * - filters as an expression or as `and` / `or` / `not` lists of them;
 * - formulas, which may use each other;
 * - `file.*` fields (name, basename, path, folder, ext, tags, links, embeds,
 *   properties) and the note's own properties, bare or as `note.x`;
 * - comparisons, `&&`, `||`, `!`, arithmetic, `[i]` indexing, `if(c, a, b)`,
 *   `file.hasTag()`, `file.inFolder()`, `file.hasLink()`, `file.hasProperty()`
 *   and the string and list methods `contains`, `startsWith`, `endsWith`,
 *   `lower`, `upper`, `length`, `isEmpty`, `join`;
 * - views of type `table` and `cards`, with `order`, `sort`, `groupBy`,
 *   `filters`, `limit` and the cards' `image`.
 *
 * Anything it does not understand evaluates to null instead of failing, so a base
 * using a function from a newer Obsidian still shows its rows.
 */

import { parse as parseYaml } from 'yaml'

export interface BaseFile {
  path: string
  tags: string[]
  /** Resolved vault paths of the note's links and embeds. */
  links: string[]
  embeds: string[]
  properties: Record<string, unknown>
  /** Milliseconds, when the platform could tell. */
  mtime?: number
}

type Filter = string | { and?: Filter[]; or?: Filter[]; not?: Filter[] }

export interface BaseView {
  type: string
  name: string
  filters?: Filter
  order?: string[]
  sort?: { property: string; direction?: 'ASC' | 'DESC' }[]
  groupBy?: { property: string; direction?: 'ASC' | 'DESC' }
  limit?: number
  image?: string
}

export interface BaseConfig {
  filters?: Filter
  formulas: Record<string, string>
  properties: Record<string, { displayName?: string }>
  views: BaseView[]
}

export function parseBase(text: string): BaseConfig {
  const data = (parseYaml(text) ?? {}) as Partial<BaseConfig> & Record<string, unknown>
  const views = Array.isArray(data.views) ? (data.views as BaseView[]) : []
  return {
    ...(data.filters ? { filters: data.filters as Filter } : {}),
    formulas: (data.formulas as Record<string, string>) ?? {},
    properties: (data.properties as BaseConfig['properties']) ?? {},
    views: views.length ? views : [{ type: 'table', name: 'Tabela' }],
  }
}

/* ------------------------------------------------------------------ parser */

type Node =
  | { t: 'lit'; v: unknown }
  | { t: 'id'; name: string }
  | { t: 'member'; obj: Node; name: string }
  | { t: 'index'; obj: Node; index: Node }
  | { t: 'call'; fn: Node; args: Node[] }
  | { t: 'unary'; op: string; arg: Node }
  | { t: 'binary'; op: string; left: Node; right: Node }
  | { t: 'list'; items: Node[] }

const TOKEN =
  /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(==|!=|>=|<=|&&|\|\||[-+*/%<>!()[\],.])|([A-Za-z_À-￿][\wÀ-￿-]*))/y

type Token = { kind: 'num' | 'str' | 'op' | 'id'; value: string }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  TOKEN.lastIndex = 0
  let at = 0
  while (at < source.length) {
    if (/^\s*$/.test(source.slice(at))) break
    TOKEN.lastIndex = at
    const m = TOKEN.exec(source)
    if (!m) throw new Error('Expressão não reconhecida perto de: ' + source.slice(at, at + 12))
    at = TOKEN.lastIndex
    if (m[1] !== undefined) tokens.push({ kind: 'num', value: m[1] })
    else if (m[2] !== undefined) tokens.push({ kind: 'str', value: m[2].replace(/\\(.)/g, '$1') })
    else if (m[3] !== undefined) tokens.push({ kind: 'str', value: m[3].replace(/\\(.)/g, '$1') })
    else if (m[4] !== undefined) tokens.push({ kind: 'op', value: m[4] })
    else tokens.push({ kind: 'id', value: m[5]! })
  }
  return tokens
}

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

export function parseExpression(source: string): Node {
  const tokens = tokenize(source)
  let i = 0
  const peek = () => tokens[i]
  const isOp = (value: string) => peek()?.kind === 'op' && peek()!.value === value
  const expect = (value: string) => {
    if (!isOp(value)) throw new Error(`Esperava "${value}" em: ${source}`)
    i++
  }

  function primary(): Node {
    const token = tokens[i++]
    if (!token) throw new Error('Expressão incompleta: ' + source)
    if (token.kind === 'num') return { t: 'lit', v: Number(token.value) }
    if (token.kind === 'str') return { t: 'lit', v: token.value }
    if (token.kind === 'id') {
      if (token.value === 'true') return { t: 'lit', v: true }
      if (token.value === 'false') return { t: 'lit', v: false }
      if (token.value === 'null') return { t: 'lit', v: null }
      return { t: 'id', name: token.value }
    }
    if (token.value === '(') {
      const inner = expression(0)
      expect(')')
      return inner
    }
    if (token.value === '[') {
      const items: Node[] = []
      while (!isOp(']')) {
        items.push(expression(0))
        if (!isOp(']')) expect(',')
      }
      i++
      return { t: 'list', items }
    }
    if (token.value === '!' || token.value === '-')
      return { t: 'unary', op: token.value, arg: postfix(primary()) }
    throw new Error(`"${token.value}" fora de lugar em: ${source}`)
  }

  function postfix(node: Node): Node {
    for (;;) {
      if (isOp('.')) {
        i++
        const name = tokens[i++]
        if (!name || name.kind !== 'id') throw new Error('Nome esperado depois do ponto: ' + source)
        node = { t: 'member', obj: node, name: name.value }
      } else if (isOp('[')) {
        i++
        const index = expression(0)
        expect(']')
        node = { t: 'index', obj: node, index }
      } else if (isOp('(')) {
        i++
        const args: Node[] = []
        while (!isOp(')')) {
          args.push(expression(0))
          if (!isOp(')')) expect(',')
        }
        i++
        node = { t: 'call', fn: node, args }
      } else return node
    }
  }

  function expression(min: number): Node {
    let left = postfix(primary())
    for (;;) {
      const token = peek()
      const prec = token?.kind === 'op' ? PRECEDENCE[token.value] : undefined
      if (prec === undefined || prec <= min - 1 || prec < min) break
      i++
      const right = expression(prec + 1)
      left = { t: 'binary', op: token!.value, left, right }
    }
    return left
  }

  const node = expression(0)
  if (i < tokens.length) throw new Error('Sobrou texto na expressão: ' + source)
  return node
}

/* --------------------------------------------------------------- evaluator */

interface Row {
  file: BaseFile
  formulas: Record<string, string>
  cache: Map<string, unknown>
  evaluating: Set<string>
}

const parsed = new Map<string, Node | Error>()

function compile(source: string): Node | Error {
  let node = parsed.get(source)
  if (!node) {
    try {
      node = parseExpression(source)
    } catch (error) {
      node = error instanceof Error ? error : new Error(String(error))
    }
    parsed.set(source, node)
  }
  return node
}

function basename(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function fileField(file: BaseFile, name: string): unknown {
  const name_ = file.path.slice(file.path.lastIndexOf('/') + 1)
  switch (name) {
    case 'name':
    case 'basename':
      return basename(file.path)
    case 'fullname':
      return name_
    case 'path':
      return file.path
    case 'folder':
      return file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
    case 'ext':
      return name_.includes('.') ? name_.slice(name_.lastIndexOf('.') + 1) : ''
    case 'tags':
      return file.tags.map((tag) => '#' + tag)
    case 'links':
      return file.links
    case 'embeds':
      return file.embeds
    case 'properties':
      return file.properties
    case 'mtime':
      return file.mtime ?? null
    default:
      return null
  }
}

function property(row: Row, name: string): unknown {
  if (name.startsWith('formula.')) return formula(row, name.slice('formula.'.length))
  if (name.startsWith('file.')) return fileField(row.file, name.slice('file.'.length))
  if (name.startsWith('note.')) return row.file.properties[name.slice('note.'.length)] ?? null
  return row.file.properties[name] ?? null
}

/** A column, sort key or image: a property name, or an expression such as `file.embeds[0]`. */
function valueOf(row: Row, key: string): unknown {
  if (/^[\p{L}\p{N}_.-]+$/u.test(key)) return property(row, key)
  const node = compile(key)
  return node instanceof Error ? null : evaluate(node, row)
}

function formula(row: Row, name: string): unknown {
  if (row.cache.has(name)) return row.cache.get(name)
  const source = row.formulas[name]
  if (source === undefined || row.evaluating.has(name)) return null
  row.evaluating.add(name)
  const node = compile(String(source))
  const value = node instanceof Error ? null : evaluate(node, row)
  row.evaluating.delete(name)
  row.cache.set(name, value)
  return value
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value)
  return null
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined && value !== false && value !== '' && value !== 0
}

function equals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const x = toNumber(a)
  const y = toNumber(b)
  if (x !== null && y !== null) return x === y
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
  return false
}

export function compare(a: unknown, b: unknown): number {
  const emptyA = a === null || a === undefined || a === ''
  const emptyB = b === null || b === undefined || b === ''
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1
  const x = toNumber(a)
  const y = toNumber(b)
  if (x !== null && y !== null) return x - y
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base', numeric: true })
}

function stripHash(tag: unknown): string {
  return String(tag).replace(/^#/, '').toLowerCase()
}

function callMethod(
  target: unknown,
  name: string,
  args: unknown[],
  row: Row,
  fileTarget: boolean,
): unknown {
  if (fileTarget) {
    const file = row.file
    switch (name) {
      case 'hasTag':
        return args.some((wanted) => {
          const w = stripHash(wanted)
          return file.tags.some((tag) => {
            const t = tag.toLowerCase()
            return t === w || t.startsWith(w + '/')
          })
        })
      case 'inFolder': {
        const folder = String(args[0] ?? '').replace(/\/$/, '')
        return file.path.startsWith(folder + '/')
      }
      case 'hasLink':
        return args.some((wanted) => {
          const w = String(wanted).toLowerCase()
          return file.links.some(
            (link) => link.toLowerCase() === w || basename(link).toLowerCase() === w,
          )
        })
      case 'hasProperty':
        return args.some((wanted) => String(wanted) in file.properties)
    }
    return null
  }

  const list = Array.isArray(target) ? target : null
  const text = typeof target === 'string' ? target : null
  switch (name) {
    case 'contains':
      if (list) return list.some((item) => equals(item, args[0]))
      if (text) return text.toLowerCase().includes(String(args[0] ?? '').toLowerCase())
      return false
    case 'containsAny':
      return args.some((arg) => callMethod(target, 'contains', [arg], row, false) === true)
    case 'containsAll':
      return args.every((arg) => callMethod(target, 'contains', [arg], row, false) === true)
    case 'startsWith':
      return text ? text.toLowerCase().startsWith(String(args[0] ?? '').toLowerCase()) : false
    case 'endsWith':
      return text ? text.toLowerCase().endsWith(String(args[0] ?? '').toLowerCase()) : false
    case 'lower':
      return text?.toLowerCase() ?? null
    case 'upper':
      return text?.toUpperCase() ?? null
    case 'isEmpty':
      return !truthy(target)
    case 'join':
      return list ? list.join(String(args[0] ?? ', ')) : text
    case 'length':
      return list?.length ?? text?.length ?? null
  }
  return null
}

function evaluate(node: Node, row: Row): unknown {
  switch (node.t) {
    case 'lit':
      return node.v
    case 'list':
      return node.items.map((item) => evaluate(item, row))
    case 'id':
      if (node.name === 'file') return { __file: true }
      if (node.name === 'note') return row.file.properties
      if (node.name === 'formula') return { __formula: true }
      return property(row, node.name)
    case 'member': {
      const obj = evaluate(node.obj, row) as Record<string, unknown> | null
      if (obj && (obj as { __file?: boolean }).__file) return fileField(row.file, node.name)
      if (obj && (obj as { __formula?: boolean }).__formula) return formula(row, node.name)
      if (node.name === 'length') return callMethod(obj, 'length', [], row, false)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj[node.name] ?? null
      return null
    }
    case 'index': {
      const obj = evaluate(node.obj, row)
      const index = evaluate(node.index, row)
      if (Array.isArray(obj)) return obj[toNumber(index) ?? -1] ?? null
      if (obj && typeof obj === 'object')
        return (obj as Record<string, unknown>)[String(index)] ?? null
      return null
    }
    case 'call': {
      const args = () => node.args.map((arg) => evaluate(arg, row))
      if (node.fn.t === 'id') {
        const a = node.fn.name === 'if' ? null : args()
        switch (node.fn.name) {
          case 'if':
            return truthy(evaluate(node.args[0]!, row))
              ? evaluate(node.args[1]!, row)
              : node.args[2]
                ? evaluate(node.args[2], row)
                : null
          case 'number':
            return toNumber(a![0])
          case 'list':
            return Array.isArray(a![0]) ? a![0] : [a![0]]
          case 'link':
            return a![0]
          case 'now':
            return Date.now()
          case 'max':
            return Math.max(...a!.map((v) => toNumber(v) ?? -Infinity))
          case 'min':
            return Math.min(...a!.map((v) => toNumber(v) ?? Infinity))
        }
        return null
      }
      if (node.fn.t === 'member') {
        const objNode = node.fn.obj
        const isFile = objNode.t === 'id' && objNode.name === 'file'
        const target = isFile ? null : evaluate(objNode, row)
        return callMethod(target, node.fn.name, args(), row, isFile)
      }
      return null
    }
    case 'unary': {
      const value = evaluate(node.arg, row)
      return node.op === '!' ? !truthy(value) : -(toNumber(value) ?? 0)
    }
    case 'binary': {
      if (node.op === '&&')
        return truthy(evaluate(node.left, row)) && truthy(evaluate(node.right, row))
      if (node.op === '||')
        return truthy(evaluate(node.left, row)) || truthy(evaluate(node.right, row))
      const a = evaluate(node.left, row)
      const b = evaluate(node.right, row)
      switch (node.op) {
        case '==':
          return equals(a, b)
        case '!=':
          return !equals(a, b)
        case '<':
        case '>':
        case '<=':
        case '>=': {
          // A missing value is never more or less than anything, as in Obsidian.
          if (a === null || a === undefined || b === null || b === undefined) return false
          const c = compare(a, b)
          return node.op === '<'
            ? c < 0
            : node.op === '>'
              ? c > 0
              : node.op === '<='
                ? c <= 0
                : c >= 0
        }
        case '+': {
          const x = toNumber(a)
          const y = toNumber(b)
          return x !== null && y !== null ? x + y : `${a ?? ''}${b ?? ''}`
        }
        case '-':
          return (toNumber(a) ?? 0) - (toNumber(b) ?? 0)
        case '*':
          return (toNumber(a) ?? 0) * (toNumber(b) ?? 0)
        case '/': {
          const y = toNumber(b)
          return y ? (toNumber(a) ?? 0) / y : null
        }
        case '%': {
          const y = toNumber(b)
          return y ? (toNumber(a) ?? 0) % y : null
        }
      }
      return null
    }
  }
}

function passes(filter: Filter | undefined, row: Row): boolean {
  if (!filter) return true
  if (typeof filter === 'string') {
    const node = compile(filter)
    return node instanceof Error ? true : truthy(evaluate(node, row))
  }
  if (filter.and && !filter.and.every((f) => passes(f, row))) return false
  if (filter.or && !filter.or.some((f) => passes(f, row))) return false
  if (filter.not && filter.not.some((f) => passes(f, row))) return false
  return true
}

/* -------------------------------------------------------------------- views */

export interface Column {
  key: string
  label: string
}

export interface ResultRow {
  path: string
  values: Record<string, unknown>
  /** The cards' cover, a vault path, when the view has an `image`. */
  image: string | null
}

export interface ResultGroup {
  /** Null for a view without `groupBy`. */
  key: unknown
  rows: ResultRow[]
}

export interface ViewResult {
  view: BaseView
  columns: Column[]
  groups: ResultGroup[]
  total: number
  /** Expressions that did not parse, so the screen can say so. */
  errors: string[]
}

export function columnLabel(config: BaseConfig, key: string): string {
  const named = config.properties[key]?.displayName
  if (named) return named
  if (key === 'file.name') return 'Nome'
  return key.replace(/^(formula|note)\./, '')
}

export function runView(config: BaseConfig, viewIndex: number, files: BaseFile[]): ViewResult {
  const view = config.views[viewIndex] ?? config.views[0]!
  const errors = new Set<string>()
  for (const source of Object.values(config.formulas)) {
    const node = compile(String(source))
    if (node instanceof Error) errors.add(node.message)
  }

  const rows: Row[] = files.map((file) => ({
    file,
    formulas: config.formulas,
    cache: new Map(),
    evaluating: new Set(),
  }))
  let kept = rows.filter((row) => passes(config.filters, row) && passes(view.filters, row))

  const sorts = view.sort ?? []
  kept.sort((a, b) => {
    for (const { property: key, direction } of sorts) {
      const c = compare(valueOf(a, key), valueOf(b, key))
      if (c !== 0) return direction === 'DESC' ? -c : c
    }
    return 0
  })
  if (view.limit) kept = kept.slice(0, view.limit)

  const order = view.order?.length ? view.order : ['file.name']
  const columns = order.map((key) => ({ key, label: columnLabel(config, key) }))
  const toResult = (row: Row): ResultRow => {
    const values: Record<string, unknown> = {}
    for (const key of order) values[key] = valueOf(row, key)
    const image = view.image ? valueOf(row, view.image) : null
    return { path: row.file.path, values, image: typeof image === 'string' ? image : null }
  }

  let groups: ResultGroup[]
  if (view.groupBy) {
    const byKey = new Map<string, { key: unknown; rows: ResultRow[] }>()
    for (const row of kept) {
      const key = valueOf(row, view.groupBy.property)
      const id = JSON.stringify(key ?? null)
      if (!byKey.has(id)) byKey.set(id, { key, rows: [] })
      byKey.get(id)!.rows.push(toResult(row))
    }
    groups = [...byKey.values()].sort((a, b) => {
      const c = compare(a.key, b.key)
      return view.groupBy!.direction === 'DESC' ? -c : c
    })
  } else {
    groups = [{ key: null, rows: kept.map(toResult) }]
  }

  return { view, columns, groups, total: kept.length, errors: [...errors] }
}

/** How a value reads in a cell. */
export function showValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(showValue).join(', ')
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
