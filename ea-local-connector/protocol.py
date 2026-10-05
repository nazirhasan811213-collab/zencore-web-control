"""Local EA transport. No MetaTrader Python API, broker password or network listener."""
import base64
import hashlib
import hmac
import json
import math
import os
import re
import time
from pathlib import Path

VERSION = '1.2.0-ea-local'
EA_VERSION = '1.21'
CONTRACT = 'ZENCORE_ANALYSIS_EXECUTION_V1'
STRATEGY = 'NORMAL_3M_SOP_V32'
SCHEMA = '32.3-EXIT-STEPLOCK'
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
SUPPORTED = ('XAUUSD','EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP')


def atomic_write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    with open(tmp, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def read_fields(path):
    fields = {}
    text = Path(path).read_text(encoding='utf-8-sig')
    if len(text) > 100000: raise ValueError('LOCAL_FILE_TOO_LARGE')
    for row in text.splitlines():
        if '\t' not in row: raise ValueError('INVALID_LOCAL_ROW')
        key, value = row.split('\t', 1)
        if key in fields: raise ValueError('DUPLICATE_LOCAL_FIELD')
        fields[key] = value
    return fields


def encode_fields(fields):
    def clean(value):
        text = str(value)
        if any(c in text for c in '\t\r\n\x00'): raise ValueError('INVALID_LOCAL_FIELD')
        return text
    return ''.join(clean(k) + '\t' + clean(v) + '\n' for k,v in fields.items())


def verified_command(command, signing_key, pod_id, now_ms=None):
    encoded = command.get('signedEnvelope', '')
    if len(encoded) > 100000: raise ValueError('ENVELOPE_TOO_LARGE')
    raw = base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4))
    # Server uses the UTF-8 base64url key string as the HMAC key, not decoded bytes.
    signature = hmac.new(signing_key.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, str(command.get('signature', ''))):
        raise ValueError('SIGNATURE_REJECTED')
    signed = json.loads(raw)
    for field in ('id','type','payload','createdAt','expiresAt'):
        if command.get(field) != signed.get(field): raise ValueError('ENVELOPE_MISMATCH')
    if signed.get('podId') != pod_id: raise ValueError('WRONG_POD')
    if not UUID.fullmatch(str(signed.get('id',''))): raise ValueError('INVALID_COMMAND_ID')
    now_ms = int(time.time()*1000) if now_ms is None else now_ms
    if not isinstance(signed.get('expiresAt'), (int,float)) or signed['expiresAt'] <= now_ms:
        raise ValueError('COMMAND_EXPIRED')
    if signed.get('createdAt', now_ms+1) > now_ms+30000: raise ValueError('CLOCK_SKEW')
    return signed


def number(value):
    if isinstance(value, bool): raise ValueError('INVALID_NUMBER')
    result = float(value)
    if not math.isfinite(result): raise ValueError('INVALID_NUMBER')
    return format(result, '.12g')


