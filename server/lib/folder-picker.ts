import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'pick-folder.ps1',
)

/** 在本地桌面弹出系统文件夹选择框，返回绝对路径；用户取消返回 null。 */
export function pickFolder(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { encoding: 'utf8', timeout: 120_000, windowsHide: false },
      (error, stdout) => {
        if (error) return reject(error)
        const picked = stdout.trim()
        resolve(picked || null)
      },
    )
  })
}
