'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),R=require('../record-retention');
const at=s=>Date.parse(s+'+08:00');
test('record history starts exactly 1 November MYT and retains two calendar months',()=>{
 a.equal(R.START_AT,Date.parse('2026-10-31T16:00:00Z'));
 a.equal(R.cutoffAt(at('2026-11-04T08:00:00')),R.START_AT);
 a.equal(R.cutoffAt(at('2027-01-01T00:00:00')),R.START_AT);
 a.equal(R.cutoffAt(at('2027-01-02T00:00:00')),at('2026-11-02T00:00:00'));
 a.equal(R.cutoffAt(at('2027-04-30T12:30:00')),at('2027-02-28T12:30:00'));
 a.equal(R.cutoffAt(at('2028-04-30T12:30:00')),at('2028-02-29T12:30:00'));
 a.equal(R.metadata(at('2027-01-02T00:00:00')).basis,'ENTRY_TIME');
 a.throws(()=>R.cutoffAt(NaN));
});
