# Add or remove one folder on the current user's PATH, leaving every other entry exactly as it was
# (raw text and value type kept, so entries such as %USERPROFILE%\bin stay unexpanded).
# Used by Atelier's installer:  powershell -NoProfile -ExecutionPolicy Bypass -File path.ps1 add|remove <folder>
param([ValidateSet('add', 'remove')][string]$Action, [string]$Folder)
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
$parts = @($raw.Split(';') | Where-Object { $_ -ne '' })
$others = @($parts | Where-Object { $_.TrimEnd('\') -ine $Folder.TrimEnd('\') })
$next = if ($Action -eq 'add') { $others + $Folder } else { $others }
$value = $next -join ';'
if ($value -ne $raw) {
  $key.SetValue('Path', $value, $kind)
  # Tell open programs (Explorer, new terminals) that the environment changed.
  [Environment]::SetEnvironmentVariable('ATELIER_PATH_REFRESH', $null, 'User')
}
$key.Close()