"""ZenCore Windows desktop Connector. Native GUI; credentials encrypted with user DPAPI."""
import ctypes
import hashlib
import http.cookiejar
import json
import queue
import random
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except ImportError:
    # Transport and protocol tests can run without a desktop. GUI still requires Tk.
    tk = filedialog = messagebox = ttk = None
import urllib.error
import urllib.request
import webbrowser
import uuid
from status_view import status_cards
from protocol import VERSION, EA_VERSION, CONNECTOR_BUILD, validation_code, command_server_time, atomic_write, read_fields, encode_fields, verified_command, command_fields, heartbeat, broker_metadata

BASE = 'https://zencore-precision-entry.onrender.com'
INSTALL = Path(os.environ.get('LOCALAPPDATA', '.')) / 'ZenCore' / 'Connector'
COMMON = Path(os.environ.get('APPDATA','.')) / 'MetaQuotes' / 'Terminal' / 'Common' / 'Files' / 'ZenCore'
RESOURCE = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))

class Blob(ctypes.Structure):
    _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]

def dpapi(data, decrypt=False):
    if sys.platform != 'win32': raise RuntimeError('WINDOWS_REQUIRED')
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    result = fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    if not result: raise RuntimeError('DPAPI_FAILED')
    try: return ctypes.string_at(target.data, target.size)
    finally: ctypes.windll.kernel32.LocalFree(target.data)


def save_config(config):
    INSTALL.mkdir(parents=True, exist_ok=True)
    target = INSTALL / 'paired.dpapi'
    tmp = target.with_suffix('.tmp')
    tmp.write_bytes(dpapi(json.dumps(config).encode()))
    os.replace(tmp, target)


def load_config():
    target = INSTALL / 'paired.dpapi'
    return json.loads(dpapi(target.read_bytes(),True)) if target.exists() else None

def reset_connector_data(config, runner=None, runner_thread=None, config_path=None, common=None):
    """Forget only this Connector binding; keep broker protection and other profiles."""
    config_path=Path(config_path or INSTALL/'paired.dpapi')
    if runner:
        runner.stop.set();runner.invalidate_lease()
    if runner_thread:
        runner_thread.join(timeout=25)
        if runner_thread.is_alive():raise RuntimeError('CONNECTOR_STOP_PENDING')
    if runner and any(runner.channel.glob('*.result')):runner.flush_results()
    if config:
        common=Path(common or COMMON).resolve()
        digest=hashlib.sha256((config['server']+'|'+config.get('tradeMode','DEMO')).encode()).hexdigest()[:16]
        channel=Path(config['channel']).resolve()
        if channel!=common/(str(config['account'])+'-'+digest):raise RuntimeError('CHANNEL_BINDING_INVALID')
        # Keep the reset retryable if MT5 cannot yet confirm a flat, idle channel.
        atomic_write(channel/'lease.tsv',encode_fields({'account':config['account'],'server':config['server'],'expiresAt':0,'desiredState':'STOPPED'}))
        local=read_fields(channel/'heartbeat.tsv');report=heartbeat(local,config)
        if local.get('terminalConnected')!='1':raise RuntimeError('TERMINAL_OFFLINE')
        if int(local.get('positionCount',-1))!=0 or report['positions']:raise RuntimeError('RESET_POSITIONS_OPEN')
        if (channel/'command.tsv').exists() or any(channel.glob('*.result')):raise RuntimeError('RESET_COMMAND_PENDING')
        # Do not delete EA-owned heartbeat/risk/manual/step-lock files, even when flat.
        for name in ('connector-health.json','execution-timing.jsonl','execution-timing.previous.jsonl'):
            (channel/name).unlink(missing_ok=True)
    config_path.unlink(missing_ok=True)
    config_path.with_suffix('.tmp').unlink(missing_ok=True)

RESET_MESSAGES={
    'RESET_POSITIONS_OPEN':'Reset ditolak: selesaikan posisi ZenCore di MT5 dahulu.',
    'RESET_COMMAND_PENDING':'Reset ditolak: tunggu arahan/pengesahan MT5 selesai, kemudian cuba semula.',
    'CONNECTOR_STOP_PENDING':'Connector lama belum berhenti. Tunggu dan cuba Reset semula.',
    'EA_OFFLINE':'Reset ditolak: buka MT5 dan tunggu EA mengesahkan tiada posisi.',
    'TERMINAL_OFFLINE':'Reset ditolak: sambungkan MT5 ke broker dahulu.',
    'ACCOUNT_CHANGED':'Reset ditolak: login semula akaun MT5 lama untuk semak posisi dahulu.',
}

class Api:
    def __init__(self):
        handler = urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        # Never follow redirects with bearer credentials or ZenCore password.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs): return None
        self.opener = urllib.request.build_opener(handler,NoRedirect())
    def request(self, path, data=None, token=None):
        headers = {'Origin':BASE, 'Accept':'application/json', 'User-Agent':'ZenCore-EA-Connector/'+VERSION}
        if token: headers['Authorization'] = 'Bearer '+token
        if data is not None: headers['Content-Type']='application/json'
        req = urllib.request.Request(BASE+path, None if data is None else json.dumps(data).encode(), headers)
        try:
            with self.opener.open(req, timeout=10) as result:
                value = json.loads(result.read(200000))
        except urllib.error.HTTPError as error:
            try: code = json.loads(error.read(2000)).get('code','HTTP_'+str(error.code))
            except Exception: code = 'HTTP_'+str(error.code)
            raise RuntimeError(code) from None
        except (urllib.error.URLError, TimeoutError, socket.timeout):
            raise RuntimeError('NETWORK_UNAVAILABLE') from None
        if value.get('ok') is False: raise RuntimeError(value.get('code','REQUEST_REJECTED'))
        return value


def terminal_origin(data_folder):
    try:
        raw=(Path(data_folder)/'origin.txt').read_bytes()
        encoding='utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-16-le' if b'\x00' in raw else 'utf-8-sig'
        return Path(raw.decode(encoding).strip('\x00\r\n ').strip('"'))
    except (OSError,UnicodeError):return None

def resolve_mt5_folder(selected,terminal_root=None):
    folder=Path(os.path.expandvars(os.fspath(selected).strip().strip('"'))).expanduser().resolve()
    if folder.name.upper()=='MQL5':folder=folder.parent
    # A standard MT5 program folder is different from its live data folder.
    if (folder/'terminal64.exe').is_file():
        root=Path(terminal_root or Path(os.environ.get('APPDATA','.'))/'MetaQuotes'/'Terminal')
        matches=[]
        for candidate in root.glob('*/MQL5'):
            origin=terminal_origin(candidate.parent)
            if origin and origin.resolve()==folder:matches.append(candidate.parent.resolve())
        if len(matches)>1:raise RuntimeError('MT5_DATA_FOLDER_AMBIGUOUS')
        if len(matches)==1:return matches[0]
    if not (folder/'MQL5').is_dir():raise RuntimeError('MT5_DATA_FOLDER_REQUIRED')
    return folder

