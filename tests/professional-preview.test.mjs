import test from 'node:test';
import assert from 'node:assert/strict';
import {professionalPreviewRows,renderProfessionalWorkbench} from '../public/professional-workbench.mjs';
import {parseDelimitedData} from '../public/document-viewer.mjs';

test('long solver preview retains the final time after document viewer parsing',()=>{
 const table={columns:['time','v(out)'],rows:Array.from({length:3342},(_,i)=>[i/334100,1-Math.exp(-i/334.1)]),rowCount:10022};
 const rows=professionalPreviewRows(table);
 assert.equal(rows.length,2000);
 assert.deepEqual(rows[0],table.rows[0]);
 assert.deepEqual(rows.at(-1),table.rows.at(-1));
 const parsed=parseDelimitedData('time,v(out)\n'+rows.map(row=>row.join(',')).join('\n'));
 assert.equal(parsed.rows.at(-1).time,0.01);
 assert.match(renderProfessionalWorkbench({tab:'result',result:{table}}),/完整结果 10022 行/);
 assert.match(renderProfessionalWorkbench({tab:'result',result:{table}}),/预览 2000 行/);
});
