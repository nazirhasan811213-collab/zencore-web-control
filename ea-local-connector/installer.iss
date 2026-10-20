#define AppVersion "2.1.5"
[Setup]
AppId=ZenCoreErranteEAConnector
AppName=ZenCore Errante EA Connector
AppVersion={#AppVersion}
AppPublisher=ZenCore
DefaultDirName={localappdata}\ZenCoreErrante\Connector
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ZenCoreSetup-2.1.5
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
Source: "PANDUAN_INSTALL_2.1.5.txt"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{autodesktop}\ZenCore Errante Connector"; Filename: "{app}\ZenCoreConnector.exe"
Name: "{userprograms}\ZenCore Errante Connector"; Filename: "{app}\ZenCoreConnector.exe"
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ZenCoreErranteConnector"; ValueData: """{app}\ZenCoreConnector.exe"" --background"; Flags: uninsdeletevalue
[Run]
Filename: "{app}\ZenCoreConnector.exe"; Description: "Buka ZenCore dan pasang EA 2.12"; Flags: nowait postinstall skipifsilent