def find_metaeditor(data_folder):
    folder=Path(data_folder);origin=terminal_origin(folder)
    candidates=([origin/'metaeditor64.exe'] if origin else [])+[folder/'metaeditor64.exe',Path(r'C:\Program Files\InterStellar MT5\metaeditor64.exe'),Path(r'C:\Program Files\MetaTrader 5\metaeditor64.exe')]
    return next((p for p in candidates if p.is_file()),None)

INSTALL_MESSAGES={
    'MT5_DATA_FOLDER_REQUIRED':'Folder tidak betul. MT5 kedua > File > Open Data Folder. Pilih folder yang mengandungi MQL5.',
    'MT5_DATA_FOLDER_AMBIGUOUS':'Lebih satu data folder ditemui. Pilih terus melalui MT5 kedua > File > Open Data Folder.',
    'METAEDITOR_NOT_FOUND':'MetaEditor tidak ditemui. Pilih metaeditor64.exe milik MT5 ini, atau compile ZenCoreExecutor.mq5 dengan F7.',
    'METAEDITOR_INVALID':'Pilih fail metaeditor64.exe, bukan terminal64.exe.',
    'EA_COMPILE_FAILED':'EA gagal compile. Semak compile.log dalam MQL5/Experts/ZenCore; jangan guna EX5 lama.',
    'EA_COMPILE_TIMEOUT':'Compile EA mengambil terlalu lama. Semak MetaEditor dan cuba semula.',
    'EA_FOLDER_PERMISSION':'Folder EA tidak boleh ditulis. Semak permission Windows atau fail EA yang sedang digunakan.',
    'MT5_FOLDER_ALREADY_ASSIGNED':'Folder MT5 ini sudah dipilih slot lain. Pilih data folder terminal kedua yang berasingan.',
}
def install_error_message(error):
    if isinstance(error,PermissionError):return INSTALL_MESSAGES['EA_FOLDER_PERMISSION']
    if isinstance(error,subprocess.TimeoutExpired):return INSTALL_MESSAGES['EA_COMPILE_TIMEOUT']
    if isinstance(error,OSError):return 'Pemasangan EA gagal ('+type(error).__name__+'; kod '+str(getattr(error,'winerror',None) or error.errno or 'UNKNOWN')+'). Semak folder/MetaEditor dan permission Windows.'
    return INSTALL_MESSAGES.get(str(error),'Pemasangan EA gagal. Semak folder MT5, MetaEditor dan permission Windows.')

def install_ea(data_folder,editor_path=None):
    data_folder=resolve_mt5_folder(data_folder)
    experts=data_folder/'MQL5'/'Experts'/'ZenCore';experts.mkdir(parents=True,exist_ok=True)
    source=experts/'ZenCoreExecutor.mq5';shutil.copyfile(RESOURCE/'ZenCoreExecutor.mq5',source)
    editor=Path(editor_path) if editor_path else find_metaeditor(data_folder)
    if editor is None:raise RuntimeError('METAEDITOR_NOT_FOUND')
    if editor.name.lower()!='metaeditor64.exe' or not editor.is_file():raise RuntimeError('METAEDITOR_INVALID')
    log=experts/'compile.log'
    source.with_suffix('.ex5').unlink(missing_ok=True)
    # A prior log must not be mistaken for the current compilation report.
    log.unlink(missing_ok=True)
    subprocess.run([str(editor),'/compile:'+str(source),'/log:'+str(log)],timeout=120,
      creationflags=subprocess.CREATE_NO_WINDOW,check=False)
    if not source.with_suffix('.ex5').is_file() or source.with_suffix('.ex5').stat().st_size==0:raise RuntimeError('EA_COMPILE_FAILED')
    return experts


def discover_mt5_folders(terminal_root=None):
    root=Path(terminal_root or Path(os.environ.get('APPDATA','.'))/'MetaQuotes'/'Terminal')
    found=[]
    for mql in root.glob('*/MQL5'):
        if not mql.is_dir():continue
        folder=mql.parent.resolve();origin=terminal_origin(folder)
        found.append({'folder':folder,'label':(origin.name if origin else 'MT5')+' • '+folder.name,'origin':origin})
    return sorted(found,key=lambda item:str(item['folder']).casefold())

def choose_mt5_install(parent,title,preferred_folder=None):
    selected=[preferred_folder] if preferred_folder and str(preferred_folder).strip() else []
    found=discover_mt5_folders() if not selected else []
    if found:
        dialog=tk.Toplevel(parent);dialog.title(title);dialog.transient(parent);dialog.grab_set()
        ttk.Label(dialog,text='Pilih terminal MT5. Folder data dikesan secara automatik.').pack(padx=18,pady=12)
        choice=ttk.Combobox(dialog,state='readonly',width=75,values=[x['label'] for x in found]);choice.current(0);choice.pack(padx=18,pady=8)
        def pick():selected.append(str(found[choice.current()]['folder']));dialog.destroy()
        def browse():
            value=filedialog.askdirectory(parent=dialog,title='MT5 > File > Open Data Folder')
            if value:selected.append(value);dialog.destroy()
        row=ttk.Frame(dialog);row.pack(padx=18,pady=12)
        ttk.Button(row,text='Pilih folder ini',command=pick).pack(side='left',padx=5)
        ttk.Button(row,text='Folder lain...',command=browse).pack(side='left',padx=5)
        ttk.Button(row,text='Batal',command=dialog.destroy).pack(side='left',padx=5)
        parent.wait_window(dialog)
    elif not selected:
        value=filedialog.askdirectory(parent=parent,title=title+' — MT5 File > Open Data Folder')
        if value:selected.append(value)
    if not selected:return None
    try:folder=resolve_mt5_folder(selected[0])
    except Exception as error:
        messagebox.showerror('Folder MT5',install_error_message(error),parent=parent);return None
    editor=find_metaeditor(folder)
    if editor is None:
        chosen=filedialog.askopenfilename(parent=parent,title='Pilih metaeditor64.exe milik terminal MT5 ini',filetypes=[('MetaEditor MT5','metaeditor64.exe'),('Windows executable','*.exe')])
        if not chosen:return None
        editor=Path(chosen)
    return folder,editor


