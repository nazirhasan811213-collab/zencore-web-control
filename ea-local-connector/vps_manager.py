"""One desktop manager, ten isolated existing Connector Runners. No MT5 passwords."""
import hashlib,json,os,queue,sys,threading,time
from pathlib import Path
import tkinter as tk
from tkinter import ttk,filedialog,messagebox
from connector import Runner,Api,dpapi,install_ea,COMMON,INSTALL,RESOURCE,reset_connector_data,RESET_MESSAGES,resolve_mt5_folder,choose_mt5_install,install_error_message
from protocol import heartbeat,read_fields,atomic_write,EA_VERSION,CONNECTOR_BUILD
VERSION='1.0.7'
ROOT=Path(os.environ.get('LOCALAPPDATA','.'))/'ZenCore'/'VPSConnector'

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
        self.lock=threading.RLock();self.configs={};self.runners={};self.threads={};self.pending={};self.closing=False;self.installing={};self.folders={n:f for n in range(1,11) if (f:=self.vault.load_folder(n))}
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
            api=self.api_factory();me=api.request('/auth/login',{'email':login,'password':password}).get('user',{})
            if not login_matches(login,me) or me.get('role') not in ('client','ib') or not me.get('id'):raise RuntimeError('ZENCORE_USER_MISMATCH')
            with self.lock:
                if any(n!=slot and c.get('zenCoreUserId')==me['id'] for n,c in {**self.configs,**self.pending}.items()):raise RuntimeError('ZENCORE_USER_ALREADY_ASSIGNED')
                self.pending[slot]['zenCoreUserId']=me['id']
            current=read_fields(channel/'heartbeat.tsv');heartbeat(current,f)
            if current.get('accountBindingVersion')!='ACCOUNT_SESSION_V1' or current.get('eaSession')!=f.get('eaSession'):raise RuntimeError('EA_SESSION_CHANGED')
            cfg=api.request('/api/auto-trade/ea-connect',{})
            cfg.update(account=f['account'],server=f['server'],tradeMode=f['tradeMode'],channel=str(channel),vpsSlot=slot,zenCoreLogin=login,zenCoreUserId=me['id'],paused=False)
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
            self.vault.remove(slot);self.vault.remove_folder(slot);self.folders.pop(slot,None);self.configs.pop(slot,None)
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
        self.root=root;self.events=queue.Queue();self.busy=set();self.options={};self.choices={};self.states={};self.buttons={};self.logins={};self.reset_buttons={};self.login_entries={};self.test_mode=test_mode
        self.manager=Manager(status=lambda n,s:self.events.put((n,s)))
        root.title('ZenCore VPS Manager '+VERSION+' • Connector '+CONNECTOR_BUILD+' • 10 MT5');root.geometry('1380x780');root.configure(bg='#091823')
        style=ttk.Style();style.theme_use('clam');style.configure('TFrame',background='#091823');style.configure('TLabel',background='#091823',foreground='#e5f3f8');style.configure('TButton',padding=7);style.configure('TCombobox',padding=5)
        main=ttk.Frame(root,padding=20);main.pack(fill='both',expand=True)
        ttk.Label(main,text='ZENCORE  |  VPS CONNECTOR MANAGER',font=('Segoe UI',20,'bold')).pack(anchor='w')
        ttk.Label(main,text='1 aplikasi • 10 pautan berasingan • Pasang EA '+EA_VERSION+' pada satu chart di setiap terminal MT5.').pack(anchor='w',pady=(6,15))
        top=ttk.Frame(main);top.pack(fill='x');ttk.Label(top,text='Password ZenCore untuk pautan (tidak disimpan):').pack(side='left');self.password=tk.StringVar();ttk.Entry(top,textvariable=self.password,show='*',width=22).pack(side='left',padx=8);ttk.Button(top,text='Kosongkan',command=lambda:self.password.set('')).pack(side='left');ttk.Button(top,text='Cari semua MT5',command=self.scan).pack(side='right')
        grid=ttk.Frame(main);grid.pack(fill='both',expand=True,pady=15);grid.columnconfigure(1,weight=1);grid.columnconfigure(4,weight=2)
        for col,title in enumerate(['Slot / ID ZenCore','Akaun MT5 / Server','Pautan','EA / Reset','Status']):ttk.Label(grid,text=title,font=('Segoe UI',10,'bold')).grid(row=0,column=col,sticky='w',padx=5,pady=8)
        for n in range(1,11):
            login=tk.StringVar(value='ZCuser '+str(n));self.logins[n]=login
            cell=ttk.Frame(grid);cell.grid(row=n,column=0,sticky='w',padx=5,pady=10)
            ttk.Label(cell,text=str(n),width=2).pack(side='left');entry=ttk.Entry(cell,textvariable=login,width=20);entry.pack(side='left');self.login_entries[n]=entry
            value=tk.StringVar();self.choices[n]=value;combo=ttk.Combobox(grid,textvariable=value,state='readonly',width=40);combo.grid(row=n,column=1,sticky='ew',padx=5);self.options[n]=combo
            b=ttk.Button(grid,text='Pautkan',command=lambda k=n:self.action(k));b.grid(row=n,column=2,padx=4);self.buttons[n]=b
            tools=ttk.Frame(grid);tools.grid(row=n,column=3,padx=4)
            ttk.Button(tools,text='Folder MT5 / EA',command=lambda k=n:self.install(k)).pack(side='left')
            reset=ttk.Button(tools,text='Reset',command=lambda k=n:self.reset(k));reset.pack(side='left',padx=3);self.reset_buttons[n]=reset
            state=tk.StringVar(value='BELUM DIPAUTKAN');self.states[n]=state;ttk.Label(grid,textvariable=state,wraplength=330).grid(row=n,column=4,sticky='w',padx=5)
        ttk.Label(main,text='ON/OFF, lot, layer, waktu dan SOP dikawal melalui akaun web setiap user. Manager tidak mengaktifkan trading.').pack(anchor='w')
        ttk.Label(main,text='Jangan pautkan akaun MT5 yang sama kepada dua ID. EA menolak pertukaran akaun atau sesi yang tidak sepadan.').pack(anchor='w',pady=4)
        root.protocol('WM_DELETE_WINDOW',self.close)
        if not test_mode:
            self.scan();threading.Thread(target=self.manager.restore,daemon=True).start();root.after(150,self.pump)
    def scan(self):
        found=self.manager.discover();self.available={}
        for item in found:
            label=item['label']
            if label in self.available:label+=' • '+Path(item['channel']).name
            self.available[label]=item['channel']
        for n,c in self.options.items():c['values']=list(self.available)
        with self.manager.lock:configs=dict(self.manager.configs)
        for n,cfg in configs.items():
            label=cfg['tradeMode']+' • ****'+cfg['account'][-4:]+' • '+cfg['server'];self.choices[n].set(label);self.logins[n].set(cfg['zenCoreLogin']);self.login_entries[n].configure(state='readonly')
    def task(self,n,fn,stage="LINK"):
        if n in self.busy:return
        self.busy.add(n);self.buttons[n].configure(state='disabled');self.reset_buttons[n].configure(state='disabled');self.states[n].set('Memasang EA pada folder MT5...' if stage=='INSTALL' else 'Memproses...')
        def run():
            try:fn()
            except Exception as e:
                code=str(e) if isinstance(e,(RuntimeError,ValueError)) else 'CONNECTION_FAILED'
                safe={'PROFILE_RESET_PENDING','ZENCORE_USER_ALREADY_ASSIGNED','PROFILE_ALREADY_PAIRED','MT5_ALREADY_ASSIGNED','ZENCORE_USER_MISMATCH','EA_SESSION_CHANGED','EA_OFFLINE','ACCOUNT_CHANGED','OLD_CONNECTOR_ACTIVE','STOP_BEFORE_PAIRING','LINK_RESET_WAIT','CONNECTOR_STOP_PENDING','INVALID_CREDENTIALS','ACCOUNT_DISABLED','ACCOUNT_EXPIRED','CHANNEL_BINDING_INVALID'}
                self.events.put((n,install_error_message(e) if stage=='INSTALL' else RESET_MESSAGES.get(code,code if code in safe else 'PAUTAN GAGAL — semak login, EA dan sambungan')))
            finally:self.events.put((n,None))
        threading.Thread(target=run,daemon=True).start()
    def action(self,n):
        cfg=self.manager.configs.get(n)
        if cfg:
            if cfg.get('paused'):self.task(n,lambda:self.manager.start(n))
            else:self.task(n,lambda:self.manager.pause(n))
            return
        channel=self.available.get(self.choices[n].get());password=self.password.get();login=self.logins[n].get().strip()
        if not channel or not password or not login:self.states[n].set('Pilih akaun MT5 dan masukkan password ZenCore.');return
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
        selection=choose_mt5_install(self.root,'Slot '+str(n))
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
            if s is None:self.busy.discard(n)
            elif s=='RESET_CLEAR':self.choices[n].set('');self.logins[n].set('');self.states[n].set('RESET SELESAI — isi ID client baharu')
            else:self.states[n].set(s[:180])
            self.reset_buttons[n].configure(state='disabled' if n in self.busy else 'normal')
            cfg=self.manager.configs.get(n);self.login_entries[n].configure(state='readonly' if cfg or n in self.busy else 'normal');self.buttons[n].configure(text='Sambung' if cfg and cfg.get('paused') else 'Henti' if cfg else 'Pautkan',state='disabled' if n in self.busy else 'normal')
        self.root.after(150,self.pump)
    def close(self):
        if not messagebox.askyesno('Tutup Manager?','Semua 10 sambungan akan berhenti. SL broker yang sudah dipasang kekal aktif. Teruskan?'):return
        self.password.set('');self.manager.close();self.root.destroy()

