"""One desktop manager, ten isolated existing Connector Runners. No MT5 passwords."""
import hashlib,json,os,queue,sys,tempfile,threading,time,webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import ttk,filedialog,messagebox,simpledialog
from connector import Runner,Api,dpapi,COMMON,INSTALL,RESOURCE,reset_connector_data,RESET_MESSAGES,resolve_mt5_folder,choose_mt5_install,install_error_message,BASE
from protocol import heartbeat,read_fields,atomic_write,EA_VERSION,CONNECTOR_BUILD
VERSION='1.1.7'
ROOT=Path(os.environ.get('LOCALAPPDATA','.'))/'ZenCore'/'VPSConnector'

def compiled_ea_payload():
    # The installer keeps a second copy beside the EXE, outside PyInstaller's temp folder.
    candidates=[RESOURCE/'ZenCoreExecutor.ex5']
    if getattr(sys,'frozen',False):
        candidates.insert(0,Path(sys.executable).parent/'ZenCoreExecutor.ex5')
    for artifact in candidates:
        try:data=artifact.read_bytes()
        except OSError:continue
        if len(data)>=1024 and data.startswith(b'EX5'):
            return data
    raise RuntimeError('VPS_EA_PACKAGE_MISSING')

def install_ea(folder,editor=None):
    data=compiled_ea_payload()
    experts=resolve_mt5_folder(folder)/'MQL5'/'Experts'/'ZenCore'
    experts.mkdir(parents=True,exist_ok=True)
    temp=None
    try:
        with tempfile.NamedTemporaryFile(dir=experts,suffix='.tmp',delete=False) as stream:
            temp=Path(stream.name);stream.write(data)
        os.replace(temp,experts/'ZenCoreExecutor.ex5')
    finally:
        if temp is not None:temp.unlink(missing_ok=True)
    return experts

def slot_number(value):
    if isinstance(value,bool) or not isinstance(value,int) or not 1<=value<=10:raise ValueError('INVALID_SLOT')
    return value

def expected_channel(common,identity):
    if not str(identity.get('account','')).isdigit() or identity.get('tradeMode') not in ('DEMO','REAL') or not identity.get('server'):raise ValueError('INVALID_MT5_IDENTITY')
    digest=hashlib.sha256((identity['server']+'|'+identity['tradeMode']).encode()).hexdigest()[:16]
    return Path(common)/(str(identity['account'])+'-'+digest)

def config_valid(config,slot,common):
    slot_number(slot)
    if config.get('vpsSlot')!=slot or not isinstance(config.get('zenCoreLogin'),str) or not config.get('zenCoreLogin','').strip() or not config.get('podToken') or not config.get('podId') or not config.get('zenCoreUserId'):raise ValueError('PROFILE_IDENTITY_INVALID')
    if Path(config.get('channel','')).resolve()!=expected_channel(common,config).resolve():raise ValueError('CHANNEL_BINDING_INVALID')
    return config

def login_matches(login,user):
    def normalized(value):return ''.join(str(value or '').lower().split())
    wanted=normalized(login)
    aliases=[user.get('loginId'),user.get('email')]
    email=str(user.get('email','')).lower()
    if email.endswith('@managed.zencore.invalid'):aliases.append(email.split('@')[0])
    return bool(wanted) and any(normalized(value)==wanted for value in aliases)

class Vault:
    def __init__(self,root=ROOT,protect=dpapi):self.root=Path(root);self.protect=protect
    def path(self,slot):return self.root/('ZCuser-'+str(slot_number(slot)))/'paired.dpapi'
    def save(self,slot,config):
        p=self.path(slot);p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix('.tmp');tmp.write_bytes(self.protect(json.dumps(config).encode()));os.replace(tmp,p)
    def load(self,slot):
        p=self.path(slot);return json.loads(self.protect(p.read_bytes(),True)) if p.exists() else None
    def remove(self,slot):self.path(slot).unlink(missing_ok=True)
    def folder_path(self,slot):return self.path(slot).with_name('terminal-folder.json')
    def load_folder(self,slot):
        p=self.folder_path(slot)
        try:return json.loads(p.read_text())['folder'] if p.exists() else None
        except (OSError,ValueError,KeyError,TypeError):return None
    def save_folder(self,slot,folder):atomic_write(self.folder_path(slot),json.dumps({'folder':str(folder)}))
    def remove_folder(self,slot):self.folder_path(slot).unlink(missing_ok=True)