def install_app():
    if not getattr(sys,'frozen',False): return
    INSTALL.mkdir(parents=True,exist_ok=True)
    target = INSTALL/'ZenCoreConnector.exe'
    if Path(sys.executable).resolve() != target.resolve(): shutil.copy2(sys.executable,target)
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
        winreg.SetValueEx(key,'ZenCoreConnector',0,winreg.REG_SZ,'"'+str(target)+'" --background')
    desktop = Path(os.environ['USERPROFILE'])/'Desktop'
    desktop.mkdir(exist_ok=True)
    # .url is a Windows shortcut, no shell/PowerShell invocation required.
    (desktop/'ZenCore Connector.url').write_text('[InternetShortcut]\nURL='+target.as_uri()+'\n',encoding='utf-8')

def readiness_message(code):
    messages={
        'TERMINAL_OFFLINE':'MT5 terputus dari broker. Tunggu connection pulih, kemudian ON semula.',
        'TERMINAL_ALGO_DISABLED':'Hidupkan butang Algo Trading MT5, kemudian ON semula.',
        'EA_POLICY_UPGRADE_REQUIRED':'Pasang EA 2.21 pada chart; versi lama tidak menyokong plan tepat.',
        'SL_POLICY_REJECTED':'Polisi SL tidak sepadan. Entry ditolak; kemas kini Connector dan EA.',
        'BROKER_STOP_DISTANCE':'Broker menolak jarak SL. Entry belum dibuka.',
        'ENTRY_OUTSIDE_PLAN':'Harga sudah di luar julat entry hingga TP1. Order tidak dikejar.',
        'SETUP_PARTIAL':'Sebahagian layer mungkin sudah dibuka. Semak posisi sebenar MT5.',
        'EA_ALGO_DISABLED':'EA > Properties > Allow Algo Trading mesti ON.',
        'ACCOUNT_TRADE_DISABLED':'Broker tidak memberi permission trading pada akaun ini.',
        'ACCOUNT_EXPERT_DISABLED':'Broker tidak memberi permission Expert Advisor pada akaun ini.',
        'NETTING_POSITION_EXISTS':'Akaun netting masih ada posisi simbol ini. Entry baharu tidak ditambah.',
        'SETUP_POSITION_EXISTS':'Setup TF yang sama masih terbuka. Tunggu semua posisi tutup.',
        'ENTRY_PLAN_INVALID':'Susunan harga entry, SL dan TP tidak sah. Semak pelan Pine.',
        'QUOTE_NOT_READY':'Harga broker belum tersedia. Tunggu quote MT5.',
        'RISK_FILE_WRITE_FAILED':'Fail pelan risiko tidak boleh ditulis. Semak permission folder Common MT5.',
        'BROKER_ENTRY_REJECTED':'Broker menolak order. Semak retcode dan Experts MT5.',
        'LEASE_NOT_READY':'Kebenaran EA belum sah. Semak Cloud, akaun dan sesi MT5; tunggu sambungan pulih. Jangan reset pautan atau ulang order lama.',
        'LEASE_EXPIRED':'Kebenaran sambungan tamat. Connector cuba pulihkan sambungan; tidak perlu ulang OFF/ON untuk gangguan sementara.',
        'LEASE_STOPPED':'Sistem belum membenarkan entry. Semak status STOP/PAUSED dan akses akaun di web.',
        'LEASE_NOT_FOUND':'Fail kebenaran belum tersedia. Semak folder Common MT5.',
        'LEASE_BINDING_CHANGED':'Sesi atau akaun berubah. Pautkan semula akaun yang dipilih.',
        'ON_SETTINGS_INVALID':'Isi lot dan layer yang sah di web, kemudian ON semula.',
        'CONTROL_STOPPED':'Arahan ON dibatalkan kerana web sudah STOP.',
        'ALGO_OR_ACCOUNT_NOT_READY':'EA menolak ON. Pasang EA 1.28 dan semak permission MT5; lihat Experts.',
    }
    return messages.get(code,'Arahan ditolak: '+str(code or 'UNKNOWN')[:40])

def reconnect_delay(failures):
    # Spread recovery across VPS slots; never extend the maximum wait beyond 10s.
    return min(10,2**min(failures,4))*random.uniform(.8,1.0)

