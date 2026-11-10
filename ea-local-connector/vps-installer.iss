[Setup]
AppId=ZenCoreVPSConnectorManager
AppName=ZenCore VPS Connector Manager
AppVersion=1.0.9
AppPublisher=ZenCore
DefaultDirName={localappdata}\ZenCore\VPSConnector
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ZenCoreVPSSetup-1.0.9
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\ZenCoreVPSManager.exe
[Files]
Source: "..\dist\ZenCoreVPSManager.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "ZenCoreExecutor.mq5"; DestDir: "{app}"; Flags: ignoreversion
Source: "PANDUAN_VPS_10_USER.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "VPS_10_USER.csv"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{autodesktop}\ZenCore VPS Manager"; Filename: "{app}\ZenCoreVPSManager.exe"
Name: "{userprograms}\ZenCore VPS Manager"; Filename: "{app}\ZenCoreVPSManager.exe"
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "ZenCoreConnector"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ZenCoreVPSManager"; ValueData: """{app}\ZenCoreVPSManager.exe"""; Flags: uninsdeletevalue
[Run]
Filename: "{app}\ZenCoreVPSManager.exe"; Description: "Buka ZenCore VPS Manager"; Flags: nowait postinstall skipifsilent
