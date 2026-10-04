"""ZenCore Windows desktop Connector. Native GUI; credentials encrypted with user DPAPI."""
import ctypes
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
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
from protocol import VERSION, atomic_write, read_fields, encode_fields, verified_command, command_fields, heartbeat

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
        origin = raw.decode('utf-16' if raw.startswith(b'\xff\xfe') else 'utf-8-sig').strip().strip('\x00')
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

class Runner:
    def __init__(self,config,status):
        self.config=config; self.status=status; self.api=Api(); self.stop=threading.Event()
        self.channel=Path(config['channel'])
        self.last_verified=0
        self.next_heartbeat=0
        self.desired_state="STOPPED"
        self.delivered_at={}
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
    def cycle(self):
        local=read_fields(self.channel/'heartbeat.tsv')
        report=heartbeat(local,self.config)
        # Poll commands quickly without multiplying database heartbeat writes.
        if time.monotonic()>=self.next_heartbeat:
            response=self.api.request('/api/execution/heartbeat',report,self.config['podToken'])
            self.desired_state=response['desiredState']
            # Only a successful server heartbeat renews permission to enter.
            atomic_write(self.channel/'lease.tsv',encode_fields({'account':self.config['account'], 'server':self.config['server'],
              'expiresAt':int(time.time()*1000)+12000,'desiredState':self.desired_state}))
            self.next_heartbeat=time.monotonic()+2

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
            result_path.unlink()
        if (self.channel/'command.tsv').exists(): return
        fetch_started=time.monotonic()
        result=self.api.request('/api/execution/commands/next',token=self.config['podToken'])
        fetch_ms=(time.monotonic()-fetch_started)*1000
        if result.get('command'):
            command=result['command']
            try:
                signed=verified_command(command,self.config['commandSigningKey'],self.config['podId'])
                fields=command_fields(signed,self.config)
                if fields.get('strategyMode')=='TF15_INTRA' and local.get('strategyExecutionVersion')!='TF2_TF15_V1':raise ValueError('EA_STRATEGY_UPGRADE_REQUIRED')
                if fields.get('exitPolicyVersion') and local.get('exitPolicyVersion')!=fields['exitPolicyVersion']:
                    raise ValueError('EA_POLICY_UPGRADE_REQUIRED')
            except (ValueError,KeyError,TypeError):
                self.api.request('/api/execution/commands/'+command['id']+'/ack',
                  {'status':'REJECTED','code':'COMMAND_VALIDATION_FAILED'},self.config['podToken'])
                return
            atomic_write(self.channel/'command.tsv',encode_fields(fields))
            self.delivered_at[command['id']]=time.monotonic()
            metrics={'commandFetchMs':fetch_ms}
            if isinstance(result.get('serverTime'),(int,float)):
                metrics['serverQueueAgeMs']=result['serverTime']-command['createdAt']
            self.timing(command['id'],'DELIVERED',**metrics)
        self.status('MT5 DEMO tersambung • '+self.desired_state)
    def run(self):
        while not self.stop.is_set():
            delay=.5
            try: self.cycle()
            except Exception as error:
                # Never include response bodies, auth values or raw exceptions in logs/UI.
                code=str(error) if str(error) in ('EA_OFFLINE','ACCOUNT_CHANGED','DEMO_ONLY','INVALID_POD_TOKEN','TRANSPORT_REPLACED') else 'CONNECTION_PENDING'
                self.status(code+' — entry baharu menunggu sambungan.')
                delay=2
            self.stop.wait(delay)

