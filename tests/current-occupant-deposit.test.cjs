const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
Module._extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const { depositBelongsToOccupant } = require('../lib/payments/current-occupant-deposit.ts');
const occupant = {roomId:'klb17',tenancyId:'current',tenantRecordId:'current-record'};
const row = (values = {}) => ({room_id:'klb17',tenancy_id:null,tenant_record_id:null,...values});
test('KLB 17: previous tenant RM100 + RM100 does not clear the new tenant RM200 deposit',()=>{
  const deposits = [row({tenancy_id:'previous',amount:100}),row({tenancy_id:'previous',amount:100})];
  const received = deposits.filter(p=>depositBelongsToOccupant(p,occupant)).reduce((sum,p)=>sum+p.amount,0);
  assert.equal(received,0); assert.equal(200-received,200);
});
test('current tenancy payments count, including a transfer retaining the tenancy identity',()=>{
  assert.equal(depositBelongsToOccupant(row({tenancy_id:'current'}),occupant),true);
});
test('legacy record-linked deposits count only for the active tenant record',()=>{
  assert.equal(depositBelongsToOccupant(row({tenant_record_id:'current-record'}),occupant),true);
  assert.equal(depositBelongsToOccupant(row({tenant_record_id:'old-record'}),occupant),false);
});
test('wrong tenancy cannot override itself with a matching record or room',()=>{
  assert.equal(depositBelongsToOccupant(row({tenancy_id:'previous',tenant_record_id:'current-record'}),occupant),false);
  assert.equal(depositBelongsToOccupant(row(),occupant),false);
  assert.equal(depositBelongsToOccupant(row({room_id:'other',tenancy_id:'current'}),occupant),false);
});
test('both canonical deposits and verified-slip fallback are filtered before room aggregation',()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../lib/data/property-details.ts'),'utf8');
  assert.match(source,/depositBelongsToOccupant\(payment, occupant\)/);
  assert.match(source,/depositBelongsToOccupant\(submission, occupant\)/);
  assert.match(source,/verifiedDepositByRoom.get\(room.id\) \?\?\s*verifiedSubmissionDepositByRoom.get\(room.id\)/);
});