def command_fields(command, identity):
    kind = command['type']
    payload = command['payload']
    mode=payload.get('strategyMode','TF2_SCALPING')
    if mode not in ('TF2_SCALPING','TF15_INTRA'):raise ValueError('STRATEGY_MODE_REJECTED')
    if mode=='TF15_INTRA' and kind in ('PLACE_SETUP','MANAGE_POSITION'):
        if str(payload.get('analysisSnapshot',{}).get('executionTimeframe','')).replace('m','')!='15':raise ValueError('TF15_SNAPSHOT_REQUIRED')
    fields = {'strategyMode':mode,'protocol':1, 'id':command['id'], 'type':kind,
              'expiresAt':command['expiresAt'], 'account':identity['account'],
              'server':identity['server']}
    if kind == 'SYSTEM_ON':
        if payload.get('mode') != 'DEMO' or payload.get('strategy') != STRATEGY or payload.get('exitSchema') != SCHEMA:
            raise ValueError('SYSTEM_CONTRACT_REJECTED')
        settings = payload['settings']
        symbols = settings['symbols']
        if not symbols or any(s not in SUPPORTED for s in symbols): raise ValueError('INVALID_SYMBOLS')
        fields.update(symbols=','.join(symbols), lot=number(settings['lotPerLayer']), layers=int(settings['layers']))
    elif kind in ('PLACE_SETUP', 'MANAGE_POSITION'):
        snap = payload.get('analysisSnapshot', {})
        decision = 'ENTRY_AUTHORIZED' if kind == 'PLACE_SETUP' else 'POSITION_ACTION_AUTHORIZED'
        if (payload.get('analysisContractVersion') != CONTRACT or snap.get('contractVersion') != CONTRACT or
            payload.get('strategy') != STRATEGY or payload.get('schemaVersion') != SCHEMA or
            snap.get('decisionOwner') != 'ZENCORE_ANALYSIS' or snap.get('decision') != decision):
            raise ValueError('ANALYSIS_CONTRACT_REJECTED')
        symbol = payload.get('symbol')
        if symbol not in SUPPORTED or snap.get('symbol') != symbol: raise ValueError('SYMBOL_REJECTED')
        fields['symbol'] = symbol
        if kind == 'PLACE_SETUP':
            for key in ('side','entry','sl','tp1','tp2','tp3'):
                if snap.get(key) != payload.get(key): raise ValueError('ANALYSIS_PRICE_MISMATCH')
            if payload['side'] not in ('BUY','SELL'): raise ValueError('SIDE_REJECTED')
            fields['side'] = payload['side']
            for key in ('entry','sl','tp1','tp2','tp3'): fields[key] = number(payload[key])
            fields['lot'] = number(payload['lotPerLayer'])
            fields['layers'] = int(payload['layers'])
            policy=payload.get('exitPolicy')
            if policy is not None:
                if (payload.get('strategyMode')!='TF2_SCALPING' or policy.get('version')!='TF2_TIGHT_SL_3C_V1' or
                    policy.get('slDistanceFactor')!=.8 or policy.get('maxCompletedCandlesWithoutTp1')!=3 or policy.get('timeframeMinutes')!=2):
                    raise ValueError('EXIT_POLICY_REJECTED')
                fields['exitPolicyVersion']='TF2_TIGHT_SL_3C_V1' 
        else:
            actions = payload.get('actions')
            if actions != snap.get('actions') or not actions or len(actions)>4: raise ValueError('ACTIONS_REJECTED')
            fields['actions'] = len(actions)
            for i, action in enumerate(actions):
                typ = action['type']
                if typ not in ('MOVE_SL_ENTRY','MOVE_SL_TP1','MOVE_SL_TP2','CLOSE_PERCENT'): raise ValueError('ACTION_REJECTED')
                fields[f'a{i}type'] = typ
                if typ == 'CLOSE_PERCENT':
                    if action['percent'] not in (50,100): raise ValueError('PERCENT_REJECTED')
                    fields[f'a{i}value'] = action['percent']
                    fields[f'a{i}reason'] = action.get('reason','')
                else: fields[f'a{i}value'] = number(action['activeSl'])
    elif kind not in ('SYSTEM_STOP','EMERGENCY_CLOSE_ALL'):
        raise ValueError('TYPE_REJECTED')
    return fields


def heartbeat(fields, selected_identity, now_ms=None):
    now_ms = int(time.time()*1000) if now_ms is None else now_ms
    if now_ms - int(fields['writtenAt']) > 15000 or int(fields['writtenAt']) > now_ms+30000:
        raise ValueError('EA_OFFLINE')
    if fields['account'] != selected_identity['account'] or fields['server'] != selected_identity['server']:
        raise ValueError('ACCOUNT_CHANGED')
    if fields['tradeMode'] != 'DEMO': raise ValueError('DEMO_ONLY')
    value = {
      'accountMask':'****'+fields['account'][-4:], 'serverMask':'****'+re.sub(r'[^A-Za-z0-9._-]','',fields['server'])[-8:],
      'brokerMask':'****MT5', 'tradeMode':'DEMO', 'connectorVersion':VERSION if fields.get('strategyExecutionVersion')=='TF2_TF15_V1' else ('1.1.0-ea-local' if fields.get('exitPolicyVersion')=='TF2_TIGHT_SL_3C_V1' else '1.0.0-ea-local'),
      'terminalBuild':fields['terminalBuild'], 'terminalTradeAllowed':fields['terminalTradeAllowed']=='1',
      'accountTradeAllowed':fields['accountTradeAllowed']=='1', 'expertTradeAllowed':fields['expertTradeAllowed']=='1',
      'demoExecutionUnlocked':True, 'positions':[], 'symbolSpecs':[]
    }
    for i in range(min(int(fields.get('specCount',0)),len(SUPPORTED))):
        prefix = f's{i}'
        value['symbolSpecs'].append({key:(fields[prefix+key] if key=='symbol' else float(fields[prefix+key]))
          for key in ('symbol','tickSize','tickValue','volumeMin','volumeMax','volumeStep')})
    for i in range(min(int(fields.get('positionCount',0)),50)):
        prefix = f'p{i}'
        position = {'strategyMode':fields.get(prefix+'strategyMode','TF2_SCALPING'),'ticket':fields[prefix+'ticket'], 'symbol':fields[prefix+'symbol'], 'side':fields[prefix+'side']}
        for key in ('volume','entry','currentPrice','activeSl','profitUsd','openedAt'):
            position[key] = float(fields[prefix+key])
        value['positions'].append(position)
    return value