class Runner:
    def __init__(self,config,status,on_unpaired=None,background_lease=True):
        self.config=config; self.status=status; self.on_unpaired=on_unpaired; self.api=Api(); self.stop=threading.Event()
        self.lease_lock=threading.RLock();self.background_lease=background_lease
        self.lease_retry_at=0;self.lease_failure_count=0;self.lease_error=None
        self.next_link_check=0
        self.channel=Path(config['channel'])
        self.last_verified=0
        self.next_heartbeat=0
        self.desired_state="STOPPED"
        self.delivered_at={}
        self.last_result=None
        self.connection_stage="EA_HEARTBEAT"
        self.last_cloud_heartbeat_ms=0
        self.failure_count=0
        self.latest_local={}
        self.entry_blocked_reason=None
    def timing(self, command_id, stage, **metrics):
        # Bounded local diagnostics: IDs and durations only, never account/auth/payload.
        try:
            command_id=str(uuid.UUID(command_id))
            row={'commandId':command_id,'stage':stage,'recordedAtMs':int(time.time()*1000)}
            for key,value in metrics.items():
                if key in ('commandFetchMs','serverQueueAgeMs','handoffToAckMs','eaProcessingMs') and isinstance(value,(int,float)) and 0<=value<86400000:row[key]=round(value,2)
            target=self.channel/'execution-timing.jsonl'
            if target.exists() and target.stat().st_size>200000:
                target.replace(self.channel/'execution-timing.previous.jsonl')
            with target.open('a',encoding='utf-8') as log:log.write(json.dumps(row)+'\n')
        except (OSError,ValueError,TypeError):pass
    def connection_health(self, code):
        # Fixed codes only: no credentials, account identifiers or response bodies.
        safe={'LOCAL_FILE_LOCKED','EA_OFFLINE','EA_HEARTBEAT_MISSING','ACCOUNT_CHANGED','ACCOUNT_MODE_CHANGED','ACCOUNT_MODE_REJECTED','REAL_EA_UPGRADE_REQUIRED','INVALID_POD_TOKEN','TRANSPORT_REPLACED','INVALID_MT5_IDENTITY','EA_UPGRADE_REQUIRED','EA_SESSION_INVALID','EA_SESSION_CHANGED','ACCOUNT_BINDING_CHANGED','NETWORK_UNAVAILABLE','HTTP_429','HTTP_502','HTTP_503','HTTP_504','CONNECTION_PENDING','CONNECTED'}
        code=code if code in safe else 'CONNECTION_PENDING'
        try:
            atomic_write(self.channel/'connector-health.json',json.dumps({'build':CONNECTOR_BUILD,'code':code,'stage':self.connection_stage,'recordedAtMs':int(time.time()*1000),'lastCloudHeartbeatMs':self.last_cloud_heartbeat_ms,'consecutiveFailures':max(self.failure_count,self.lease_failure_count)}))
        except OSError:pass
        return code
    def cycle(self):
        if self.lease_error in ('INVALID_POD_TOKEN','TRANSPORT_REPLACED'):raise RuntimeError(self.lease_error)
        self.flush_results()
        self.connection_stage='EA_HEARTBEAT'
        local=read_fields(self.channel/'heartbeat.tsv')
        report=heartbeat(local,self.config)
        self.latest_local={k:local.get(k) for k in ('writtenAt','terminalConnected','terminalTradeAllowed','accountTradeAllowed','expertTradeAllowed','executorPolicyVersion','eaVersion','executionArmed','resumePending','positionCount')}
        if local.get('accountBindingVersion') != 'ACCOUNT_SESSION_V1': raise ValueError('EA_UPGRADE_REQUIRED')
        self.config['eaSession'] = local['eaSession']
        if self.stop.is_set(): return
        # Poll commands quickly without multiplying database heartbeat writes.
        if time.monotonic()>=self.next_heartbeat:
            if not self.renew_lease(local): return

        if (self.channel/'command.tsv').exists():
            self.status('Menunggu pengesahan EA — tiada order dihantar semula.')
            return
        self.connection_stage='COMMAND_FETCH'
        fetch_started=time.monotonic()
        result=self.api.request('/api/execution/commands/next',token=self.config['podToken'])
        fetch_ms=(time.monotonic()-fetch_started)*1000
        if result.get('command'):
            command=result['command']
            try:
                server_now=command_server_time(result,fetch_ms)
                signed=verified_command(command,self.config['commandSigningKey'],self.config['podId'],server_now)
                fields=command_fields(signed,self.config)
                if signed['type'] in ('SYSTEM_ON','PLACE_SETUP') and local.get('executorPolicyVersion')!='EXACT_ANALYSIS_V2':raise ValueError('EA_POLICY_UPGRADE_REQUIRED')
                if signed.get('payload',{}).get('fillRisk') and local.get('fillRiskVersion')!='FILL_PRICE_ATR_V1':raise ValueError('EA_POLICY_UPGRADE_REQUIRED')
                if fields.get('strategyMode')=='TF15_INTRA' and local.get('strategyExecutionVersion')!='TF2_TF15_V1':raise ValueError('EA_STRATEGY_UPGRADE_REQUIRED')
                if fields.get('exitPolicyVersion') and local.get('exitPolicyVersion')!=fields['exitPolicyVersion']:
                    raise ValueError('EA_POLICY_UPGRADE_REQUIRED')
                force_reset=signed['type']=='SYSTEM_STOP' and signed.get('payload',{}).get('masterResetVersion')=='MASTER_RESET_FORCE_V2'
                if force_reset and signed.get('payload',{}).get('bindingEpochHash') and signed['payload']['bindingEpochHash']!=hashlib.sha256(self.config['podToken'].encode()).hexdigest():raise ValueError('ACCOUNT_BINDING_CHANGED')
                if force_reset and local.get('masterResetVersion')!='MASTER_RESET_FORCE_V2':raise ValueError('EA_MASTER_RESET_UPGRADE_REQUIRED')
                # Command fetch can outlive the previous lease, or ON/STOP can change between polls.
                # Refresh server permission after verifying the command, before handing it to EA.
                if signed['type'] in ('SYSTEM_ON','PLACE_SETUP','MANUAL_EXIT_CONFIG') or force_reset:
                    if not self.renew_lease(local): return
                    if signed['type'] in ('SYSTEM_ON','PLACE_SETUP') and self.desired_state!='ON': raise ValueError('CONTROL_STOPPED')
                remaining_ms=signed['expiresAt']-server_now-(time.monotonic()-fetch_started)*1000+fetch_ms
                if remaining_ms <= 0: raise ValueError('COMMAND_EXPIRED')
                fields['expiresAt']=int(time.time()*1000+remaining_ms)
            except (ValueError,KeyError,TypeError) as error:
                code=validation_code(error)
                self.status('ENTRY REJECTED: '+code)
                self.api.request('/api/execution/commands/'+command['id']+'/ack',
                  {'status':'REJECTED','code':code},self.config['podToken'])
                return
            # Recheck after network I/O: do not deliver to a replaced EA/session.
            current=read_fields(self.channel/'heartbeat.tsv')
            heartbeat(current,self.config)
            if self.stop.is_set() or current.get('eaSession') != local['eaSession']: return
            atomic_write(self.channel/'command.tsv',encode_fields(fields))
            self.delivered_at[command['id']]=time.monotonic()
            metrics={'commandFetchMs':fetch_ms}
            if isinstance(result.get('serverTime'),(int,float)):
                metrics['serverQueueAgeMs']=result['serverTime']-command['createdAt']
            self.timing(command['id'],'DELIVERED',**metrics)
        message='MT5 '+self.config.get('tradeMode','DEMO')+' tersambung • '+('SERVER PAUSED' if self.entry_blocked_reason=='GLOBAL_ENTRY_PAUSED' else self.desired_state)
        if self.last_result and self.last_result[0]!='EXECUTED':
            message+=' • '+readiness_message(self.last_result[1])
        self.status(message)
    def flush_results(self):
        self.connection_stage='COMMAND_ACK'
        for result_path in sorted(self.channel.glob('*.result')):
            result=read_fields(result_path)
            try:
                self.api.request('/api/execution/commands/'+result['id']+'/ack',
                  {'status':result['status'],'code':result['code'],'brokerOrderId':result.get('brokerOrderId',''),'message':result.get('detail','')[:180]},self.config['podToken'])
            except RuntimeError as error:
                if str(error) != 'COMMAND_NOT_FOUND': raise
            delivered=self.delivered_at.pop(result['id'],None)
            measurements={}
            if delivered is not None:measurements['handoffToAckMs']=(time.monotonic()-delivered)*1000
            try:measurements['eaProcessingMs']=float(result.get('eaProcessingMs','nan'))
            except ValueError:pass
            self.timing(result['id'],'ACKNOWLEDGED',**measurements)
            self.last_result=(result.get('status'),result.get('code'))
            result_path.unlink()
    def lease_failed(self,error):
        # Called under lease_lock: stopped workers must never touch a replacement lease.
        if self.stop.is_set():return
        self.invalidate_lease();self.next_heartbeat=0;self.desired_state='STOPPED'
        self.lease_failure_count+=1
        self.lease_retry_at=time.monotonic()+reconnect_delay(self.lease_failure_count)
        raw='LOCAL_FILE_LOCKED' if isinstance(error,PermissionError) else 'EA_HEARTBEAT_MISSING' if isinstance(error,FileNotFoundError) else str(error)
        self.lease_error=self.connection_health(raw)
        self.status(self.lease_error+' — lease belum sah; sambungan akan dicuba semula.')
    def renew_lease(self, local=None, api=None):
        with self.lease_lock:
            if self.stop.is_set() or time.monotonic()<self.lease_retry_at:return False
            try:
                local=read_fields(self.channel/'heartbeat.tsv')
                heartbeat(local,self.config)
                return self._renew_lease(local, api or self.api)
            except Exception as error:
                self.lease_failed(error)
                raise
    def _renew_lease(self, local, api):
        self.connection_stage='CLOUD_HEARTBEAT'
        response=api.request('/api/execution/heartbeat',heartbeat(local,self.config),self.config['podToken'])
        if self.stop.is_set(): return False
        current=read_fields(self.channel/'heartbeat.tsv')
        heartbeat(current,self.config)
        if current.get('eaSession')!=local['eaSession']:
            self.lease_failed(ValueError('EA_SESSION_CHANGED'))
            return False
        state=response.get('desiredState')
        self.entry_blocked_reason=response.get('entryBlockedReason')
        if self.entry_blocked_reason in ('GLOBAL_ENTRY_PAUSED','EXECUTION_ROLLOUT_LOCKED'):state='STOPPED'
        if local.get('executorPolicyVersion')!='EXACT_ANALYSIS_V2':
            state='STOPPED';self.entry_blocked_reason='EA_POLICY_UPGRADE_REQUIRED'
        if state not in ('ON','STOPPED'): raise ValueError('CONTROL_STATE_INVALID')
        self.desired_state=state
        atomic_write(self.channel/'lease.tsv',encode_fields({'account':self.config['account'],'server':self.config['server'],
            'expiresAt':int(time.time()*1000)+12000,'desiredState':state,'tradeMode':self.config.get('tradeMode','DEMO'),
            'podId':self.config['podId'],'eaSession':current['eaSession']}))
        self.last_cloud_heartbeat_ms=int(time.time()*1000)
        self.lease_failure_count=0;self.lease_retry_at=0;self.lease_error=None
        self.next_heartbeat=time.monotonic()+2
        return True
    def invalidate_lease(self):
        with self.lease_lock:
            try:
                atomic_write(self.channel/'lease.tsv',encode_fields({'account':self.config.get('account',''),
                  'server':self.config.get('server',''),'expiresAt':0,'desiredState':'STOPPED'}))
            except OSError: pass  # Existing lease still has a bounded 12-second expiry.
    def maintain_lease(self, api=None):
        api=api or Api()
        while not self.stop.is_set():
            delay=.25
            try:
                with self.lease_lock:
                    if time.monotonic()>=self.next_heartbeat:
                        self.renew_lease(api=api)
                    delay=max(delay,self.lease_retry_at-time.monotonic())
            except Exception:
                # renew_lease already revoked permission and scheduled a shared backoff.
                # In particular, a late response after STOP must not erase a new lease.
                if self.stop.is_set():break
                delay=max(delay,self.lease_retry_at-time.monotonic())
            self.stop.wait(delay)
    def monitor_broker_metadata(self):
        # Optional, independent HTTP client/thread: never delay command polling or leases.
        if self.stop.wait(5): return
        api=Api()
        while not self.stop.is_set():
            delay=60
            try:
                payload=broker_metadata(read_fields(self.channel/'heartbeat.tsv'),self.config)
                api.request('/api/execution/broker-metadata',payload,self.config['podToken'])
            except Exception:
                # Monitoring availability must never change trading permissions.
                delay=10
            self.stop.wait(delay)
    def run(self):
        if self.background_lease:threading.Thread(target=self.maintain_lease,daemon=True,name='ZenCore-lease').start()
        if self.config.get('podToken') and self.config.get('account') and self.config.get('server'):
            threading.Thread(target=self.monitor_broker_metadata,daemon=True).start()
        while not self.stop.is_set():
            delay=.5
            try:
                self.cycle()
                self.failure_count=0
                if not self.stop.is_set():self.connection_health(self.lease_error or ('CONNECTED' if self.next_heartbeat else 'CONNECTION_PENDING'))
            except Exception as error:
                self.invalidate_lease()
                # A failed poll invalidates permission. Recovery MUST renew it even
                # when the previous periodic heartbeat was not yet due.
                self.next_heartbeat=0
                self.failure_count+=1
                raw='LOCAL_FILE_LOCKED' if isinstance(error,PermissionError) else 'EA_HEARTBEAT_MISSING' if isinstance(error,FileNotFoundError) and self.connection_stage=='EA_HEARTBEAT' else str(error)
                # Even with no local EA heartbeat, a web reset must release the
                # saved account link. Network failure alone never deletes it.
                if raw in ('EA_HEARTBEAT_MISSING','EA_OFFLINE','ACCOUNT_CHANGED','ACCOUNT_MODE_CHANGED') and time.monotonic()>=self.next_link_check:
                    self.next_link_check=time.monotonic()+10
                    try: self.api.request('/api/execution/link-status',token=self.config['podToken'])
                    except RuntimeError as link_error:
                        if str(link_error)=='INVALID_POD_TOKEN': raw='INVALID_POD_TOKEN'
                code=self.connection_health(raw)
                if code in ('INVALID_POD_TOKEN','TRANSPORT_REPLACED'):
                    self.stop.set()
                    self.status('Link lama dibatalkan. Pilih akaun MT5 baharu dan pautkan semula.')
                    if self.on_unpaired: self.on_unpaired()
                    break
                hints={
                    'LOCAL_FILE_LOCKED':'Fail pautan MT5 tidak boleh diakses. Connector cuba semula; semak permission folder jika berterusan.',
                    'EA_HEARTBEAT_MISSING':'EA belum menghantar data. Buka MT5 dan pasang EA pada chart.',
                    'EA_OFFLINE':'Heartbeat EA berhenti. Semak MT5 masih terbuka dan EA pada chart.',
                    'NETWORK_UNAVAILABLE':'Internet atau server tidak dapat dicapai. Connector cuba sambung semula.',
                    'INVALID_POD_TOKEN':'Pautan tidak sah. Pautkan semula akaun ZenCore.',
                    'TRANSPORT_REPLACED':'Pautan diganti oleh Connector lain. Semak PC yang aktif.',
                }
                self.status(code+' — '+hints.get(code,'Entry baharu menunggu sambungan; Connector cuba semula.'))
                delay=reconnect_delay(self.failure_count) if code in ('NETWORK_UNAVAILABLE','HTTP_429','HTTP_502','HTTP_503','HTTP_504') else 2
            self.stop.wait(delay)
        self.invalidate_lease()

