'use server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requireRole,getCurrentUserAccess} from '@/lib/auth/session';
import {createAdminClient} from '@/lib/supabase/admin';
import {randomUUID} from 'node:crypto';
export async function manageClientOwner(form:FormData) {
 await requireRole(['super_admin'],{module:'admin_setup',level:'manage'});
 const {user}=await getCurrentUserAccess();
 const str=(key:string)=>String(form.get(key)??'').trim();
 const owner=str('owner_id');let action=str('action');
 if(!/^[0-9a-f-]{36}$/i.test(owner)) redirect('/admin-setup/client-owners?error=owner');
 if(str('confirm')!=='yes') redirect(`/admin-setup/client-owners?owner=${owner}&error=confirm`);
 const data:Record<string,string|boolean>={};
 for(const [key,value] of form.entries()) if(typeof value==='string'&&!['action','owner_id','confirm'].includes(key)&&!key.startsWith('$ACTION')) data[key]=value.trim();
 data.enabled=form.get('enabled')==='yes';data.chargeable=form.get('chargeable')==='yes';
 const db=createAdminClient();
 let newFile:string|undefined;
 if(action==='upload_document') {
  const file=form.get('file');
  if(!(file instanceof File)||!file.size||file.size>3*1024*1024) redirect(`/admin-setup/client-owners?owner=${owner}&error=file`);
  const bytes=Buffer.from(await file.arrayBuffer());
  const kind=bytes.subarray(0,5).toString()==='%PDF-'?{mime:'application/pdf',ext:'pdf'}:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?{mime:'image/png',ext:'png'}:bytes[0]===255&&bytes[1]===216&&bytes[2]===255?{mime:'image/jpeg',ext:'jpg'}:null;
  if(!kind) redirect(`/admin-setup/client-owners?owner=${owner}&error=file`);
  newFile=`${owner}/${randomUUID()}.${kind.ext}`;
  const {error:uploadError}=await db.storage.from('owner-portal-files').upload(newFile,bytes,{contentType:kind.mime,upsert:false});
  if(uploadError) redirect(`/admin-setup/client-owners?owner=${owner}&error=upload`);
  action='document';data.bucket='owner-portal-files';data.path=newFile;data.mime=kind.mime;
 }
 const {error}=await db.rpc('manage_client_owner',{p_actor:user.id,p_owner:owner,p_action:action,p_data:data});
 if(error) {
  // Remove only this request's brand-new orphan; never an existing shared file.
  if(newFile) await db.storage.from('owner-portal-files').remove([newFile]);
  redirect(`/admin-setup/client-owners?owner=${owner}&error=save`);
 }
 revalidatePath('/owner','layout'); revalidatePath('/admin-setup/client-owners');
 redirect(`/admin-setup/client-owners?owner=${owner}&saved=yes`);
}
