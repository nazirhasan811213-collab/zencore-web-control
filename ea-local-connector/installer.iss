#define AppVersion "1.30"
[Setup]
AppId=ZenCoreEAConnector
AppName=ZenCore EA Connector
AppVersion={#AppVersion}
AppPublisher=ZenCore
DefaultDirName={localappdata}\ZenCore\Connector
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ZenCoreSetup-1.30
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\ZenCoreConnector.exe
SetupLogging=yes
[Files]
Source: "..\dist\ZenCoreConnector.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "ZenCoreExecutor.mq5"; DestDir: "{app}"; Flags: ignoreversion
Source: "PANDUAN_INSTALL_1.30.txt"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{autodesktop}\ZenCore Connector"; Filename: "{app}\ZenCoreConnector.exe"
Name: "{userprograms}\ZenCore Connector"; Filename: "{app}\ZenCoreConnector.exe"
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ZenCoreConnector"; ValueData: """{app}\ZenCoreConnector.exe"" --background"; Flags: uninsdeletevalue
[Run]
Filename: "{app}\ZenCoreConnector.exe"; Description: "Buka ZenCore dan pasang EA 1.30"; Flags: nowait postinstall skipifsilent