class App:
    def __init__(self,root,test_mode=False):
        self.root=root;self.ui_queue=queue.Queue();self.session_api=None
        self.runner=None;self.runner_thread=None;self.pairing=False;self.switching=False
        root.title('ZenCore Connect '+CONNECTOR_BUILD+' • EA '+EA_VERSION)
        height=min(830,max(620,root.winfo_screenheight()-120))
        root.geometry('880x'+str(height)+'+40+20');root.minsize(760,620)
        bg='#07111d';panel='#101e30';muted='#a9bed3';root.configure(bg=bg)
        style=ttk.Style(root);style.theme_use('clam')
        style.configure('.',font=('Segoe UI',12),background=panel,foreground='#edf5ff')
        style.configure('TFrame',background=panel);style.configure('Shell.TFrame',background=bg)
        style.configure('TLabel',background=panel,foreground='#edf5ff')
        style.configure('Muted.TLabel',foreground=muted);style.configure('Title.TLabel',font=('Segoe UI',26,'bold'),background=bg)
        style.configure('Card.TLabel',font=('Segoe UI',14,'bold'))
        style.configure('TButton',padding=(16,10),background='#243b55',borderwidth=0)
        style.map('TButton',background=[('active','#355678')])
        style.configure('Accent.TButton',background='#087cbd',font=('Segoe UI',12,'bold'))
        style.map('Accent.TButton',background=[('active','#119cda')])
        style.configure('TEntry',fieldbackground='#192d44',foreground='#ffffff',padding=8,insertcolor='white')
        style.configure('TCombobox',fieldbackground='#192d44',foreground='white',padding=8)
        style.map('TCombobox',fieldbackground=[('readonly','#192d44')],foreground=[('readonly','white')])
        self.status=tk.StringVar(value='Mula dengan login broker dalam MT5. Password broker kekal dalam MT5.')
        self.folder=tk.StringVar();self.email=tk.StringVar();self.password=tk.StringVar();self.account=tk.StringVar()
        shell=ttk.Frame(root,padding=20,style='Shell.TFrame');shell.pack(fill='both',expand=True)
        ttk.Label(shell,text='ZENCORE CONNECT',style='Title.TLabel').pack(anchor='w')
        ttk.Label(shell,text='2.0  /  REAL + DEMO  /  Setting trade melalui web',background=bg,foreground=muted).pack(anchor='w',pady=(4,16))
        health=ttk.Frame(shell,style='Shell.TFrame');health.pack(fill='x',pady=(0,16));self.health_labels={}
        for i,(key,title) in enumerate([('mt5','01 / TERMINAL'),('cloud','02 / CLOUD'),('entry','03 / ENTRY')]):
            card=ttk.Frame(health,padding=14);card.grid(row=0,column=i,sticky='nsew',padx=(0,8 if i<2 else 0));health.columnconfigure(i,weight=1)
            ttk.Label(card,text=title,style='Muted.TLabel').pack(anchor='w')
            label=ttk.Label(card,text='MENUNGGU',font=('Segoe UI',12,'bold'));label.pack(anchor='w',pady=(8,0));self.health_labels[key]=label
        outer=ttk.Frame(shell,style='Shell.TFrame');outer.pack(fill='both',expand=True)
        canvas=tk.Canvas(outer,bg=bg,highlightthickness=0);self.canvas=canvas;scrollbar=ttk.Scrollbar(outer,orient='vertical',command=canvas.yview)
        scrollbar.pack(side='right',fill='y');canvas.pack(side='left',fill='both',expand=True);canvas.configure(yscrollcommand=scrollbar.set)
        box=ttk.Frame(canvas,style='Shell.TFrame');window=canvas.create_window((0,0),window=box,anchor='nw')
        box.bind('<Configure>',lambda event:canvas.configure(scrollregion=canvas.bbox('all')))
        canvas.bind('<Configure>',lambda event:canvas.itemconfigure(window,width=event.width))
        root.bind('<MouseWheel>',lambda event:canvas.yview_scroll(int(-event.delta/120),'units'))
        setup=ttk.Frame(box,padding=20);setup.pack(fill='x',pady=(0,12))
        ttk.Label(setup,text='1   Pasang EA pada MT5',style='Card.TLabel').pack(anchor='w')
        ttk.Label(setup,text='Pilih terminal atau tampal alamat daripada MT5 → File → Open Data Folder.',style='Muted.TLabel').pack(anchor='w',pady=(4,8))
        candidates=list((Path(os.environ.get('APPDATA','.'))/'MetaQuotes'/'Terminal').glob('*/MQL5'))
        if len(candidates)==1:self.folder.set(str(candidates[0].parent))
        row=ttk.Frame(setup);row.pack(fill='x',pady=4)
        folders=ttk.Combobox(row,textvariable=self.folder,values=[str(p.parent) for p in candidates]);folders.pack(side='left',fill='x',expand=True)
        ttk.Button(row,text='Pilih folder',command=lambda:self.folder.set(filedialog.askdirectory(parent=self.root,mustexist=True) or self.folder.get())).pack(side='left',padx=(8,0))
        ttk.Button(setup,text='Pasang / kemas kini EA '+EA_VERSION,style='Accent.TButton',command=self.install).pack(anchor='w',pady=8)
        ttk.Label(setup,text='MT5 → File → Open Data Folder. Selepas pasang, Refresh Navigator,\nletak ZenCoreExecutor pada satu chart XAUUSD dan hidupkan Algo Trading.',style='Muted.TLabel').pack(anchor='w')
        link=ttk.Frame(box,padding=20);link.pack(fill='x',pady=(0,12))
        ttk.Label(link,text='2   Pautkan akaun anda',style='Card.TLabel').pack(anchor='w')
        ttk.Label(link,text='Gunakan login ZenCore. Connector membaca akaun MT5 secara automatik.',style='Muted.TLabel').pack(anchor='w',pady=(4,12))
        fields=ttk.Frame(link);fields.pack(fill='x');fields.columnconfigure(0,weight=1);fields.columnconfigure(1,weight=1)
        ttk.Label(fields,text='ID / E-mel ZenCore').grid(row=0,column=0,sticky='w');ttk.Label(fields,text='Password ZenCore').grid(row=0,column=1,sticky='w',padx=(12,0))
        ttk.Entry(fields,textvariable=self.email).grid(row=1,column=0,sticky='ew',pady=(4,12))
        ttk.Entry(fields,textvariable=self.password,show='•').grid(row=1,column=1,sticky='ew',pady=(4,12),padx=(12,0))
        ttk.Label(link,text='Akaun MT5 yang EA sedang baca').pack(anchor='w')
        self.accounts=ttk.Combobox(link,textvariable=self.account,state='readonly');self.accounts.pack(fill='x',pady=(4,10))
        actions=ttk.Frame(link);actions.pack(fill='x')
        ttk.Button(actions,text='Cari akaun',command=self.refresh).pack(side='left')
        ttk.Button(actions,text='Pautkan akaun',style='Accent.TButton',command=self.pair).pack(side='left',padx=8)
        ttk.Button(actions,text='Reset Connector',command=self.reset_link).pack(side='left')
        footer=ttk.Frame(box,padding=20);footer.pack(fill='x')
        ttk.Label(footer,text='3   Kawal trade melalui ZenCore',style='Card.TLabel').pack(anchor='w')
        ttk.Button(footer,text='Buka dashboard & setting trade',style='Accent.TButton',command=lambda:webbrowser.open(BASE+'/auto-trade')).pack(anchor='w',pady=10)
        ttk.Label(footer,textvariable=self.status,wraplength=720,foreground='#7bd7ff').pack(anchor='w',pady=6)
        ttk.Label(footer,text='Tutup tingkap = minimize. Connector terus berjalan.\nPC/VM mesti hidup; broker SL kekal walaupun internet terputus.',style='Muted.TLabel').pack(anchor='w',pady=6)
        ttk.Button(footer,text='Keluar Connector',command=self.close).pack(anchor='w',pady=(10,0))
        self.refresh()
        try:
            config=None if test_mode else load_config()
            if config:self.start(config)
        except Exception:self.status.set('Pautan perlu dibuat semula oleh Windows user ini.')
        root.protocol('WM_DELETE_WINDOW',root.iconify)
        self.root.after(100,self.pump_ui);self.root.after(1000,self.health_tick);self.root.after(2000,self.watch_accounts)
        if '--background' in sys.argv:root.iconify()
    def health_tick(self):
        local={};cloud={};runner=self.runner
        raw=runner.latest_local if runner else self.available.get(self.account.get(),(None,{}))[1]
        for key in ('terminalConnected','terminalTradeAllowed','accountTradeAllowed','expertTradeAllowed'):local[key]=raw.get(key)=='1'
        try:local['writtenAt']=int(raw.get('writtenAt',0))
        except (ValueError,TypeError):local['writtenAt']=0
        local['executorPolicyVersion']=raw.get('executorPolicyVersion')
        if 'executionArmed' in raw:local['executionArmed']=raw.get('executionArmed')=='1'
        if runner:
            cloud={'lastCloudHeartbeatMs':runner.last_cloud_heartbeat_ms,'consecutiveFailures':max(runner.failure_count,runner.lease_failure_count),'desiredState':'STOPPED' if runner.stop.is_set() else runner.desired_state,'entryBlockedReason':runner.entry_blocked_reason}
        cards=status_cards(local,cloud,int(time.time()*1000),bool(runner))
        for key,(text,tone) in cards.items():self.health_labels[key].configure(text=text,foreground={'good':'#4ce3ad','warn':'#f3c76a','bad':'#ff8691'}[tone])
        self.root.after(1000,self.health_tick)
    def reset_link(self):
        if self.pairing or self.switching:return
        if not messagebox.askyesno('Reset Connector', 'Padam pautan, login dan data Connector pada PC ini?\nSelesaikan posisi ZenCore dan OFF di web dahulu.\nAkaun web/rekod broker tidak dipadam. Selepas reset, isi ID client baharu.'):return
        self.switching=True;runner=self.runner;thread=self.runner_thread
        self.status.set('Menghentikan sambungan dan mengosongkan data Connector...')
        def task():
            try:
                config=runner.config if runner else load_config()
                reset_connector_data(config,runner,thread)
                def finish():
                    self.runner=None;self.runner_thread=None;self.session_api=None;self.switching=False
                    self.email.set('');self.password.set('');self.account.set('');self.folder.set('')
                    self.available={};self.accounts['values']=[]
                    self.status.set('Reset selesai. Isi ID/password client baharu, Cari akaun MT5 dan Pautkan. Jika guna ID ZenCore lama: OFF di web dan tunggu 2 minit.')
                self.post(finish)
            except Exception as error:
                code=str(error)
                def failed(code=code):
                    self.switching=False;self.session_api=None;self.password.set('')
                    self.status.set(RESET_MESSAGES.get(code,'Reset belum selesai. Sambungan dihentikan; semak MT5 dan cuba semula.'))
                self.post(failed)
        threading.Thread(target=task,daemon=True).start()
    def post(self,callback):self.ui_queue.put(callback)
    def update(self,value):self.post(lambda:self.status.set(value))
    def pump_ui(self):
        for _ in range(100):
            try:callback=self.ui_queue.get_nowait()
            except queue.Empty:break
            callback()
        self.root.after(100,self.pump_ui)
    def refresh(self):
        self.available={}
        for path in COMMON.glob('*/heartbeat.tsv'):
            try:
                f=read_fields(path)
                heartbeat(f,f)
                label=f['tradeMode']+' • ****'+f['account'][-4:]+' • '+f['server']
                if label in self.available: label+=' • '+path.parent.name
                self.available[label]=(path.parent,f)
            except Exception:pass
        self.accounts['values']=list(self.available)
        if len(self.available)==1:self.account.set(next(iter(self.available)))
    def watch_accounts(self):
        if not self.runner and not self.pairing and not self.switching:self.refresh()
        self.root.after(2000,self.watch_accounts)
    def install(self):
        selection=choose_mt5_install(self.root,'Pasang EA',self.folder.get())
        if not selection:return
        folder,editor=selection;self.folder.set(str(folder))
        def task():
            try:
                install_ea(folder,editor);install_app()
                self.update('EA dipasang. Refresh Navigator, attach pada satu chart dalam MT5 ini, hidupkan Algo Trading, kemudian Cari akaun.')
            except Exception as error:self.update(install_error_message(error))
        threading.Thread(target=task,daemon=True).start()
    def change_account(self):
        if self.pairing or self.switching: return
        if not messagebox.askyesno('Tukar akaun MT5', 'OFF di web dan selesaikan posisi ZenCore pada akaun lama dahulu.\nConnector akan berhenti. Akaun baharu perlu dipautkan dan ON semula. Teruskan?'): return
        self.switching=True
        runner=self.runner
        if runner:
            runner.stop.set();runner.invalidate_lease()
        self.status.set('Menghentikan sambungan lama...')
        def task():
            if self.runner_thread: self.runner_thread.join(timeout=25)
            if self.runner_thread and self.runner_thread.is_alive():
                self.update('Sambungan lama belum berhenti. Cuba semula; akaun baharu belum dipautkan.')
                self.switching=False
                return
            try:
                if runner:
                    atomic_write(runner.channel/'lease.tsv',encode_fields({'account':runner.config['account'],'server':runner.config['server'],
                        'expiresAt':0,'desiredState':'STOPPED'}))
                # Remove the old auto-resume token only after the runner has stopped.
                (INSTALL/'paired.dpapi').unlink(missing_ok=True)
            except OSError:
                self.switching=False
                self.update('Fail pautan lama belum boleh dikemas kini. Pastikan folder boleh ditulis dan cuba semula.')
                return
            def finish():
                self.runner=None; self.runner_thread=None; self.switching=False
                self.refresh()
                self.status.set('Login akaun baharu di MT5, pasang EA pada satu chart, Cari akaun dan pautkan semula. Tunggu 2 minit jika sambungan lama masih aktif di web.')
            self.post(finish)
        threading.Thread(target=task,daemon=True).start()
    def pair(self):
        if self.pairing or self.switching:return
        if self.runner:self.status.set('Connector sudah dipautkan. Gunakan web untuk setting dan ON/OFF.');return
        if self.account.get() not in self.available:self.status.set('Pasang EA, kemudian klik Cari akaun MT5.');return
        email=self.email.get();password=self.password.get();self.password.set('')
        channel,identity=self.available[self.account.get()]
        self.pairing=True
        def task():
            try:
                api=Api();api.request('/auth/login',{'email':email,'password':password})
                # A selection can become stale while the user logs in.
                current=read_fields(channel/'heartbeat.tsv'); heartbeat(current,identity)
                if current.get('accountBindingVersion')!='ACCOUNT_SESSION_V1': raise RuntimeError('EA_UPGRADE_REQUIRED')
                config=api.request('/api/auto-trade/ea-connect',{})
                self.session_api=api
                config.update(account=identity['account'],server=identity['server'],tradeMode=identity['tradeMode'],channel=str(channel))
                save_config(config);install_app()
                self.post(lambda:self.start(config))
            except RuntimeError as e:
                codes={'STOP_BEFORE_PAIRING':'Tekan OFF dalam web dan selesaikan posisi ZenCore dahulu.',
                  'OLD_CONNECTOR_ACTIVE':'Tekan OFF dan Reset Link Akaun MT5 dalam web, kemudian pautkan semula.',
                  'LINK_RESET_WAIT':'Tunggu 30 saat selepas reset link, kemudian pautkan semula.',
                  'EA_UPGRADE_REQUIRED':'Pasang EA '+EA_VERSION+' dahulu.', 'INVALID_LOGIN':'Login ZenCore tidak berjaya.', 'HTTP_404':'Web belum dipasang dengan sokongan EA Connector.'}
                self.update(codes.get(str(e),'Pautan gagal. Semak login dan versi web ZenCore.'))
            except Exception:self.update('Pautan gagal. Semak internet dan akaun ZenCore.')
            finally:self.pairing=False
        threading.Thread(target=task,daemon=True).start()
    def link_reset_received(self):
        old=self.runner
        def finish():
            try: (INSTALL/'paired.dpapi').unlink(missing_ok=True)
            except OSError:
                self.status.set('Link dibatalkan tetapi fail pautan belum boleh dipadam. Tutup Connector dan cuba semula.');return
            if old:
                for name in ('connector-health.json','execution-timing.jsonl','execution-timing.previous.jsonl'):
                    (old.channel/name).unlink(missing_ok=True)
            self.runner=None;self.runner_thread=None;self.session_api=None
            self.email.set('');self.password.set('');self.account.set('');self.folder.set('')
            self.refresh()
            self.status.set('Reset link berjaya. Login akaun baharu dalam MT5, Cari akaun dan pautkan semula selepas 30 saat.')
        self.post(finish)
    def start(self,config):
        self.runner=Runner(config,self.update,self.link_reset_received)
        self.runner_thread=threading.Thread(target=self.runner.run,daemon=True)
        self.runner_thread.start()
    def close(self):
        if messagebox.askyesno('Tutup Connector?','Arahan entry dan close daripada web akan berhenti. Tutup?'):
            if self.runner:self.runner.stop.set()
            self.root.destroy()

