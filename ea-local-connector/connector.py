"""ZenCore Windows desktop Connector. Native GUI; credentials encrypted with user DPAPI."""
import ctypes
import hashlib
import http.cookiejar
import json
import queue
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import urllib.error
import urllib.request
import webbrowser
import uuid
from status_view import status_cards
from protocol import VERSION, EA_VERSION, CONNECTOR_BUILD, validation_code, command_server_time, atomic_write, read_fields, encode_fields, verified_command, command_fields, heartbeat

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


def install_ea(data_folder):
    data_folder = Path(data_folder)
    if not (data_folder/'MQL5').is_dir(): raise RuntimeError('Pilih folder melalui MT5: File > Open Data Folder.')
    experts = data_folder/'MQL5'/'Experts'/'ZenCore'
    experts.mkdir(parents=True,exist_ok=True)
    source = experts/'ZenCoreExecutor.mq5'
    shutil.copyfile(RESOURCE/'ZenCoreExecutor.mq5',source)
    origin_file = data_folder/'origin.txt'
    candidates = []
    if origin_file.exists():
        raw=origin_file.read_bytes()
        encoding = 'utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-16-le' if b'\x00' in raw else 'utf-8-sig'
        origin = raw.decode(encoding).strip('\x00\r\n ').strip('"')
        candidates.append(Path(origin)/'metaeditor64.exe')
    candidates.extend([data_folder/'metaeditor64.exe',Path(r'C:\Program Files\InterStellar MT5\metaeditor64.exe'),Path(r'C:\Program Files\MetaTrader 5\metaeditor64.exe')])
    editor = next((p for p in candidates if p.is_file()),None)
    if editor is None:
        raise RuntimeError('MetaEditor tidak ditemui. Compile ZenCoreExecutor.mq5 melalui MetaEditor (F7).')
    log = experts/'compile.log'
    # Remove prior binary so a stale EX5 can never masquerade as a successful build.
    source.with_suffix('.ex5').unlink(missing_ok=True)
    subprocess.run([str(editor),'/compile:'+str(source),'/log:'+str(log)],timeout=120,
      creationflags=subprocess.CREATE_NO_WINDOW,check=False)
    if not source.with_suffix('.ex5').exists():
        raise RuntimeError('EA_COMPILE_FAILED — semak compile.log dalam folder Experts\\ZenCore.')
    return experts


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
        'EA_POLICY_UPGRADE_REQUIRED':'Pasang EA 2.11 pada chart; versi lama tidak menyokong plan tepat.',
        'SL_POLICY_REJECTED':'Polisi SL tidak sepadan. Entry ditolak; kemas kini Connector dan EA.',
        'BROKER_STOP_DISTANCE':'Broker menolak jarak SL. Entry belum dibuka.',
        'ENTRY_OUTSIDE_PLAN':'Harga sudah di luar julat entry hingga TP1. Order tidak dikejar.',
        'SETUP_PARTIAL':'Sebahagian layer mungkin sudah dibuka. Semak posisi sebenar MT5.',
        'EA_ALGO_DISABLED':'EA > Properties > Allow Algo Trading mesti ON.',
        'ACCOUNT_TRADE_DISABLED':'Broker tidak memberi permission trading pada akaun ini.',
        'ACCOUNT_EXPERT_DISABLED':'Broker tidak memberi permission Expert Advisor pada akaun ini.',
        'LEASE_EXPIRED':'Kebenaran sambungan tamat. Tunggu Connector tersambung, kemudian ON semula.',
        'LEASE_STOPPED':'Web sedang STOP. Semak akaun dan tekan ON semula.',
        'LEASE_NOT_FOUND':'Fail kebenaran belum tersedia. Semak folder Common MT5.',
        'LEASE_BINDING_CHANGED':'Sesi atau akaun berubah. Pautkan semula akaun yang dipilih.',
        'ON_SETTINGS_INVALID':'Isi lot dan layer yang sah di web, kemudian ON semula.',
        'CONTROL_STOPPED':'Arahan ON dibatalkan kerana web sudah STOP.',
        'ALGO_OR_ACCOUNT_NOT_READY':'EA menolak ON. Pasang EA 1.28 dan semak permission MT5; lihat Experts.',
    }
    return messages.get(code,'Arahan ditolak: '+str(code or 'UNKNOWN')[:40])

