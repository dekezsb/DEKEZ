import {NextRequest,NextResponse} from 'next/server';
import {ownerSnapshot} from '@/lib/owner/data';
import {createAdminClient} from '@/lib/supabase/admin';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params;
 const {data,ownerId}=await ownerSnapshot();
 // The owner-scoped database snapshot is the authority, not the URL or file path.
 const visible=data.documents.find(d=>d.id===id);
 if(!visible) return new NextResponse('Document unavailable',{status:404});
 const admin=createAdminClient();
 const {data:doc,error}=await admin.from('owner_portal_documents').select('bucket_name,file_path,title,mime_type').eq('id',id).eq('owner_id',ownerId).is('revoked_at',null).not('published_at','is',null).maybeSingle();
 if(error||!doc) return new NextResponse('Document unavailable',{status:404});
 const {data:file,error:fileError}=await admin.storage.from(doc.bucket_name).createSignedUrl(doc.file_path,60,{download:request.nextUrl.searchParams.get('mode')==='download'});
 if(fileError||!file?.signedUrl) return new NextResponse('Unable to open document',{status:503});
 const response=NextResponse.redirect(file.signedUrl);response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
}
