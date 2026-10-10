import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/domain/variants.ts', import.meta.url),'utf8')
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const { validateVariants, formOrderItem, orderItemName, variantStockTransition } = await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const product = { id:'p1',name:'Lamp',cost:40,price:100,stock:5,lowStockAt:1,variantName:'Color',variants:[{id:'red',label:'Red',stock:2},{id:'black',label:'Black',stock:3}] }
const order = { id:'o1', status:'New',items:[{productId:'p1',quantity:2,unitPrice:100,variantId:'red',variantLabel:'Red',variantName:'Color'}] }
function values(data){const result=new FormData(); for(const [key,value] of Object.entries(data))result.set(key,String(value));return result}

test('variant names are trimmed and duplicates and invalid quantities are rejected',()=>{
 assert.equal(validateVariants([{id:'red',label:' Red ',stock:1}])[0].label,'Red')
 for(const variants of [[{id:'1',label:'Red',stock:1},{id:'2',label:' red ',stock:0}],[{id:'1',label:'',stock:0}],[{id:'1',label:'Red',stock:-1}],[{id:'1',label:'Red',stock:1.5}]])assert.throws(()=>validateVariants(variants))
})
test('order selection requires a valid variant and preserves historical labels and zero custom prices',()=>{
 assert.throws(()=>formOrderItem(product,values({quantity:1,variantId:''})),/Choose a color/)
 assert.throws(()=>formOrderItem(product,values({quantity:1,variantId:'missing'})),/Choose|available/)
 assert.throws(()=>formOrderItem(product,values({quantity:1.5,variantId:'red'})),/whole/)
 const previous={...order.items[0],variantLabel:'Old red'}
 const item=formOrderItem(product,values({quantity:2,variantId:'red',price:0}),previous)
 assert.equal(item.unitPrice,0);assert.equal(item.variantLabel,'Old red');assert.equal(orderItemName(item,[product]),'Lamp · Old red')
 assert.equal(formOrderItem({...product,variants:[]},values({quantity:1})).unitPrice,100)
})
test('pending orders do not consume stock; delivery and reopening change only the chosen variant',()=>{
 assert.equal(variantStockTransition([product],undefined,order)[0].stock,5)
 const delivered={...order,status:'Delivered'}
 const after=variantStockTransition([product],order,delivered)
 assert.equal(after[0].stock,3);assert.equal(after[0].variants[0].stock,0);assert.equal(after[0].variants[1].stock,3)
 const repeated=variantStockTransition(after,delivered,delivered)
 assert.deepEqual(repeated,after)
 assert.deepEqual(variantStockTransition(after,delivered,{...order,status:'Canceled'}),[product])
 assert.equal(product.stock,5)
})
test('editing a delivered variant restores the old count before consuming the new count',()=>{
 const delivered={...order,status:'Delivered'}
 const after=variantStockTransition([product],undefined,delivered)
 const switched={...delivered,items:[{...delivered.items[0],variantId:'black',variantLabel:'Black',quantity:1}]}
 const result=variantStockTransition(after,delivered,switched)[0]
 assert.equal(result.stock,4);assert.equal(result.variants[0].stock,2);assert.equal(result.variants[1].stock,2)
 assert.throws(()=>variantStockTransition(after,delivered,{...switched,items:[{...switched.items[0],quantity:4}]}),/Not enough/)
 assert.equal(after[0].variants[1].stock,3)
})
test('older delivered orders reopen into explicit unspecified stock and cannot be delivered without a variant',()=>{
 const legacy={...order,status:'Delivered',items:[{productId:'p1',quantity:1,unitPrice:100}]}
 const reopened=variantStockTransition([product],legacy,{...legacy,status:'New'})
 assert.equal(reopened[0].variants.find(v=>v.id==='legacy').stock,1)
 assert.equal(reopened[0].stock,6)
 assert.throws(()=>variantStockTransition(reopened,undefined,legacy),/choose a variant/)
})
