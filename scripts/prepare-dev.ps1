$ErrorActionPreference = 'Stop'

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ports = @(3001, 5173)
$stopped = @{}

foreach ($port in $ports) {
  $lines = netstat -ano | Select-String "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$"
  foreach ($line in $lines) {
    $processId = [int]$line.Matches[0].Groups[1].Value
    if ($stopped.ContainsKey($processId)) { continue }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
    $commandLine = [string]$process.CommandLine
    $executable = [string]$process.ExecutablePath
    $belongsToWorkspace = $commandLine.IndexOf($workspaceRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $executable.IndexOf($workspaceRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0

    if (-not $belongsToWorkspace) {
      throw "Port $port is occupied by an unrelated process (PID $processId, $($process.Name)). Close it and try again."
    }

    Write-Host "Stopping stale $($process.Name) on port $port (PID $processId)..."
    Stop-Process -Id $processId -Force
    $stopped[$processId] = $true
  }
}
