export interface Process {
  name: string
  status: string
  system_time: string
  is_running: boolean
  restarts: number
  mem: number
  cpu: number
  pid?: number
  waiting_for?: string[]
}

export interface Group {
  id: string
  label: string
  match: (name: string) => boolean
}

export interface CustomCommand {
  name: string
  cmd: string
  group?: string
  working_dir?: string
  running: boolean
  pid?: number
}

export type CustomCommands = Record<string, { cmd: string; group?: string; working_dir?: string }>
