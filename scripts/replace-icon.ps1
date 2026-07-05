# 替换 exe 图标的脚本
param(
    [string]$exePath,
    [string]$iconPath
)

# 检查文件是否存在
if (-not (Test-Path $exePath)) {
    Write-Error "EXE file not found: $exePath"
    exit 1
}

if (-not (Test-Path $iconPath)) {
    Write-Error "Icon file not found: $iconPath"
    exit 1
}

Write-Host "Replacing icon for: $exePath" -ForegroundColor Cyan
Write-Host "Using icon: $iconPath" -ForegroundColor Cyan

# 使用 .NET API 调用 Windows API 来替换图标
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class IconReplacer {
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);
    
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateResource(IntPtr hUpdate, string lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);
    
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);
    
    public static bool ReplaceIcon(string exePath, string iconPath) {
        try {
            // 读取 ICO 文件
            byte[] iconData = System.IO.File.ReadAllBytes(iconPath);
            
            // 开始更新资源
            IntPtr handle = BeginUpdateResource(exePath, false);
            if (handle == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                Console.WriteLine("Failed to begin resource update. Error code: " + error);
                return false;
            }
            
            // 更新 RT_GROUP_ICON 资源 (RT_GROUP_ICON = 14)
            if (!UpdateResource(handle, "#14", (IntPtr)1, 0, iconData, (uint)iconData.Length)) {
                int error = Marshal.GetLastWin32Error();
                Console.WriteLine("Failed to update resource. Error code: " + error);
                EndUpdateResource(handle, true);
                return false;
            }
            
            // 结束更新
            if (!EndUpdateResource(handle, false)) {
                int error = Marshal.GetLastWin32Error();
                Console.WriteLine("Failed to end resource update. Error code: " + error);
                return false;
            }
            
            return true;
        }
        catch (Exception ex) {
            Console.WriteLine("Exception: " + ex.Message);
            return false;
        }
    }
}
"@

# 执行替换
Write-Host "Starting icon replacement..." -ForegroundColor Yellow
$result = [IconReplacer]::ReplaceIcon($exePath, $iconPath)

if ($result) {
    Write-Host "Icon replaced successfully!" -ForegroundColor Green
    Write-Host "Please refresh Windows Explorer or restart to see the new icon." -ForegroundColor Yellow
} else {
    Write-Error "Failed to replace icon"
    exit 1
}