class Manager:
    def __init__(self,common=COMMON,vault=None,status=lambda *_:None,api_factory=Api,runner_factory=Runner):
        self.common=Path(common);self.vault=vault or Vault();self.status=status;self.api_factory=api_factory;self.runner_factory=runner_factory
        self.admin_api=None;self.admin_lock=threading.RLock();self.admin_user=None
        self.lock=threading.RLock();self.configs={};self.runners={};self.threads={};self.pending={};self.closing=False;self.installing={};self.folders={n:f for n in range(1,11) if (f:=self.vault.load_folder(n))}
    def login_admin(self,login,password):
        with self.admin_lock:self.admin_api=None;self.admin_user=None
        api=self.api_factory();user=api.request('/auth/login',{'email':login,'password':password}).get('user',{})
        if user.get('role')!='admin' or user.get('status')!='active':raise RuntimeError('ADMIN_REQUIRED')
        with self.admin_lock:self.admin_api=api;self.admin_user=user
        return user
    def admin_request(self,path,data=None):
        with self.admin_lock:
            if not self.admin_api:raise RuntimeError('ADMIN_LOGIN_REQUIRED')
            return self.admin_api.request(path,data)
    def setup_url(self,slot):
        cfg=self.configs.get(slot)
        if not cfg:raise RuntimeError('PROFILE_NOT_PAIRED')
        return BASE+'/admin/client/'+cfg['zenCoreUserId']+'/setup'
    def clear_slot(self,slot,preserve_profile=False):
        slot_number(slot)
        with self.lock:
            if slot in self.pending or slot in self.installing:raise RuntimeError('PROFILE_RESET_PENDING')
            cfg=self.configs.get(slot) or self.vault.load(slot)
            if cfg:config_valid(cfg,slot,self.common)
            self.pending[slot]={'resetting':True,'preserve_folder':preserve_profile}
        folder=self.folders.get(slot) or self.vault.load_folder(slot)
        receipt={'message':'Slot tempatan kosong.'}
        try:
            detached=False
            if cfg:
                try:self.api_factory().request('/api/execution/link-status',token=cfg['podToken'])
                except RuntimeError as error:
                    if str(error)=='INVALID_POD_TOKEN':detached=True
                    else:raise
            if cfg and not detached:
                # Authenticate admin even if the old Connector is offline.
                status=self.admin_request('/api/admin/clients/'+cfg['zenCoreUserId']+'/handover')
                command=None
                for attempt in range(90):
                    body={'confirmation':'RESET','closeAllAccount':True,'resetPolicy':'MASTER_RESET_RELEASE_V3','allowUnconfirmedDisconnect':True,'resetGeneration':status['generation'],'expectedPodTokenHash':hashlib.sha256(cfg['podToken'].encode()).hexdigest()}
                    if command:body['commandId']=command
                    receipt=self.admin_request('/api/admin/clients/'+cfg['zenCoreUserId']+('/switch-mt5' if preserve_profile else '/master-reset'),body)
                    self.status(slot,receipt.get('message','Menunggu reset...'))
                    if receipt.get('completed'):break
                    command=receipt.get('commandId');time.sleep(2)
                else:raise RuntimeError('RESET_COMMAND_PENDING')
            if detached:receipt={'brokerCloseConfirmed':False,'message':'Pautan lama telah dibatalkan. Slot tempatan dikosongkan.'}
            self.pause(slot)
            with self.lock:
                self.vault.remove(slot);self.configs.pop(slot,None);self.runners.pop(slot,None);self.threads.pop(slot,None)
                if preserve_profile and folder:self.vault.save_folder(slot,folder);self.folders[slot]=folder
                else:self.vault.remove_folder(slot);self.folders.pop(slot,None)
            return receipt
        finally:
            with self.lock:self.pending.pop(slot,None)
    def discover(self):
        found=[]
        for p in self.common.glob('*/heartbeat.tsv'):
            try:
                f=read_fields(p);heartbeat(f,f)
                if f.get('accountBindingVersion')!='ACCOUNT_SESSION_V1' or p.parent.resolve()!=expected_channel(self.common,f).resolve():continue
                found.append({'channel':str(p.parent),'identity':f,'label':f['tradeMode']+' • ****'+f['account'][-4:]+' • '+f['server']})
            except (OSError,ValueError,KeyError,TypeError):continue
        return sorted(found,key=lambda x:x['channel'])
    def reserved(self,slot,channel):
        target=str(Path(channel).resolve())
        return any(n!=slot and c.get('channel') and str(Path(c['channel']).resolve())==target for n,c in {**self.configs,**self.pending}.items())
    def pair(self,slot,channel,password,login=None):
        slot_number(slot);channel=Path(channel);login=(login or ('ZCuser '+str(slot))).strip()
        with self.lock:
            if slot in self.configs or slot in self.pending or slot in self.installing:raise RuntimeError('PROFILE_ALREADY_PAIRED')
            if self.reserved(slot,channel):raise RuntimeError('MT5_ALREADY_ASSIGNED')
            f=read_fields(channel/'heartbeat.tsv');heartbeat(f,f)
            if channel.resolve()!=expected_channel(self.common,f).resolve():raise RuntimeError('CHANNEL_BINDING_INVALID')
            self.pending[slot]={'channel':str(channel)}
        try:
            if self.admin_api:
                target=self.admin_request('/api/admin/vps/resolve',{'loginId':login})['client']
                if target.get('state')!='ADMIN_SETUP':raise RuntimeError('ADMIN_SETUP_REQUIRED')
                user_id=target['id']
            else:
                api=self.api_factory();me=api.request('/auth/login',{'email':login,'password':password}).get('user',{})
                if not login_matches(login,me) or me.get('role') not in ('client','ib') or not me.get('id'):raise RuntimeError('ZENCORE_USER_MISMATCH')
                user_id=me['id']
            with self.lock:
                if any(n!=slot and c.get('zenCoreUserId')==user_id for n,c in {**self.configs,**self.pending}.items()):raise RuntimeError('ZENCORE_USER_ALREADY_ASSIGNED')
                self.pending[slot]['zenCoreUserId']=user_id
            current=read_fields(channel/'heartbeat.tsv');heartbeat(current,f)
            if current.get('accountBindingVersion')!='ACCOUNT_SESSION_V1' or current.get('eaSession')!=f.get('eaSession'):raise RuntimeError('EA_SESSION_CHANGED')
            folder=self.folders.get(slot)
            if folder and current.get('terminalDataPath') and Path(current['terminalDataPath']).resolve()!=Path(folder).resolve():raise RuntimeError('MT5_FOLDER_ACCOUNT_MISMATCH')
            cfg=self.admin_request('/api/admin/clients/'+user_id+'/setup/ea-connect',{}) if self.admin_api else api.request('/api/auto-trade/ea-connect',{})
            latest=read_fields(channel/'heartbeat.tsv');heartbeat(latest,f)
            if latest.get('eaSession')!=f.get('eaSession'):raise RuntimeError('EA_SESSION_CHANGED')
            cfg.update(account=f['account'],server=f['server'],tradeMode=f['tradeMode'],channel=str(channel),vpsSlot=slot,zenCoreLogin=login,zenCoreUserId=user_id,paused=False)
            config_valid(cfg,slot,self.common)
            with self.lock:
                if any(c.get('zenCoreUserId')==cfg['zenCoreUserId'] for c in self.configs.values()):raise RuntimeError('ZENCORE_USER_ALREADY_ASSIGNED')
                self.vault.save(slot,cfg);self.configs[slot]=cfg
            self.start(slot);return cfg
        finally:
            with self.lock:self.pending.pop(slot,None)
    def install(self,slot,folder,editor=None):
        slot_number(slot);folder=resolve_mt5_folder(folder)
        with self.lock:
            if slot in self.installing or slot in self.pending:raise RuntimeError('PROFILE_RESET_PENDING')
            if any(n!=slot and Path(f).resolve()==folder for n,f in {**self.folders,**self.installing}.items()):raise RuntimeError('MT5_FOLDER_ALREADY_ASSIGNED')
            self.installing[slot]=str(folder)
        try:
            experts=install_ea(folder,editor)
            with self.lock:self.vault.save_folder(slot,folder);self.folders[slot]=str(folder)
            return experts
        finally:
            with self.lock:self.installing.pop(slot,None)
    def unpaired(self,slot):
        with self.lock:
            cfg=self.configs.get(slot)
            self.vault.remove(slot);self.configs.pop(slot,None)
            if not self.pending.get(slot,{}).get('preserve_folder'):self.vault.remove_folder(slot);self.folders.pop(slot,None)
            if cfg:
                for name in ('connector-health.json','execution-timing.jsonl','execution-timing.previous.jsonl'):
                    (Path(cfg['channel'])/name).unlink(missing_ok=True)
        self.status(slot,'RESET_CLEAR')
    def start(self,slot):
        slot_number(slot)
        with self.lock:
            if self.closing:raise RuntimeError('MANAGER_CLOSING')
            if self.pending.get(slot,{}).get('resetting'):raise RuntimeError('PROFILE_RESET_PENDING')
            t=self.threads.get(slot)
            if t and t.is_alive():return
            cfg=config_valid(self.configs[slot],slot,self.common)
            if self.reserved(slot,cfg['channel']):raise RuntimeError('MT5_ALREADY_ASSIGNED')
            cfg['paused']=False;self.vault.save(slot,cfg)
            runner=self.runner_factory(dict(cfg),lambda message:self.status(slot,message),lambda:self.unpaired(slot))
            t=threading.Thread(target=runner.run,daemon=True,name='ZCuser-'+str(slot));self.runners[slot]=runner;self.threads[slot]=t;t.start()
    def pause(self,slot,persist=True):
        with self.lock:
            r=self.runners.get(slot);t=self.threads.get(slot)
            if r:r.stop.set();r.invalidate_lease()
        if t:t.join(timeout=25)
        if t and t.is_alive():raise RuntimeError('CONNECTOR_STOP_PENDING')
        with self.lock:
            if persist and slot in self.configs:self.configs[slot]['paused']=True;self.vault.save(slot,self.configs[slot])
        self.status(slot,'PAUSED — sambungan tempatan dihentikan')
    def reset(self,slot):
        slot_number(slot)
        with self.lock:
            if slot in self.pending or slot in self.installing:raise RuntimeError('PROFILE_RESET_PENDING')
            cfg=self.configs.get(slot) or self.vault.load(slot)
            if cfg:config_valid(cfg,slot,self.common)
            self.pending[slot]={**(cfg or {}),'resetting':True}
        try:
            self.pause(slot)
            reset_connector_data(cfg,runner=self.runners.get(slot),config_path=self.vault.path(slot),common=self.common)
            with self.lock:
                self.vault.remove_folder(slot);self.folders.pop(slot,None)
                self.configs.pop(slot,None);self.runners.pop(slot,None);self.threads.pop(slot,None)
            self.status(slot,'RESET SELESAI — isi ID client baharu dan pautkan MT5')
        finally:
            with self.lock:self.pending.pop(slot,None)
    def restore(self):
        for slot in range(1,11):
            try:
                cfg=self.vault.load(slot)
                if not cfg:continue
                config_valid(cfg,slot,self.common)
                with self.lock:
                    if slot in self.configs or slot in self.pending:continue
                    if self.reserved(slot,cfg['channel']):raise RuntimeError('MT5_ALREADY_ASSIGNED')
                    if any(c.get('zenCoreUserId')==cfg['zenCoreUserId'] for c in self.configs.values()):raise RuntimeError('ZENCORE_USER_ALREADY_ASSIGNED')
                    self.configs[slot]=cfg
                if cfg.get('paused'):self.status(slot,'PAUSED')
                else:self.start(slot)
            except Exception:self.status(slot,'PROFILE_RESTORE_FAILED — semak pautan admin')
    def close(self):
        self.closing=True
        for r in list(self.runners.values()):r.stop.set();r.invalidate_lease()
        for t in list(self.threads.values()):t.join(timeout=2)

