const fs=require('node:fs'),path=require('node:path');
module.exports=async db=>db.exec(fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations/20261024170258_dekez_chat_assistant.sql'),'utf8'));
