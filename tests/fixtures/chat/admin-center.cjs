const fs=require('node:fs'),path=require('node:path');
module.exports=async db=>db.exec(fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations/20261024164249_dekez_admin_message_center.sql'),'utf8'));
