import { useEffect, useRef, useState } from 'react'
import { Cube, Plus, Stack } from '@phosphor-icons/react'
export function InventoryAddButton({ onProduct, onBundle }: { onProduct: () => void; onBundle: () => void }) {
 const [open,setOpen]=useState(false)
 const root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null), menu=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  if(!open) return
  menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}}
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
 },[open])
 const act=(action:()=>void)=>{setOpen(false);action()}
 return <div className="inventory-add" ref={root}>
  <button className="ledger-fab inventory-fab" ref={trigger} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Plus />Add</button>
  {open&&<div className="inventory-action-menu" role="menu" aria-label="Add to inventory" ref={menu} onKeyDown={event=>{
   if(event.key==='Tab'){setOpen(false);return}
   if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
   event.preventDefault()
   const buttons=[...menu.current!.querySelectorAll<HTMLButtonElement>('button')]
   const current=buttons.indexOf(document.activeElement as HTMLButtonElement)
   buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+1)%buttons.length]?.focus()
  }}><button role="menuitem" onClick={()=>act(onProduct)}><Cube />Add product</button><button role="menuitem" onClick={()=>act(onBundle)}><Stack />Add bundle</button></div>}
 </div>
}