class App:
    def __init__(self,root,test_mode=False):
        self.root=root;self.events=queue.Queue();self.busy=set();self.options={};self.choices={};self.states={};self.buttons={};self.logins={};self.reset_buttons={};self.switch_buttons={};self.login_entries={};self.test_mode=test_mode
        self.manager=Manager(status=lambda n,s:self.events.put((n,s)))
        root.title('ZenCore VPS Manager '+VERSION+' • Connector '+CONNECTOR_BUILD+' • 10 MT5');root.geometry(str(min(1380,max(960,root.winfo_screenwidth()-60)))+'x'+str(min(780,max(600,root.winfo_screenheight()-80))));root.minsize(900,600);root.configure(bg='#091823')
        style=ttk.Style();style.theme_use('clam');style.configure('TFrame',background='#091823');style.configure('TLabel',background='#091823',foreground='#e5f3f8');style.configure('TButton',padding=7);style.configure('TCombobox',padding=5)
        main=ttk.Frame(root,padding=20);main.pack(fill='both',expand=True)
        ttk.Label(main,text='ZENCORE  |  VPS CONNECTOR MANAGER',font=('Segoe UI',20,'bold')).pack(anchor='w')
        ttk.Label(main,text='1 aplikasi • 10 pautan berasingan • Pasang EA '+EA_VERSION+' pada satu chart di setiap terminal MT5.').pack(anchor='w',pady=(6,15))
        top=ttk.Frame(main);top.pack(fill='x');self.admin_login=tk.StringVar();ttk.Label(top,text='ID Admin:').pack(side='left');ttk.Entry(top,textvariable=self.admin_login,width=28).pack(side='left',padx=5);ttk.Label(top,text='Password Admin:').pack(side='left');self.password=tk.StringVar();ttk.Entry(top,textvariable=self.password,show='*',width=22).pack(side='left',padx=8);ttk.Button(top,text='Sahkan Admin',command=self.login_admin).pack(side='left',padx=5);ttk.Button(top,text='Cari semua MT5',command=self.scan).pack(side='right')
        self.admin_status=tk.StringVar(value='Login admin dahulu. User kekal terkunci sehingga admin membuka serahan.');ttk.Label(main,textvariable=self.admin_status).pack(anchor='w',pady=5)
        table=ttk.Frame(main);table.pack(fill='both',expand=True,pady=12)
        canvas=tk.Canvas(table,background='#091823',highlightthickness=0);xs=ttk.Scrollbar(table,orient='horizontal',command=canvas.xview);ys=ttk.Scrollbar(table,orient='vertical',command=canvas.yview)
        xs.pack(side='bottom',fill='x');ys.pack(side='right',fill='y');canvas.pack(side='left',fill='both',expand=True);canvas.configure(xscrollcommand=xs.set,yscrollcommand=ys.set)
        grid=ttk.Frame(canvas);canvas.create_window((0,0),window=grid,anchor='nw');grid.bind('<Configure>',lambda _:canvas.configure(scrollregion=canvas.bbox('all')));grid.columnconfigure(1,weight=1);grid.columnconfigure(4,weight=2)
        for col,title in enumerate(['Slot / ID ZenCore','Akaun MT5 / Server','Pautan','EA / Reset','Status']):ttk.Label(grid,text=title,font=('Segoe UI',10,'bold')).grid(row=0,column=col,sticky='w',padx=5,pady=8)
        for n in range(1,11):
            login=tk.StringVar(value='ZCuser '+str(n));self.logins[n]=login
            cell=ttk.Frame(grid);cell.grid(row=n,column=0,sticky='w',padx=5,pady=10)
            ttk.Label(cell,text=str(n),width=2).pack(side='left');entry=ttk.Entry(cell,textvariable=login,width=20);entry.pack(side='left');self.login_entries[n]=entry
            value=tk.StringVar();self.choices[n]=value;combo=ttk.Combobox(grid,textvariable=value,state='readonly',width=40);combo.grid(row=n,column=1,sticky='ew',padx=5);self.options[n]=combo
            b=ttk.Button(grid,text='2 Sambung EA',command=lambda k=n:self.action(k));b.grid(row=n,column=2,padx=4);self.buttons[n]=b
            tools=ttk.Frame(grid);tools.grid(row=n,column=3,padx=4)
            ttk.Button(tools,text='1 Folder / EA',command=lambda k=n:self.install(k)).pack(side='left')
            ttk.Button(tools,text='3 Auto Trade',command=lambda k=n:self.open_setup(k)).pack(side='left',padx=3)
            switch=ttk.Button(tools,text='Tukar MT5',command=lambda k=n:self.switch_mt5(k));switch.pack(side='left',padx=3);self.switch_buttons[n]=switch
            reset=ttk.Button(tools,text='Kosongkan',command=lambda k=n:self.clear_slot(k));reset.pack(side='left',padx=3);self.reset_buttons[n]=reset
            state=tk.StringVar(value='BELUM DIPAUTKAN');self.states[n]=state;ttk.Label(grid,textvariable=state,wraplength=260).grid(row=n,column=4,sticky='w',padx=5)
        ttk.Label(main,text='ON/OFF, lot, layer, waktu dan SOP dikawal melalui akaun web setiap user. Manager tidak mengaktifkan trading.').pack(anchor='w')
        ttk.Label(main,text='Jangan pautkan akaun MT5 yang sama kepada dua ID. EA menolak pertukaran akaun atau sesi yang tidak sepadan.').pack(anchor='w',pady=4)
        root.protocol('WM_DELETE_WINDOW',self.close)
        if not test_mode:
            self.scan();threading.Thread(target=self.manager.restore,daemon=True).start();root.after(150,self.pump)
    def login_admin(self):
        if getattr(self,'admin_login_busy',False):return
        login=self.admin_login.get().strip();password=self.password.get();self.password.set('')
        if not login or not password:self.admin_status.set('Isi ID dan password admin.');return
        self.admin_login_busy=True;self.admin_status.set('Mengesahkan admin...')
        def work():
            try:self.manager.login_admin(login,password);self.events.put((0,'ADMIN DISAHKAN — pilih ID client pada setiap slot.'))
            except Exception:self.events.put((0,'Login admin gagal. Semak ID, password dan status admin.'))
            finally:self.admin_login_busy=False
        threading.Thread(target=work,daemon=True).start()
    def open_setup(self,n):
        try:webbrowser.open(self.manager.setup_url(n))
        except RuntimeError:self.states[n].set('Sambungkan EA kepada ID client dahulu.')
    def clear_slot(self,n):
        if n in self.busy:return
        if not self.manager.admin_api:self.states[n].set('Sahkan Admin dahulu untuk kosongkan slot.');return
        if not messagebox.askyesno('Kosongkan slot '+str(n),'RESET AKAUN dan SLOT ini sahaja? Profil/settings ZenCore kembali asal dan password zc123. Semua posisi/pending order akaun MT5 ini akan cuba ditutup/dibatalkan. Jika EA offline, hanya pautan sistem dilepaskan; posisi broker mungkin masih terbuka. Slot lain kekal. Teruskan?'):return
        def perform():
            result=self.manager.clear_slot(n);self.events.put((n,'RESET_CLEAR'))
            text='Slot kosong. Isi ID client baharu. Tunggu 30 saat sebelum pautan.'
            if result.get('brokerCloseConfirmed') is False:text='POSISI BROKER BELUM DISAHKAN TUTUP. '+text
            self.events.put((n,text))
        self.task(n,perform)
    def switch_mt5(self,n):
        if n in self.busy:return
        if not self.manager.admin_api:self.states[n].set('Sahkan Admin dahulu.');return
        if not messagebox.askyesno('Tukar akaun MT5','Cuba tutup SEMUA posisi dan pending order akaun lama, termasuk manual/EA lain. Pautan lama dibatalkan. Profil/password dan folder dikekalkan. Jika offline, posisi broker mungkin masih terbuka. Teruskan?'):return
        def perform():
            result=self.manager.clear_slot(n,preserve_profile=True);self.events.put((n,'RESET_CLEAR'))
            text='Login MT5 baharu pada folder sama, kemudian Sambung EA dan semak Auto Trade.'
            if result.get('brokerCloseConfirmed') is False:text='POSISI BROKER BELUM DISAHKAN TUTUP. '+text
            self.events.put((n,text))
        self.task(n,perform)
    def scan(self):
        found=self.manager.discover();identities={str(x['channel']):x['identity'] for x in found};self.available={}
        for item in found:
            label=item['label']
            if label in self.available:label+=' • '+Path(item['channel']).name
            self.available[label]=item['channel']
        for n,c in self.options.items():c['values']=list(self.available)
        with self.manager.lock:configs=dict(self.manager.configs)
        for n,folder in self.manager.folders.items():
            if n in configs:continue
            matches=[label for label,channel in self.available.items() if identities[channel].get('terminalDataPath') and Path(identities[channel]['terminalDataPath']).resolve()==Path(folder).resolve()]
            if len(matches)==1:self.choices[n].set(matches[0]);self.states[n].set('EA ditemui pada folder slot ini. Klik 2 Sambung EA.')
        for n,cfg in configs.items():
            label=cfg['tradeMode']+' • ****'+cfg['account'][-4:]+' • '+cfg['server'];self.choices[n].set(label);self.logins[n].set(cfg['zenCoreLogin']);self.login_entries[n].configure(state='readonly')
    def task(self,n,fn,stage="LINK"):
        if n in self.busy:return
        self.busy.add(n);self.buttons[n].configure(state='disabled');self.reset_buttons[n].configure(state='disabled');self.switch_buttons[n].configure(state='disabled');self.states[n].set('Memasang EA pada folder MT5...' if stage=='INSTALL' else 'Memproses...')
        def run():
            try:fn()
            except Exception as e:
                code=str(e) if isinstance(e,(RuntimeError,ValueError)) else 'CONNECTION_FAILED'
                safe={'ADMIN_REQUIRED','ADMIN_LOGIN_REQUIRED','ADMIN_SETUP_REQUIRED','MT5_FOLDER_ACCOUNT_MISMATCH','PROFILE_RESET_PENDING','ZENCORE_USER_ALREADY_ASSIGNED','PROFILE_ALREADY_PAIRED','MT5_ALREADY_ASSIGNED','ZENCORE_USER_MISMATCH','EA_SESSION_CHANGED','EA_OFFLINE','ACCOUNT_CHANGED','OLD_CONNECTOR_ACTIVE','STOP_BEFORE_PAIRING','LINK_RESET_WAIT','CONNECTOR_STOP_PENDING','INVALID_CREDENTIALS','ACCOUNT_DISABLED','ACCOUNT_EXPIRED','CHANNEL_BINDING_INVALID'}
                self.events.put((n,('Fail ZenCoreExecutor.ex5 tiada atau rosak dalam pakej Manager. Jalankan ZenCoreVPSSetup-1.1.7.exe semula.' if str(e)=='VPS_EA_PACKAGE_MISSING' else install_error_message(e)) if stage=='INSTALL' else RESET_MESSAGES.get(code,code if code in safe else 'PAUTAN GAGAL — semak login, EA dan sambungan')))
            finally:self.events.put((n,None))
        threading.Thread(target=run,daemon=True).start()
    def action(self,n):
        cfg=self.manager.configs.get(n)
        if cfg:
            if cfg.get('paused'):self.task(n,lambda:self.manager.start(n))
            else:self.task(n,lambda:self.manager.pause(n))
            return
        channel=self.available.get(self.choices[n].get());password='';login=self.logins[n].get().strip()
        if not self.manager.admin_api:self.states[n].set('Sahkan Admin dahulu.');return
        if not channel or not login:self.states[n].set('Pilih akaun MT5 dan ID client.');return
        self.task(n,lambda:self.manager.pair(n,channel,password,login))
    def reset(self,n):
        if n in self.busy:return
        if not messagebox.askyesno('Reset slot '+str(n),'Padam pautan dan data Connector untuk slot ini sahaja?\nOFF di web dan selesaikan posisi ZenCore dahulu.\nSelepas reset, isi ID client baharu dan pautkan MT5.'):return
        self.password.set('')
        def perform():
            self.manager.reset(n);self.events.put((n,'RESET_CLEAR'))
        self.task(n,perform)
    def install(self,n):
        if n in self.busy:return
        title='Slot '+str(n)+' — Folder MT5'
        preferred=simpledialog.askstring(title,
            'Tampal alamat daripada MT5 > File > Open Data Folder.\n'
            'Biarkan kosong untuk pilih folder daripada senarai.',
            initialvalue=self.manager.folders.get(n,''),parent=self.root)
        if preferred is None:return
        selection=choose_mt5_install(self.root,title,preferred,require_editor=False)
        if not selection:return
        folder,editor=selection
        def perform():
            self.manager.install(n,folder,editor)
            self.events.put((n,'EA dipasang. Dalam MT5 ini: Navigator > Refresh > attach ZenCoreExecutor pada satu chart. Kemudian Cari semua MT5 dan Pautkan.'))
        self.task(n,perform,stage='INSTALL')
    def pump(self):
        for _ in range(150):
            try:n,s=self.events.get_nowait()
            except queue.Empty:break
            if n==0:self.admin_status.set(s);continue
            if s is None:self.busy.discard(n)
            elif s=='RESET_CLEAR':self.choices[n].set('');self.logins[n].set('');self.states[n].set('RESET SELESAI — isi ID client baharu')
            else:self.states[n].set(s[:180])
            self.reset_buttons[n].configure(state='disabled' if n in self.busy else 'normal');self.switch_buttons[n].configure(state='disabled' if n in self.busy else 'normal')
            cfg=self.manager.configs.get(n);self.login_entries[n].configure(state='readonly' if cfg or n in self.busy else 'normal');self.buttons[n].configure(text='Sambung' if cfg and cfg.get('paused') else 'Henti' if cfg else '2 Sambung EA',state='disabled' if n in self.busy else 'normal')
        self.root.after(150,self.pump)
    def close(self):
        if not messagebox.askyesno('Tutup Manager?','Semua 10 sambungan akan berhenti. SL broker yang sudah dipasang kekal aktif. Teruskan?'):return
        self.password.set('');self.manager.close();self.root.destroy()

