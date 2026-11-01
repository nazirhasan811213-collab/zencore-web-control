[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [string]$TerminalTemplatePath,
    [string]$Root='C:\ProgramData\ZenCore\HostedEA20',
    [switch]$Apply
)
$ErrorActionPreference='Stop'
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'Run setup as Administrator on the Windows VM. Existing MT5 processes will not be stopped.'
}
if(-not $TerminalTemplatePath){
    foreach($candidate in @('C:\Program Files\InterStellar MT5','C:\Program Files\MetaTrader 5')){
        if(Test-Path (Join-Path $candidate 'terminal64.exe')){$TerminalTemplatePath=$candidate;break}
    }
}
if(-not $TerminalTemplatePath){
    Add-Type -AssemblyName System.Windows.Forms
    $picker=New-Object Windows.Forms.FolderBrowserDialog
    $picker.Description='Select the installed broker MT5 program folder containing terminal64.exe'
    if($picker.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){throw 'MT5 folder selection cancelled.'}
    $TerminalTemplatePath=$picker.SelectedPath
}
$template=(Resolve-Path -LiteralPath $TerminalTemplatePath).Path
$Root=[IO.Path]::GetFullPath($Root)
if($Root -notmatch '^[A-Za-z]:\\' -or $Root.TrimEnd('\') -eq [IO.Path]::GetPathRoot($Root).TrimEnd('\')){throw 'Use a dedicated local folder.'}
if(Test-Path -LiteralPath $Root){throw 'Destination exists. Setup will not overwrite an existing host or client.'}
foreach($name in @('terminal64.exe','metaeditor64.exe')){
    if(-not(Test-Path -LiteralPath (Join-Path $template $name))){throw "Missing MT5 program: $name"}
}
$ea=Join-Path $PSScriptRoot 'assets\ZenCoreExecutor.mq5'
$setup=Join-Path $PSScriptRoot 'assets\ZenCoreSetup-1.31.exe'
foreach($asset in @($ea,$setup)){if(-not(Test-Path -LiteralPath $asset)){throw 'Package assets missing.'}}
$manifest=Get-Content (Join-Path $PSScriptRoot 'package-hashes.json') -Raw|ConvertFrom-Json
foreach($item in $manifest){
    $asset=Join-Path $PSScriptRoot $item.path
    if((Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256){throw "Package integrity check failed: $($item.path)"}
}
# All names are reserved before making changes. Users remain disabled and have no active sessions.
1..20|ForEach-Object{
    $user=('zcslot{0:D2}' -f $_)
    if(Get-LocalUser -Name $user -ErrorAction SilentlyContinue){throw "Windows slot identity already exists: $user"}
}
& (Join-Path $PSScriptRoot 'Assess-ZenCoreVM.ps1')
Write-Host 'Plan: 20 empty isolated slot identities, 20 portable terminals and EA files. Zero logins; zero trading.'
if(-not $Apply){Write-Host 'Assessment only. Use -Apply to create the scaffold.';return}
if(-not $PSCmdlet.ShouldProcess($Root,'Create 20 disabled client identities and stage MT5/EA binaries')){return}

function Set-PrivateDirectory([string]$Path,[string]$UserSid){
    New-Item -ItemType Directory -Path $Path -Force|Out-Null
    $acl=New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach($sid in @('S-1-5-18','S-1-5-32-544')){
        $identity=New-Object Security.Principal.SecurityIdentifier($sid)
        $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
        $acl.AddAccessRule($rule)
    }
    if($UserSid){
        $identity=New-Object Security.Principal.SecurityIdentifier($UserSid)
        $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'Modify','ContainerInherit,ObjectInherit','None','Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
Set-PrivateDirectory $Root ''
$slots=@()
try{
    foreach($index in 1..20){
        $slot=('s{0:D2}' -f $index);$user=('zcslot{0:D2}' -f $index)
        $random=New-Object byte[] 48
        $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
        try{$rng.GetBytes($random)}finally{$rng.Dispose()}
        # Password is neither printed nor persisted. Enable/reset via secure Windows admin flow at assignment.
        $password=ConvertTo-SecureString ('Zc!'+[Convert]::ToBase64String($random)+'7a') -AsPlainText -Force
        [Array]::Clear($random,0,$random.Length)
        $identity=New-LocalUser -Name $user -Password $password -Disabled -Description "ZenCore empty slot $slot"
        $password.Dispose()
        $slotRoot=Join-Path $Root "slots\$slot"
        Set-PrivateDirectory $slotRoot $identity.SID.Value
        $terminal=Join-Path $slotRoot 'mt5'
        New-Item -ItemType Directory -Path "$terminal\MQL5\Experts\ZenCore","$terminal\MQL5\Presets" -Force|Out-Null
        # Never clone Config, Bases, Profiles, Logs or existing account files from another terminal.
        foreach($binary in @('terminal64.exe','metaeditor64.exe','metatester64.exe')){
            $source=Join-Path $template $binary
            if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination $terminal}
        }
        Copy-Item -LiteralPath $ea -Destination "$terminal\MQL5\Experts\ZenCore\ZenCoreExecutor.mq5"
        $include=Join-Path $template 'MQL5\Include'
        if(Test-Path -LiteralPath $include){Copy-Item -LiteralPath $include -Destination "$terminal\MQL5" -Recurse}
        $compiler=Join-Path $terminal 'metaeditor64.exe'
        $sourceEa=Join-Path $terminal 'MQL5\Experts\ZenCore\ZenCoreExecutor.mq5'
        $compileLog=Join-Path $slotRoot 'ea-compile.log'
        $process=Start-Process -FilePath $compiler -ArgumentList @('/portable',('/compile:"'+$sourceEa+'"'),('/log:"'+$compileLog+'"')) -PassThru
        if(-not $process.WaitForExit(120000)){Stop-Process -Id $process.Id -ErrorAction SilentlyContinue;throw "EA compile timed out in $slot"}
        $compiled=Test-Path -LiteralPath ([IO.Path]::ChangeExtension($sourceEa,'ex5'))
        if(-not $compiled){throw "EA not compiled in $slot; inspect ea-compile.log. Slots remain disabled."}
        Copy-Item -LiteralPath $setup -Destination $slotRoot
        $ini=@'
[Common]
KeepPrivate=0
NewsEnable=0
[Experts]
Enabled=1
AllowLiveTrading=0
AllowDllImport=0
[StartUp]
Expert=ZenCore\ZenCoreExecutor
Symbol=XAUUSD
Period=M1
ExpertParameters=ZenCoreExecutor.set
'@
        [IO.File]::WriteAllText((Join-Path $slotRoot 'terminal-scaffold.ini'),$ini,(New-Object Text.UTF8Encoding($false)))
        [IO.File]::WriteAllText((Join-Path $terminal 'MQL5\Presets\ZenCoreExecutor.set'),'GoldBrokerSymbol=',(New-Object Text.UTF8Encoding($false)))
        $slots+= [ordered]@{slot=$slot;windowsUser=$user;windowsSid=$identity.SID.Value;terminalPath=(Join-Path $terminal 'terminal64.exe');eaCompiled=$compiled;
            status='EMPTY_DISABLED';zenCoreUserId=$null;accountAssigned=$false;actualChannel=$null;connectorPaired=$false;executionEnabled=$false}
        $inventory=[ordered]@{schemaVersion=1;slotCount=20;installationComplete=$false;capacityVerified=$false;slots=$slots}
        $inventory|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $Root 'inventory.json') -Encoding UTF8
    }
    $inventory.installationComplete=$true
    $inventory|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $Root 'inventory.json') -Encoding UTF8
    Write-Host '20 EMPTY slots staged. Users disabled; no MT5 login, Connector pairing or trading activated.'
}catch{
    Write-Error ('Scaffold incomplete. Created slots stay disabled; existing ZenCore installation was untouched. '+$_.Exception.Message)
    throw
}
