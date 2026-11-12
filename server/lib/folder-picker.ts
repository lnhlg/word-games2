import { execFile } from 'node:child_process'

// Windows PowerShell 5.1 按系统 ANSI 读取 .ps1，中文会乱码；
// 这里用 -EncodedCommand（UTF-16LE base64）把脚本直接传过去，绕开文件编码。
//
// 为什么用 IFileOpenDialog 而不是 FolderBrowserDialog：
// FolderBrowserDialog（老式 SHBrowseForFolder）从非前台进程弹出时不会自己提升到最前，
// 会被浏览器等前台窗口盖住，而且它的窗口 z-order 在显示期间还会被 shell 重排。
// Vista 起的 IFileOpenDialog 带 FOS_PICKFOLDERS 就是「选择文件夹」的现代对话框；
// 再把当前前台窗口（通常就是浏览器）设为 owner，它就会作为该窗口的模态子窗口，
// 稳定显示在最上层，正好解决「点选择目录后对话框躲在浏览器后面」的问题。
const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class FolderPicker
{
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7"), ClassInterface(ClassInterfaceType.None)]
    private class FileOpenDialog { }

    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        uint GetFileTypeIndex();
        uint Advise(IntPtr pfde);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        IShellItem GetFolder();
        IShellItem GetCurrentSelection();
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        IShellItem GetResult();
        void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close([MarshalAs(UnmanagedType.Error)] int hr);
        void SetClientGuid(IntPtr guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IntPtr ppenum);
        void GetSelectedItems(out IntPtr ppsai);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);

    public static string Pick(string title)
    {
        var dialog = (IFileOpenDialog)new FileOpenDialog();
        try
        {
            uint options;
            dialog.GetOptions(out options);
            // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
            dialog.SetOptions(options | 0x20 | 0x40 | 0x800);
            dialog.SetTitle(title);

            // 必须绑定当前前台窗口（通常就是浏览器）：对话框会成为它的模态子窗口，
            // 必然显示在它之上。传 IntPtr.Zero 时对话框只在系统"愿意"提升前台时才会置顶，
            // 实测会被 Chrome 这类普通窗口压住，正是要修的那个问题。
            IntPtr owner = GetForegroundWindow();
            if (owner == IntPtr.Zero || !IsWindow(owner) || !IsWindowVisible(owner)) owner = IntPtr.Zero;
            int hr = dialog.Show(owner);
            if (hr != 0) return null; // 用户取消

            var item = dialog.GetResult();
            try
            {
                string path;
                item.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
                return path;
            }
            finally
            {
                Marshal.ReleaseComObject(item);
            }
        }
        finally
        {
            Marshal.ReleaseComObject(dialog);
        }
    }
}
'@ | Out-Null

$picked = [FolderPicker]::Pick('选择工作区目录')
if ($picked) { [Console]::Out.WriteLine($picked) }
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