def main():
    if sys.platform!='win32':raise SystemExit('Windows diperlukan.')
    if '--self-test' in sys.argv:
        sample=b'VPS manager packaging';assert dpapi(dpapi(sample),True)==sample;payload=compiled_ea_payload()
        if '--require-sidecar' in sys.argv:
            assert (Path(sys.executable).parent/'ZenCoreExecutor.ex5').read_bytes()==payload
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);(folder/'MQL5').mkdir()
            installed=install_ea(folder)/'ZenCoreExecutor.ex5'
            assert installed.read_bytes()==payload
        root=tk.Tk();app=App(root,test_mode=True);root.update();assert len(app.states)==10 and len(app.reset_buttons)==10 and len(app.logins)==10
        if '--preview' in sys.argv:
            from PIL import ImageGrab
            ImageGrab.grab(bbox=(root.winfo_rootx(),root.winfo_rooty(),root.winfo_rootx()+root.winfo_width(),root.winfo_rooty()+root.winfo_height())).save('dist/VPS-Manager-Preview.png')
        root.destroy();Path('dist/vps-validation.json').write_text(json.dumps({'ok':True,'managerVersion':VERSION,'slots':10,'eaVersion':EA_VERSION,'connectorBuild':CONNECTOR_BUILD,'dpapi':True,'compiledEaInstalled':True}));return
    # Share the legacy Connector lock so two apps cannot write the same EA leases.
    INSTALL.mkdir(parents=True,exist_ok=True)
    import msvcrt
    lock=open(INSTALL/'instance.lock','a+b');lock.write(b'1');lock.flush();lock.seek(0)
    try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:raise SystemExit('Tutup Connector lama / Manager lain dahulu.')
    root=tk.Tk();App(root);root.mainloop()
if __name__=='__main__':main()
