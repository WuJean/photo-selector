import test from 'node:test';import assert from 'node:assert/strict';import {immersiveGroups,zoomAround} from '../shared/immersive.mjs';import {STATUS_LABELS} from '../shared/domain.mjs';
test('immersive sequence unfolds similar photos and preserves independent neighbors',()=>{
 const groups=immersiveGroups([{id:'a',similarId:'g'},{id:'b',similarId:'g'},{id:'c'},{id:'d'}]);assert.equal(groups.length,3);assert.equal(groups[0].kind,'similar');assert.deepEqual(groups[0].photos.map(p=>p.id),['a','b']);assert.equal(groups[1].kind,'single');assert.equal(groups[2].photos[0].id,'d');assert.deepEqual(Object.values(STATUS_LABELS),['待定','保留','不要']);
});
test('cursor-centered zoom preserves focus and reset clears translation',()=>{
 assert.deepEqual(zoomAround({zoom:1,x:0,y:0},2,{x:50,y:20}),{zoom:2,x:-50,y:-20});assert.deepEqual(zoomAround({zoom:3,x:-50,y:99},.5,{x:0,y:0}),{zoom:1,x:0,y:0});assert.equal(zoomAround({zoom:1,x:0,y:0},20,{x:0,y:0}).zoom,8);
});
