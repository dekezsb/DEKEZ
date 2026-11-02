const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async db=>{
 const sql=fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations/20261024170258_dekez_chat_assistant.sql'),'utf8');
 // This disposable fixture uses October invoices and reminder dates. Freeze only
 // the answer's reporting calendar; real lease/delay clocks and production SQL
 // remain unchanged. Fail if the production declaration changes.
 const calendar="today date:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;";
 assert.equal(sql.split(calendar).length,2);
 return db.exec(sql.replace(calendar,"today date:='2026-10-24'::date;"));
};
