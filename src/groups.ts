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
  match: MatchSpec
}

function compile(spec: MatchSpec): (name: string) => boolean {
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
  { id: 'infra',   label: 'Infrastructure', match: { in: ['postgres', 'redis', 'minio', 'mailpit'] } },
  { id: 'workers', label: 'Workers',        match: { regex: '-workers?$' } },
  { id: 'other',   label: 'Other',          match: {} },
]

export let GROUPS: Group[] = DEFAULT_GROUPS.map(g => ({ id: g.id, label: g.label, match: compile(g.match) }))

export function setGroups(groups: GroupConfig[]): void {
  GROUPS = groups.map(g => ({ id: g.id, label: g.label, match: compile(g.match) }))
}

export function groupFor(name: string): Group {
  return GROUPS.find((g) => g.match(name)) ?? GROUPS[GROUPS.length - 1]
}
