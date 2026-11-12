import { execFile } from 'node:child_process'

// Windows PowerShell 5.1 按系统 ANSI 读取 .ps1，中文会乱码；
// 这里用 -EncodedCommand（UTF-16LE base64）把脚本直接传过去，绕开文件编码。
const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择工作区目录'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.WriteLine($dialog.SelectedPath)
}
`

/** 在本地桌面弹出系统文件夹选择框，返回绝对路径；用户取消返回 null。 */
export function pickFolder(): Promise<string | null> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-EncodedCommand', encoded],
      { encoding: 'utf8', timeout: 120_000, windowsHide: false },
      (error, stdout) => {
        if (error) return reject(error)
        const picked = stdout.trim()
        resolve(picked || null)
      },
    )
  })
}
