// In-memory transport double ONLY. It cannot contact a Supabase project.
module.exports=function storage(db,actor){
 const objects=new Map();let beforeDownload;
 return {objects,setBeforeDownload:fn=>{beforeDownload=fn;},client:{
  rpc:(name,args)=>db.rpc(actor(),name,args,true),
  storage:{from:bucket=>{
   if(bucket!=='dekez-chat-files')throw Error('Forbidden test bucket');
   return {
    upload:async(key,bytes,options)=>{if(options.upsert)throw Error('Overwrite forbidden');if(objects.has(key))return {error:{message:'Exists'}};objects.set(key,new Blob([bytes],{type:options.contentType}));return {data:{path:key},error:null};},
    download:async key=>{if(beforeDownload)await beforeDownload();return objects.has(key)?{data:objects.get(key),error:null}:{data:null,error:{message:'Missing'}};}
   };
  }}
 }};
};
