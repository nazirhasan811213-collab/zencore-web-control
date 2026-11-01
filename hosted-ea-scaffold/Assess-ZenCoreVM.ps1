[CmdletBinding()]
param([string]$Root='C:\ProgramData\ZenCore\HostedEA20',[string]$OutputPath)
$ErrorActionPreference='Stop'
$os=Get-CimInstance Win32_OperatingSystem
$cpu=Get-CimInstance Win32_ComputerSystem
$disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$report=[ordered]@{
    assessedAtUtc=[DateTime]::UtcNow.ToString('o')
    os=$os.Caption
    logicalProcessors=$cpu.NumberOfLogicalProcessors
    ramGiB=[Math]::Round($cpu.TotalPhysicalMemory/1GB,2)
    availableRamGiB=[Math]::Round($os.FreePhysicalMemory*1KB/1GB,2)
    systemDiskFreeGiB=[Math]::Round($disk.FreeSpace/1GB,2)
    runningMt5Count=@(Get-Process terminal64 -ErrorAction SilentlyContinue).Count
    runningConnectorCount=@(Get-Process ZenCoreConnector -ErrorAction SilentlyContinue).Count
    oldManagerTaskPresent=[bool](Get-ScheduledTask -TaskName 'ZenCore MT5 Worker Manager' -ErrorAction SilentlyContinue)
    scaffoldPresent=Test-Path (Join-Path $Root 'inventory.json')
    verifiedClientCapacity=$null
    assessment='Hardware inventory only. Concurrent 20-client capacity requires a workload test.'
}
$json=$report|ConvertTo-Json -Depth 5
if($OutputPath){[IO.File]::WriteAllText($OutputPath,$json,(New-Object Text.UTF8Encoding($false)))}
$json
