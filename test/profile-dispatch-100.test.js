const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService}=require('../auto-trade-service');
const {readyMarket}=require('./fixtures/current-market');
const SIGNING_KEY='test-signing-key-that-is-longer-than-thirty-two-bytes';
const LEGACY_WINDOWS_CONNECTOR='1.4.0-demo-execution';
test('100 profiles receive isolated entry commands despite one slow account', async () => {
  let currentTime = 1_790_200_000_000;
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({
    store,
    commandSigningKey: SIGNING_KEY,
    allowDemoExecution: true,
    requiredDemoConnectorVersion: LEGACY_WINDOWS_CONNECTOR,
    allowedDemoOwnershipModes: ['INTERNAL_DEMO'],
    allowedDemoSymbols: ['XAUUSD'],
    now: () => currentTime
  });
  const users = Array.from({length:100},(_,i)=>({id:crypto.randomUUID(),lotPerLayer:i%2?0.02:0.01,layers:2,accountMask:'****'+String(i).padStart(4,'0')}));
  for (const user of users) {
    const pod = await service.connectLocalEa(user.id);
    user.token = pod.podToken;
    await service.heartbeat(user.token, {
      accountMask: user.accountMask,
      serverMask: '****Demo',
      brokerMask: '****Stellar',
      tradeMode: 'DEMO',
      terminalTradeAllowed: true,
      accountTradeAllowed: true,
      expertTradeAllowed: true,
      demoExecutionUnlocked: true,
      connectorVersion: '1.3.0-ea-local',
      terminalBuild: '5000',
      symbolSpecs: [
        { symbol: 'XAUUSD', tickSize: 0.01, tickValue: 1, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 },
        { symbol: 'EURUSD', tickSize: 0.00001, tickValue: 1, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 }
      ],
      positions: []
    });
    const saved = await service.saveSettings(user.id, {
      capitalUsd: 1000,
      lotPerLayer: user.lotPerLayer,
      layers: user.layers,
      symbols: ['XAUUSD'],
      riskAcknowledged: true
    });
    assert.deepEqual(saved.settings.symbols, ['XAUUSD']);
    await service.turnOn(user.id, { confirmation: 'AKTIFKAN DEMO' });
    const on = await service.nextCommand(user.token);
    await service.acknowledgeCommand(user.token, on.command.id, {
      status: 'EXECUTED', code: 'POOL_ARMED'
    });
  }

  const markets = [
    {
      symbol: 'XAUUSD', receivedAt: currentTime,
      strategyNormal: { state: 'READY', side: 'BUY', plan: {
        entry: 2500, sl: 2495, tp1: 2505, tp2: 2510, tp3: 2515
      } }
    },
    {
      symbol: 'EURUSD', receivedAt: currentTime + 1,
      strategyNormal: { state: 'READY', side: 'SELL', plan: {
        entry: 1.1, sl: 1.101, tp1: 1.099, tp2: 1.098, tp3: 1.097
      } }
    }
  ];
  for(const m of markets)Object.assign(m,readyMarket({at:m.receivedAt,symbol:m.symbol,side:m.strategyNormal.side,plan:m.strategyNormal.plan}));
  const getPod=store.getPodForUser.bind(store),append=store.appendAudit.bind(store);
  let release,otherQueued=false,timedOut=false;
  const gate=new Promise(resolve=>{release=resolve;});
  store.getPodForUser=async id=>{if(id===users[0].id)await gate;return getPod(id);};
  store.appendAudit=async (id,event,data)=>{
    const result=await append(id,event,data);
    if(event==='SETUP_QUEUED'&&id!==users[0].id){otherQueued=true;release();}
    return result;
  };
  const timeout=setTimeout(()=>{timedOut=true;release();},2000);
  try { assert.deepEqual(await service.dispatchMarkets(markets), { queued: 100 }); }
  finally {clearTimeout(timeout);release();}
  assert.equal(otherQueued,true);assert.equal(timedOut,false,'other users must progress while first account is waiting');


  for (const user of users) {
    const first = await service.nextCommand(user.token);
    await service.acknowledgeCommand(user.token, first.command.id, {
      status: 'EXECUTED', code: 'SETUP_ACCEPTED'
    });
    assert.equal(first.command.payload.symbol,'XAUUSD');
    assert.equal(first.command.payload.lotPerLayer, user.lotPerLayer);
    assert.equal(first.command.payload.layers, user.layers);
    assert.equal(first.command.payload.totalLot, user.lotPerLayer * user.layers);
  }
  assert.deepEqual(await service.dispatchMarkets(markets), { queued: 0 });
  const visited=new Set();
  store.getPodForUser=async id=>{visited.add(id);if(id===users[0].id)throw new Error('simulated account lookup failure');return getPod(id);};
  await assert.rejects(()=>service.dispatchMarkets(markets),AggregateError);
  assert.equal(visited.size,100,'one failed account must not skip later accounts');
});
