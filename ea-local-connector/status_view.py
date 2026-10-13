"""Pure, credential-free status rendering for Connector 2.0."""
def status_cards(local=None, cloud=None, now_ms=0, paired=False):
    local=local or {};cloud=cloud or {}
    fresh=isinstance(local.get('writtenAt'),(int,float)) and -30000 <= now_ms-local['writtenAt'] <= 15000
    mt5=('MT5 ONLINE','good') if fresh else ('EA BELUM ONLINE','warn')
    if fresh and not local.get('terminalConnected',True):mt5=('BROKER OFFLINE','bad')
    heartbeat=cloud.get('lastCloudHeartbeatMs',0)
    cloud_fresh=isinstance(heartbeat,(int,float)) and heartbeat>0 and -30000 <= now_ms-heartbeat <= 12000
    server=('CLOUD ONLINE','good') if paired and cloud_fresh and cloud.get('consecutiveFailures',0)==0 else ('CLOUD MENUNGGU','warn')
    permission=fresh and all(local.get(k,False) for k in ('terminalTradeAllowed','accountTradeAllowed','expertTradeAllowed'))
    exact=local.get('executorPolicyVersion')=='EXACT_ANALYSIS_V2'
    enabled=cloud.get('desiredState')=='ON' and cloud_fresh and permission and exact and server[1]=='good'
    entry=('ENTRY DIBENARKAN','good') if enabled else ('ENTRY STOPPED','warn')
    if paired and fresh and not exact:entry=('KEMAS KINI EA 2.00','bad')
    if cloud.get('entryBlockedReason')=='GLOBAL_ENTRY_PAUSED':entry=('SERVER PAUSED','warn')
    return {'mt5':mt5,'cloud':server,'entry':entry}