if __name__=='__main__':
    if sys.platform!='win32':raise SystemExit('Windows desktop diperlukan.')
    if '--self-test' in sys.argv:
        # Packaging smoke test: no network, registry mutation, broker or pairing.
        try:
            assert (RESOURCE/'ZenCoreExecutor.mq5').is_file()
            assert '#property version "'+EA_VERSION+'"' in (RESOURCE/'ZenCoreExecutor.mq5').read_text()
            sample=b'ZenCore packaging test'
            assert dpapi(dpapi(sample),True)==sample
            gui=tk.Tk();app=App(gui,test_mode=True);gui.update_idletasks();gui.update()
            assert set(app.health_labels)=={'mt5','cloud','entry'}
            preview=next((x.split('=',1)[1] for x in sys.argv if x.startswith('--preview=')),None)
            if preview:
                from PIL import ImageGrab
                bbox=(gui.winfo_rootx(),gui.winfo_rooty(),gui.winfo_rootx()+gui.winfo_width(),gui.winfo_rooty()+gui.winfo_height())
                ImageGrab.grab(bbox=bbox).save(preview)
                app.canvas.yview_moveto(1);gui.update()
                ImageGrab.grab(bbox=bbox).save(str(Path(preview).with_name(Path(preview).stem+'-Account.png')))
            gui.destroy()
            output=next((x.split('=',1)[1] for x in sys.argv if x.startswith('--output=')),None)
            if output:Path(output).write_text(json.dumps({'ok':True,'version':VERSION,'eaVersion':EA_VERSION,'connectorBuild':CONNECTOR_BUILD,'eaResource':True,'dpapi':True,'tkGui':True}))
        except Exception:
            raise SystemExit(1)
        raise SystemExit(0)
    INSTALL.mkdir(parents=True,exist_ok=True)
    # One connector per Windows user; no DLL permission needed in MT5.
    import msvcrt
    lock=open(INSTALL/'instance.lock','a+b');lock.write(b'1');lock.flush();lock.seek(0)
    try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:raise SystemExit('ZenCore Connector sudah berjalan.')
    root=tk.Tk();App(root);root.mainloop()
