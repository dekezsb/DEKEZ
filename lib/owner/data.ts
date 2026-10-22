import 'server-only';
import {cache} from 'react';
import {redirect, notFound} from 'next/navigation';
import {getCurrentUserAccess} from '@/lib/auth/session';
import {createClient} from '@/lib/supabase/server';
import {ownerMonth, type OwnerSnapshot} from './model';

export const ownerSnapshot = cache(async (monthInput?: string, propertyInput?: string) => {
 const context=await getCurrentUserAccess();
 if(context.role!=='client_owner') redirect('/dashboard');
 const month=ownerMonth(monthInput), property=propertyInput || '';
 if(property && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(property)) notFound();
 const db=await createClient();
 // Database RPC derives owner_id from the verified JWT; never accepts an owner ID.
 const {data,error}=await db.rpc('client_owner_snapshot',{p_month:`${month}-01`,p_property:property||null});
 if(error) { if(error.code==='42501') notFound(); throw new Error('Unable to load owner information. Please try again.'); }
 const email=context.user.email?.endsWith('@auth.dekez.invalid')?'':context.user.email??'';
 return {data:data as OwnerSnapshot,month,property,email,ownerId:context.user.id};
});
