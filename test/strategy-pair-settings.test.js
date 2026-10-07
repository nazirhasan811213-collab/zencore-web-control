const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../auto-trade-core');
const {MemoryAutoTradeStore, PostgresAutoTradeStore} = require('../auto-trade-store');
const {createAutoTradeService} = require('../auto-trade-service');
const settings = overrides => ({capitalUsd:1000, lotPerLayer:0.01, layers:3, symbols:Core.SUPPORTED_MARKETS,
  strategyMode:'TF2_SCALPING', modeSettings:{TF2_SCALPING:{gold:{lotPerLayer:0.01,layers:3},fx:{lotPerLayer:0.02,layers:1}},
    TF15_INTRA:{gold:{lotPerLayer:0.03,layers:2},fx:{lotPerLayer:0.04,layers:2}}},
  pairSpreadLimits:{XAUUSD:0.4,GBPUSD:0.00012,USDJPY:0.015}, ...overrides});
const market = symbol => ({symbol,timeframe:'2',receivedAt:1791000000000,strategyNormal:{state:'READY',tf:'2m',
  side:'BUY',solid:true,entrySopVersion:'SOLID_TF2_3GREEN_HEMA23_V2',sop:{gates:Array.from({length:6},()=>({pass:true}))},
  plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}}});

test('migrates old settings to both strategies and groups without resetting old lots',()=>{
  const {value,ok}=Core.validateSettings({capitalUsd:500,lotPerLayer:0.05,layers:4,symbols:['GBPUSD']});
  assert.equal(ok,true); assert.equal(value.strategyMode,'TF2_SCALPING');
  assert.deepEqual(value.modeSettings.TF2_SCALPING.fx,{lotPerLayer:0.05,layers:4});
  assert.deepEqual(value.modeSettings.TF15_INTRA.gold,{lotPerLayer:0.05,layers:2});
});
test('Gold and currency commands use independent volume without any spread ceilings',()=>{
  const gold=Core.buildSetupCommand(market('XAUUSD'),settings()).payload;
  const fx=Core.buildSetupCommand(market('GBPUSD'),settings()).payload;
  assert.equal(gold.lotPerLayer,0.01); assert.equal(gold.layers,3); assert.equal(gold.totalLot,0.03);
  assert.equal(fx.lotPerLayer,0.02); assert.equal(fx.layers,1); assert.equal(fx.totalLot,0.02);
  assert.equal('maxSpreadPrice' in gold,false); assert.equal('maxSpreadPrice' in fx,false);
  assert.equal('pairSpreadLimits' in Core.validateSettings(settings()).value,false);
});
test('TF15 volume is exactly two layers and cannot consume TF2 or fake TF15 feed',()=>{
  const config=Core.validateSettings(settings({strategyMode:'TF15_INTRA'}));
  assert.equal(Core.effectiveSettings(config.value,'GBPJPY').layers,2);
  assert.equal(Core.effectiveSettings(config.value,'XAUUSD').totalLot,0.06);
  assert.equal(Core.buildSetupCommand(market('GBPUSD'),config.value),null);
  assert.equal(Core.buildSetupCommand({...market('GBPUSD'),timeframe:'10'},config.value),null);
});
test('invalid mode, out-of-range TF15 layers, invalid group lot are rejected',()=>{
  for (const input of [settings({strategyMode:'BUY'}), settings({modeSettings:{TF15_INTRA:{fx:{lotPerLayer:.01,layers:11}}}}),
    settings({modeSettings:{TF2_SCALPING:{fx:{lotPerLayer:0,layers:2}}}})]) {
    assert.equal(Core.validateSettings(input).ok,false);
  }
});
test('memory store saves mode/group settings per user and survives profile control updates',async()=>{
  const store=new MemoryAutoTradeStore();
  await store.saveSettings('owner',Core.validateSettings(settings()).value);
  await store.saveSettings('other',Core.validateSettings(settings({strategyMode:'TF15_INTRA'})).value);
  await store.setControl('owner',{desiredState:'STOPPED',effectiveState:'STOPPED'});
  assert.equal((await store.getProfile('owner')).modeSettings.TF2_SCALPING.fx.lotPerLayer,.02);
  assert.equal((await store.getProfile('other')).strategyMode,'TF15_INTRA');
  assert.equal('pairSpreadLimits' in (await store.getProfile('owner')),false);
});
test('PostgreSQL writes and reads the same JSON configuration',async()=>{
  const store=new PostgresAutoTradeStore('postgres://localhost/test');
  const config=Core.validateSettings(settings()).value;
  store.pool={query:async(sql,args)=>{
    assert.match(sql,/execution_settings = EXCLUDED.execution_settings/);
    return {rows:[{user_id:args[0],capital_usd:args[1],lot_per_layer:args[2],layers:args[3],
      symbols:JSON.parse(args[4]),execution_settings:JSON.parse(args[6])}]};
  }};
  const saved=await store.saveSettings('owner',config);
  assert.deepEqual(saved.modeSettings,config.modeSettings); assert.equal('pairSpreadLimits' in saved,false);
});
test('service returns saved strategy configuration and refuses strategy switch during active trading',async()=>{
  const store=new MemoryAutoTradeStore();
  const service=createAutoTradeService({store,allowDemoExecution:true,commandSigningKey:'test-key-long-enough-for-thirty-two-characters'});
  const saved=await service.saveSettings('owner',{...settings(),riskAcknowledged:true});
  assert.equal(saved.settings.modeSettings.TF2_SCALPING.fx.lotPerLayer,.02);
  await store.setControl('owner',{desiredState:'ON',effectiveState:'ON'});
  await assert.rejects(service.saveSettings('owner',{...settings({strategyMode:'TF15_INTRA'}),riskAcknowledged:true}),error=>error.code==='STOP_BEFORE_STRATEGY_CHANGE');
  await store.setControl('owner',{desiredState:'STOPPED',effectiveState:'STOPPED'});
  const updated=await service.saveSettings('owner',{...settings({strategyMode:'TF15_INTRA'}),riskAcknowledged:true});
  assert.equal(updated.settings.strategyMode,'TF15_INTRA');
  await assert.rejects(service.turnOn('owner',{confirmation:'AKTIFKAN DEMO'}),error=>error.code==='EA_STRATEGY_UPGRADE_REQUIRED');
});