def main():
    if sys.platform!='win32':raise SystemExit('Windows diperlukan.')
    if '--self-test' in sys.argv:
        sample=b'VPS manager packaging';assert dpapi(dpapi(sample),True)==sample;assert (RESOURCE/'ZenCoreExecutor.mq5').is_file()
        root=tk.Tk();app=App(root,test_mode=True);root.update();assert len(app.states)==10 and len(app.reset_buttons)==10 and len(app.logins)==10
        if '--preview' in sys.argv:
            from PIL import ImageGrab
            ImageGrab.grab(bbox=(root.winfo_rootx(),root.winfo_rooty(),root.winfo_rootx()+root.winfo_width(),root.winfo_rooty()+root.winfo_height())).save('dist/VPS-Manager-Preview.png')
        root.destroy();Path('dist/vps-validation.json').write_text(json.dumps({'ok':True,'managerVersion':VERSION,'slots':10,'eaVersion':EA_VERSION,'connectorBuild':CONNECTOR_BUILD,'dpapi':True}));return
    # Share the legacy Connector lock so two apps cannot write the same EA leases.
    INSTALL.mkdir(parents=True,exist_ok=True)
    import msvcrt
    lock=open(INSTALL/'instance.lock','a+b');lock.write(b'1');lock.flush();lock.seek(0)
    try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:raise SystemExit('Tutup Connector lama / Manager lain dahulu.')
    root=tk.Tk();App(root);root.mainloop()
if __name__=='__main__':main()