class App:
    def __init__(self,root):
        self.root=root; root.title('ZenCore Connector'); root.geometry('640x590')
        self.runner=None; self.pairing=False
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
        ttk.Label(box,text='Fasa 1 DEMO • Tiada webhook, key manual atau WebRequest MT5').pack(anchor='w',pady=(4,18))
        ttk.Label(box,text='1. Pasang EA dalam MT5').pack(anchor='w')
        self.folder=tk.StringVar()
        candidates=list((Path(os.environ.get('APPDATA','.'))/'MetaQuotes'/'Terminal').glob('*/MQL5'))
        if len(candidates)==1:self.folder.set(str(candidates[0].parent))
        row=ttk.Frame(box);row.pack(fill='x',pady=6)
        ttk.Entry(row,textvariable=self.folder).pack(side='left',fill='x',expand=True)
        ttk.Button(row,text='Pilih folder',command=lambda:self.folder.set(filedialog.askdirectory() or self.folder.get())).pack(side='left')
        ttk.Button(box,text='Pasang EA',command=self.install).pack(anchor='w')
        ttk.Label(box,text='Folder: MT5 → File → Open Data Folder. Selepas pemasangan,\nNavigator → Refresh → ZenCoreExecutor → letak pada satu chart.\nHidupkan Algo Trading; DLL dan WebRequest tidak diperlukan.').pack(anchor='w',pady=8)
        ttk.Label(box,text='2. Login akaun ZenCore (bukan password broker)').pack(anchor='w',pady=(12,4))
        self.email=tk.StringVar(); self.password=tk.StringVar();self.account=tk.StringVar()
        ttk.Entry(box,textvariable=self.email).pack(fill='x',pady=3)
        ttk.Entry(box,textvariable=self.password,show='•').pack(fill='x',pady=3)
        self.accounts=ttk.Combobox(box,textvariable=self.account,state='readonly');self.accounts.pack(fill='x',pady=4)
        ttk.Button(box,text='Cari akaun MT5',command=self.refresh).pack(anchor='w')
        ttk.Button(box,text='Login & pautkan akaun',command=self.pair).pack(anchor='w',pady=6)
        ttk.Button(box,text='3. Buka ZenCore — setting & ON/OFF',command=lambda:webbrowser.open(BASE+'/auto-trade')).pack(anchor='w',pady=6)
        ttk.Label(box,textvariable=self.status,wraplength=580).pack(anchor='w',pady=12)
        ttk.Label(box,text='Biarkan Connector dan MT5 berjalan. Menutup aplikasi menghentikan\narahan baharu; SL yang diterima broker kekal aktif.').pack(anchor='w')
        self.refresh()
        try:
            config=load_config()
            if config:self.start(config)
        except Exception:self.status.set('Pautan perlu dibuat semula oleh Windows user ini.')
        root.protocol('WM_DELETE_WINDOW',self.close)
        if '--background' in sys.argv:root.iconify()
    def update(self,value):self.root.after(0,lambda:self.status.set(value))
    def refresh(self):
        self.available={}
        for path in COMMON.glob('*/heartbeat.tsv'):
            try:
                f=read_fields(path)
                heartbeat(f,f)
                label='DEMO • ****'+f['account'][-4:]+' • '+f['server']
                if label in self.available: label+=' • '+path.parent.name
                self.available[label]=(path.parent,f)
            except Exception:pass
        self.accounts['values']=list(self.available)
        if len(self.available)==1:self.account.set(next(iter(self.available)))
    def install(self):
        folder=self.folder.get()
        def task():
            try:
                install_ea(folder);install_app()
                self.update('EA dipasang. Refresh Navigator, pasang pada satu chart dan hidupkan Algo Trading.')
            except Exception as e:self.update(str(e) if isinstance(e,RuntimeError) else 'Pemasangan gagal; semak folder MT5.')
        threading.Thread(target=task,daemon=True).start()
    def pair(self):
        if self.pairing:return
        if self.runner:self.status.set('Connector sudah dipautkan. Gunakan web untuk setting dan ON/OFF.');return
        if self.account.get() not in self.available:self.status.set('Pasang EA, kemudian klik Cari akaun MT5.');return
        email=self.email.get();password=self.password.get();self.password.set('')
        channel,identity=self.available[self.account.get()]
        self.pairing=True
        def task():
            try:
                api=Api();api.request('/auth/login',{'email':email,'password':password})
                config=api.request('/api/auto-trade/ea-connect',{})
                config.update(account=identity['account'],server=identity['server'],channel=str(channel))
                save_config(config);install_app()
                self.root.after(0,lambda:self.start(config))
            except RuntimeError as e:
                codes={'STOP_BEFORE_PAIRING':'Tekan OFF dalam web dan selesaikan posisi ZenCore dahulu.',
                  'OLD_CONNECTOR_ACTIVE':'Tutup worker/Connector lama; tunggu 2 minit, kemudian pautkan semula.',
                  'INVALID_LOGIN':'Login ZenCore tidak berjaya.', 'HTTP_404':'Web belum dipasang dengan sokongan EA Connector.'}
                self.update(codes.get(str(e),'Pautan gagal. Semak login dan versi web ZenCore.'))
            except Exception:self.update('Pautan gagal. Semak internet dan akaun ZenCore.')
            finally:self.pairing=False
        threading.Thread(target=task,daemon=True).start()
    def start(self,config):
        self.runner=Runner(config,self.update)
        threading.Thread(target=self.runner.run,daemon=True).start()
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
            sample=b'ZenCore packaging test'
            assert dpapi(dpapi(sample),True)==sample
            gui=tk.Tk();gui.withdraw();gui.update();gui.destroy()
            output=next((x.split('=',1)[1] for x in sys.argv if x.startswith('--output=')),None)
            if output:Path(output).write_text(json.dumps({'ok':True,'version':VERSION,'eaResource':True,'dpapi':True,'tkGui':True}))
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
