import {notFound,redirect} from 'next/navigation';
import {OwnerPortal} from '@/components/owner/portal';
import {ownerSnapshot} from '@/lib/owner/data';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{segments?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const [{segments=[]},search]=await Promise.all([params,searchParams]);
 if(!segments.length) redirect('/owner/home');
 let section=segments.join('/'), detail:string|undefined;
 if(segments[0]==='properties'&&segments.length===2) {detail=segments[1];section='properties/detail';}
 if(segments[0]==='finance'&&segments[1]==='maintenance-claims'&&segments.length===3) {detail=segments[2];section='finance/maintenance-claims/detail';}
 if(!['home','properties','properties/detail','finance','finance/collection','finance/expenses','finance/maintenance-claims','finance/maintenance-claims/detail','finance/payouts','finance/statements','documents','profile'].includes(section)) notFound();
 const string=(key:string)=>typeof search[key]==='string'?search[key] as string:undefined;
 const snapshot=await ownerSnapshot(string('month'),section==='properties/detail'?detail:string('property'));
 if(detail&&section.includes('maintenance')&&!snapshot.data.claims.some(c=>c.id===detail)) notFound();
 return <OwnerPortal {...snapshot} section={section} detail={detail} query={string('q')} category={string('type')} year={string('year')}/>;
}
