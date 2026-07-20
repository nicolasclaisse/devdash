import type { Group } from './types'

export interface MatchSpec {
  in?: string[]
  startsWith?: string
  endsWith?: string
  equals?: string
  regex?: string
}

export interface GroupConfig {
  id: string
  label: string
  match?: MatchSpec
}

function compile(spec: MatchSpec | undefined): (name: string) => boolean {
  if (!spec) return () => false
  const re = spec.regex ? new RegExp(spec.regex) : null
  return (name: string) => {
    if (spec.in && spec.in.includes(name)) return true
    if (spec.startsWith && name.startsWith(spec.startsWith)) return true
    if (spec.endsWith && name.endsWith(spec.endsWith)) return true
    if (spec.equals && name === spec.equals) return true
    if (re && re.test(name)) return true
    if (!spec.in && !spec.startsWith && !spec.endsWith && !spec.equals && !re) return true
    return false
  }
}

const DEFAULT_GROUPS: GroupConfig[] = [
  { id: 'other', label: 'Other', match: {} },
]

export let GROUPS: Group[] = DEFAULT_GROUPS.map(g => ({ id: g.id, label: g.label, match: compile(g.match) }))

let inlineServiceGroup = new Map<string, string>()

export function setGroups(groups: GroupConfig[]): void {
  GROUPS = groups.map(g => ({ id: g.id, label: g.label, match: compile(g.match) }))
}

export function setInlineServices(map: Record<string, string>): void {
  inlineServiceGroup = new Map(Object.entries(map))
}

export function groupFor(name: string): Group {
  const inlineId = inlineServiceGroup.get(name)
  if (inlineId) {
    const g = GROUPS.find((g) => g.id === inlineId)
    if (g) return g
  }
  return GROUPS.find((g) => g.match(name)) ?? GROUPS[GROUPS.length - 1]
}
