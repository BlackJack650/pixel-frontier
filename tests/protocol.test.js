import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE, validateCommand } from '../shared/protocol.js';

function attack(percent){return{t:MESSAGE.CMD,cmdId:'test',type:'ATTACK',payload:{fromRegions:[0],toRegionId:1,percent}};}
test('attack validation rejects NaN, Infinity and out-of-range percentages',()=>{
  assert.equal(validateCommand(attack(NaN)),'BAD_PERCENT');assert.equal(validateCommand(attack(Infinity)),'BAD_PERCENT');
  assert.equal(validateCommand(attack(-1)),'BAD_PERCENT');assert.equal(validateCommand(attack(101)),'BAD_PERCENT');
  assert.equal(validateCommand(attack(0)),null);assert.equal(validateCommand(attack(100)),null);
});
test('command schema rejects malformed sources and unknown commands',()=>{
  const bad=attack(50);bad.payload.fromRegions=[];assert.equal(validateCommand(bad),'BAD_SOURCE');
  assert.equal(validateCommand({t:MESSAGE.CMD,cmdId:'x',type:'SET_TROOPS',payload:{troops:1e9}}),'BAD_COMMAND');
});
test('chat length and command ids are bounded',()=>{
  assert.equal(validateCommand({t:MESSAGE.CMD,cmdId:'x',type:'CHAT',payload:{text:'x'.repeat(201)}}),'BAD_CHAT');
  assert.equal(validateCommand({t:MESSAGE.CMD,cmdId:'x'.repeat(65),type:'PING',payload:{}}),'BAD_COMMAND_ID');
});
