"""ZenCore Windows desktop Connector. Native GUI; credentials encrypted with user DPAPI."""
import ctypes
import hashlib
import http.cookiejar
import json
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
        self.connection_stage='EA_HEARTBEAT'
        local=read_fields(self.channel/'heartbeat.tsv')
        report=heartbeat(local,self.config)
        if local.get('accountBindingVersion') != 'ACCOUNT_SESSION_V1': raise ValueError('EA_UPGRADE_REQUIRED')
        self.config['eaSession'] = local['eaSession']
        if self.stop.is_set(): return
        # Poll commands quickly without multiplying database heartbeat writes.
        if time.monotonic()>=self.next_heartbeat:
            if not self.renew_lease(local): return

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
        if (self.channel/'command.tsv').exists(): return
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
        message='MT5 '+self.config.get('tradeMode','DEMO')+' tersambung • '+self.desired_state
        if self.last_result and self.last_result[0]!='EXECUTED':
            message+=' • '+readiness_message(self.last_result[1])
        self.status(message)
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
    def __init__(self,root):
        self.root=root; root.title('ZenCore Connector '+CONNECTOR_BUILD+' • EA '+EA_VERSION); root.geometry('640x590')
        self.runner=None; self.runner_thread=None; self.pairing=False; self.switching=False
        self.status=tk.StringVar(value='Login broker dalam MT5. Password MT5 tidak diperlukan di sini.')
        outer=ttk.Frame(root);outer.pack(fill='both',expand=True)
        canvas=tk.Canvas(outer,highlightthickness=0)
        scrollbar=ttk.Scrollbar(outer,orient='vertical',command=canvas.yview)
        scrollbar.pack(side='right',fill='y');canvas.pack(side='left',fill='both',expand=True)
        canvas.configure(yscrollcommand=scrollbar.set)
        box=ttk.Frame(canvas,padding=24)
        window=canvas.create_window((0,0),window=box,anchor='nw')
        box.bind('<Configure>',lambda event:canvas.configure(scrollregion=canvas.bbox('all')))
        canvas.bind('<Configure>',lambda event:canvas.itemconfigure(window,width=event.width))
        root.bind('<MouseWheel>',lambda event:canvas.yview_scroll(int(-event.delta/120),'units'))
        ttk.Label(box,text='ZenCore • EA + Connector',font=('Segoe UI',18,'bold')).pack(anchor='w')
        ttk.Label(box,text='REAL + DEMO • Setting di web, password broker kekal dalam MT5').pack(anchor='w',pady=(4,18))
        ttk.Label(box,text='1. Pasang EA dalam MT5').pack(anchor='w')
        self.folder=tk.StringVar()
        candidates=list((Path(os.environ.get('APPDATA','.'))/'MetaQuotes'/'Terminal').glob('*/MQL5'))
        if len(candidates)==1:self.folder.set(str(candidates[0].parent))
        row=ttk.Frame(box);row.pack(fill='x',pady=6)
        ttk.Entry(row,textvariable=self.folder).pack(side='left',fill='x',expand=True)
        ttk.Button(row,text='Pilih folder',command=lambda:self.folder.set(filedialog.askdirectory() or self.folder.get())).pack(side='left')
        ttk.Button(box,text='Pasang / Kemas kini EA '+EA_VERSION,command=self.install).pack(anchor='w')
        ttk.Label(box,text='Folder: MT5 → File → Open Data Folder. Selepas pemasangan,\nNavigator → Refresh → ZenCoreExecutor → letak pada satu chart.\nHidupkan Algo Trading; DLL dan WebRequest tidak diperlukan.').pack(anchor='w',pady=8)
        ttk.Label(box,text='2. Login akaun ZenCore (bukan password broker)').pack(anchor='w',pady=(12,4))
        self.email=tk.StringVar(); self.password=tk.StringVar();self.account=tk.StringVar()
        ttk.Label(box,text='Email ZenCore').pack(anchor='w')
        ttk.Entry(box,textvariable=self.email).pack(fill='x',pady=3)
        ttk.Label(box,text='Password ZenCore').pack(anchor='w')
        ttk.Entry(box,textvariable=self.password,show='•').pack(fill='x',pady=3)
        self.accounts=ttk.Combobox(box,textvariable=self.account,state='readonly');self.accounts.pack(fill='x',pady=4)
        ttk.Button(box,text='Cari akaun MT5',command=self.refresh).pack(anchor='w')
        ttk.Button(box,text='Login & pautkan akaun',command=self.pair).pack(anchor='w',pady=6)
        ttk.Button(box,text='Tukar akaun MT5 / pengguna ZenCore',command=self.change_account).pack(anchor='w',pady=6)
        ttk.Button(box,text='3. Buka ZenCore — setting & ON/OFF',command=lambda:webbrowser.open(BASE+'/auto-trade')).pack(anchor='w',pady=6)
        ttk.Label(box,textvariable=self.status,wraplength=580).pack(anchor='w',pady=12)
        ttk.Label(box,text='Biarkan Connector dan MT5 berjalan. Menutup aplikasi menghentikan\narahan baharu; SL yang diterima broker kekal aktif.').pack(anchor='w')
        self.refresh()
        try:
            config=load_config()
            if config:self.start(config)
        except Exception:self.status.set('Pautan perlu dibuat semula oleh Windows user ini.')
        root.protocol('WM_DELETE_WINDOW',self.close)
        self.root.after(2000,self.watch_accounts)
        if '--background' in sys.argv:root.iconify()
    def update(self,value):self.root.after(0,lambda:self.status.set(value))
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
        if runner: runner.stop.set()
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
            self.root.after(0,finish)
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
                config.update(account=identity['account'],server=identity['server'],tradeMode=identity['tradeMode'],channel=str(channel))
                save_config(config);install_app()
                self.root.after(0,lambda:self.start(config))
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
        self.root.after(0,finish)
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
            gui=tk.Tk();gui.withdraw();gui.update();gui.destroy()
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
