'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Policy, PolicyState } from '@/lib/types';
import { CheckCircle2, Ban, RotateCcw, Trash2 } from 'lucide-react';
export function PolicyActions({scope,id,policy}:{scope:'node'|'network'; id:string; policy:Policy}) {
  const router = useRouter(), [reason,setReason]=useState(policy.reason||''), [working,setWorking]=useState(false), [error,setError]=useState('');
  async function update(status:PolicyState) {
    if (status==='BLOCK'&&!window.confirm(`Record BLACKLIST advisory for ${scope} ${id}? This does not disable plugins.`)) return;
    const message = status==='NONE'?'Cleared by administrator':reason.trim()||'Manual review by administrator';
    setWorking(true);setError('');
    try {const r=await fetch('/api/console/policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,id,status,reason:message})});if(!r.ok)throw Error('Unable to save decision');router.refresh();}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setWorking(false);}
  }
  return <div className="p-5"><label className="block text-xs font-semibold text-[#aeb9c5] mb-2" htmlFor={`reason-${scope}`}>Administrative note / reason</label><textarea id={`reason-${scope}`} className="textarea w-full bg-[#0e131a] border-[#303948] h-20" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Evidence, context, or review note"/>
  <p className="text-xs text-[#91a0b2] mt-2">These labels are advisory. No plugin shutdown or license revocation occurs.</p><div className="flex flex-wrap gap-2 mt-4"><button disabled={working} onClick={()=>update('ALLOW')} className="btn btn-sm border-[#21533d] bg-[#16462f] text-[#9ff0ba] hover:bg-[#23623f]"><CheckCircle2 size={14}/> Whitelist</button><button disabled={working} onClick={()=>update('BLOCK')} className="btn btn-sm border-[#67313b] bg-[#46252b] text-[#ffa1a1] hover:bg-[#6b3238]"><Ban size={14}/> Blacklist</button><button disabled={working} onClick={()=>update('NONE')} className="flat-action"><RotateCcw size={14}/> Clear</button></div>{error&&<p role="alert" className="text-error mt-2 text-xs">{error}</p>}</div>
}
export function ReviewActions({productId,installationId,current}:{productId:string; installationId:string; current:PolicyState}) {
  const router=useRouter(),[status,setStatus]=useState<PolicyState>(current),[reason,setReason]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  async function submit(){setSaving(true);setError('');try{const r=await fetch('/api/console/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId,installationId,status,reason:reason.trim()||'Admin review'})});if(!r.ok)throw Error('Review could not be saved');router.refresh();}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setSaving(false)}}
  return <div className="flex flex-wrap items-center gap-2"><select aria-label="Review status" className="select select-xs bg-[#131a23] border-[#344050]" value={status} onChange={e=>setStatus(e.target.value as PolicyState)}><option>NONE</option><option>REVIEW</option><option>ALLOW</option><option>BLOCK</option></select><input aria-label="Review reason" className="input input-xs bg-[#131a23] border-[#344050] w-44" maxLength={500} placeholder="Reason" value={reason} onChange={e=>setReason(e.target.value)}/><button disabled={saving} className="btn btn-xs bg-[#fa6044] text-black border-0" onClick={submit}>Save</button>{error&&<span role="alert" className="text-error text-xs">{error}</span>}</div>
}
export function DeletePlayer({uuid}:{uuid:string}){
  const router=useRouter(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function remove(){if(!window.confirm('Permanently delete this stored player profile and its node associations?'))return;setBusy(true);try{const r=await fetch('/api/console/delete-player',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uuid})});if(!r.ok)throw Error('Delete failed');router.push('/players');router.refresh();}catch(e){setError(e instanceof Error?e.message:'Error');setBusy(false)}}
  return <div><button disabled={busy} onClick={remove} className="btn btn-outline btn-error btn-sm"><Trash2 size={15}/> Delete player data</button>{error&&<p role="alert" className="text-error text-xs mt-2">{error}</p>}</div>
}
