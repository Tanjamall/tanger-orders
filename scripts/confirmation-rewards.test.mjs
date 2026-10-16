import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const compiled=ts.transpileModule(await readFile(new URL('../src/domain/orders.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const { confirmationBonusFor }=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const employee={id:'e1',name:'Amina',bonus:5,bonusBasis:'per_item',active:true}
const products=[{id:'lamp',price:100},{id:'box',price:50}]
test('confirmation earns fixed bonus plus the positive price difference per unit',()=>{
 assert.equal(confirmationBonusFor(employee,[{productId:'lamp',quantity:1,unitPrice:110}],products),15)
 assert.equal(confirmationBonusFor(employee,[{productId:'lamp',quantity:2,unitPrice:110}],products),30)
 assert.equal(confirmationBonusFor({...employee,bonusBasis:'per_order'},[{productId:'lamp',quantity:2,unitPrice:110}],products),25)
 assert.equal(confirmationBonusFor(employee,[{productId:'lamp',quantity:2,unitPrice:110},{productId:'box',quantity:1,unitPrice:40}],products),35)
})
test('base price is read from the product and discounts cannot reduce fixed rewards',()=>{
 assert.equal(confirmationBonusFor(employee,[{productId:'lamp',quantity:1,unitPrice:90}],products),5)
 assert.equal(confirmationBonusFor(employee,[{productId:'lamp',quantity:1,unitPrice:110}],[{id:'lamp',price:105}]),10)
 assert.equal(confirmationBonusFor(undefined,[{productId:'lamp',quantity:1,unitPrice:110}],products),0)
 assert.equal(confirmationBonusFor(employee,[{productId:'missing',quantity:1,unitPrice:110}],products),5)
 assert.equal(confirmationBonusFor(employee,[{productId:'lamp',quantity:3,unitPrice:100.1}],products),15.3)
})