class Runner:
    def __init__(self,config,status,on_unpaired=None):
        self.config=config; self.status=status; self.on_unpaired=on_unpaired; self.api=Api(); self.stop=threading.Event()
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
        safe={'EA_OFFLINE','EA_HEARTBEAT_MISSING','ACCOUNT_CHANGED','ACCOUNT_MODE_CHANGED','ACCOUNT_MODE_REJECTED','REAL_EA_UPGRADE_REQUIRED','INVALID_POD_TOKEN','TRANSPORT_REPLACED','INVALID_MT5_IDENTITY','EA_UPGRADE_REQUIRED','EA_SESSION_INVALID','ACCOUNT_BINDING_CHANGED','NETWORK_UNAVAILABLE','HTTP_429','HTTP_502','HTTP_503','HTTP_504','CONNECTION_PENDING','CONNECTED'}
        code=code if code in safe else 'CONNECTION_PENDING'
        try:
            atomic_write(self.channel/'connector-health.json',json.dumps({'build':CONNECTOR_BUILD,'code':code,'stage':self.connection_stage,'recordedAtMs':int(time.time()*1000),'lastCloudHeartbeatMs':self.last_cloud_heartbeat_ms,'consecutiveFailures':self.failure_count}))
        except OSError:pass
        return code
    def cycle(self):
        self.flush_results()
        self.connection_stage='EA_HEARTBEAT'
        local=read_fields(self.channel/'heartbeat.tsv')
        report=heartbeat(local,self.config)
        self.latest_local={k:local.get(k) for k in ('writtenAt','terminalConnected','terminalTradeAllowed','accountTradeAllowed','expertTradeAllowed','executorPolicyVersion','eaVersion','positionCount')}
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
                # ON can be queued between the periodic heartbeat and this poll.
                # Refresh server permission after verifying the command, before handing it to EA.
                if signed['type'] in ('SYSTEM_ON','MANUAL_EXIT_CONFIG'):
                    if not self.renew_lease(local): return
                    if signed['type']=='SYSTEM_ON' and self.desired_state!='ON': raise ValueError('CONTROL_STOPPED')
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
                  {'status':result['status'],'code':result['code'],'brokerOrderId':result.get('brokerOrderId','')},self.config['podToken'])
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
    def renew_lease(self, local):
        self.connection_stage='CLOUD_HEARTBEAT'
        response=self.api.request('/api/execution/heartbeat',heartbeat(local,self.config),self.config['podToken'])
        if self.stop.is_set(): return False
        current=read_fields(self.channel/'heartbeat.tsv')
        heartbeat(current,self.config)
        if current.get('eaSession')!=local['eaSession']:
            self.invalidate_lease();self.next_heartbeat=0
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
        self.next_heartbeat=time.monotonic()+2
        return True
    def invalidate_lease(self):
        try:
            atomic_write(self.channel/'lease.tsv',encode_fields({'account':self.config.get('account',''),
              'server':self.config.get('server',''),'expiresAt':0,'desiredState':'STOPPED'}))
        except OSError: pass  # Existing lease still has a bounded 12-second expiry.
    def run(self):
        while not self.stop.is_set():
            delay=.5
            try:
                self.cycle()
                self.failure_count=0
                if not self.stop.is_set():self.connection_health('CONNECTED' if self.next_heartbeat else 'CONNECTION_PENDING')
            except Exception as error:
                self.invalidate_lease()
                # A failed poll invalidates permission. Recovery MUST renew it even
                # when the previous periodic heartbeat was not yet due.
                self.next_heartbeat=0
                self.failure_count+=1
                raw='EA_HEARTBEAT_MISSING' if isinstance(error,FileNotFoundError) and self.connection_stage=='EA_HEARTBEAT' else str(error)
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
                    'EA_HEARTBEAT_MISSING':'EA belum menghantar data. Buka MT5 dan pasang EA pada chart.',
                    'EA_OFFLINE':'Heartbeat EA berhenti. Semak MT5 masih terbuka dan EA pada chart.',
                    'NETWORK_UNAVAILABLE':'Internet atau server tidak dapat dicapai. Connector cuba sambung semula.',
                    'INVALID_POD_TOKEN':'Pautan tidak sah. Pautkan semula akaun ZenCore.',
                    'TRANSPORT_REPLACED':'Pautan diganti oleh Connector lain. Semak PC yang aktif.',
                }
                self.status(code+' — '+hints.get(code,'Entry baharu menunggu sambungan; Connector cuba semula.'))
                delay=min(10,2**min(self.failure_count,4)) if code in ('NETWORK_UNAVAILABLE','HTTP_429','HTTP_502','HTTP_503','HTTP_504') else 2
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
        ttk.Label(setup,text='Pilih data folder terminal yang hendak digunakan.',style='Muted.TLabel').pack(anchor='w',pady=(4,8))
        candidates=list((Path(os.environ.get('APPDATA','.'))/'MetaQuotes'/'Terminal').glob('*/MQL5'))
        if len(candidates)==1:self.folder.set(str(candidates[0].parent))
        row=ttk.Frame(setup);row.pack(fill='x',pady=4)
        folders=ttk.Combobox(row,textvariable=self.folder,values=[str(p.parent) for p in candidates]);folders.pack(side='left',fill='x',expand=True)
        ttk.Button(row,text='Pilih folder',command=lambda:self.folder.set(filedialog.askdirectory() or self.folder.get())).pack(side='left',padx=(8,0))
        ttk.Button(setup,text='Pasang / kemas kini EA '+EA_VERSION,style='Accent.TButton',command=self.install).pack(anchor='w',pady=8)
        ttk.Label(setup,text='MT5 → File → Open Data Folder. Selepas pasang, Refresh Navigator,\nletak ZenCoreExecutor pada satu chart XAUUSD dan hidupkan Algo Trading.',style='Muted.TLabel').pack(anchor='w')
        link=ttk.Frame(box,padding=20);link.pack(fill='x',pady=(0,12))
        ttk.Label(link,text='2   Pautkan akaun anda',style='Card.TLabel').pack(anchor='w')
        ttk.Label(link,text='Gunakan login ZenCore. Connector membaca akaun MT5 secara automatik.',style='Muted.TLabel').pack(anchor='w',pady=(4,12))
        fields=ttk.Frame(link);fields.pack(fill='x');fields.columnconfigure(0,weight=1);fields.columnconfigure(1,weight=1)
        ttk.Label(fields,text='Email ZenCore').grid(row=0,column=0,sticky='w');ttk.Label(fields,text='Password ZenCore').grid(row=0,column=1,sticky='w',padx=(12,0))
        ttk.Entry(fields,textvariable=self.email).grid(row=1,column=0,sticky='ew',pady=(4,12))
        ttk.Entry(fields,textvariable=self.password,show='•').grid(row=1,column=1,sticky='ew',pady=(4,12),padx=(12,0))
        ttk.Label(link,text='Akaun MT5 yang EA sedang baca').pack(anchor='w')
        self.accounts=ttk.Combobox(link,textvariable=self.account,state='readonly');self.accounts.pack(fill='x',pady=(4,10))
        actions=ttk.Frame(link);actions.pack(fill='x')
        ttk.Button(actions,text='Cari akaun',command=self.refresh).pack(side='left')
        ttk.Button(actions,text='Pautkan akaun',style='Accent.TButton',command=self.pair).pack(side='left',padx=8)
        ttk.Button(actions,text='Reset link / tukar akaun',command=self.reset_link).pack(side='left')
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
        if runner:
            cloud={'lastCloudHeartbeatMs':runner.last_cloud_heartbeat_ms,'consecutiveFailures':runner.failure_count,'desiredState':'STOPPED' if runner.stop.is_set() else runner.desired_state,'entryBlockedReason':runner.entry_blocked_reason}
        cards=status_cards(local,cloud,int(time.time()*1000),bool(runner))
        for key,(text,tone) in cards.items():self.health_labels[key].configure(text=text,foreground={'good':'#4ce3ad','warn':'#f3c76a','bad':'#ff8691'}[tone])
        self.root.after(1000,self.health_tick)
    def reset_link(self):
        if self.pairing or self.switching:return
        if not messagebox.askyesno('Reset link akaun', 'Reset akan STOP dan kosongkan setting ZenCore untuk akaun baharu.\nPosisi sedia ada masih kekal di MT5; tutup sendiri jika diperlukan.\nTeruskan reset?'):return
        email=self.email.get();password=self.password.get();self.password.set('')
        if not self.session_api and (not email or not password):
            self.status.set('Isi email dan password ZenCore sekali untuk mengesahkan reset.');return
        self.switching=True;runner=self.runner
        if runner:runner.stop.set();runner.invalidate_lease()
        self.status.set('STOP sambungan lama dan reset link...')
        def task():
            try:
                if self.runner_thread:self.runner_thread.join(timeout=25)
                if self.runner_thread and self.runner_thread.is_alive():raise RuntimeError('RUNNER_STOP_PENDING')
                api=self.session_api or Api()
                if not self.session_api:api.request('/auth/login',{'email':email,'password':password})
                api.request('/api/auto-trade/reset-link',{})
                (INSTALL/'paired.dpapi').unlink(missing_ok=True)
                self.session_api=api
                def finish():
                    self.runner=None;self.runner_thread=None;self.switching=False;self.refresh()
                    self.status.set('Reset selesai. Login akaun baharu dalam MT5 dan pautkan semula selepas 30 saat. Posisi lama tidak ditutup automatik.')
                self.post(finish)
            except Exception:
                def failed():
                    self.switching=False;self.session_api=None
                    self.status.set('Sambungan tempatan dihentikan. Reset server belum disahkan; login ZenCore dan cuba reset semula.')
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
        folder=self.folder.get()
        def task():
            try:
                install_ea(folder);install_app()
                self.update('EA dipasang. Refresh Navigator, pasang pada satu chart dan hidupkan Algo Trading.')
            except Exception as e:self.update(str(e) if isinstance(e,RuntimeError) else 'Pemasangan gagal; semak folder MT5.')
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
        def finish():
            try: (INSTALL/'paired.dpapi').unlink(missing_ok=True)
            except OSError:
                self.status.set('Link dibatalkan tetapi fail pautan belum boleh dipadam. Tutup Connector dan cuba semula.');return
            self.runner=None;self.runner_thread=None
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
