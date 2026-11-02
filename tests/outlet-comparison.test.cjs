const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./renovation-loader.cjs");
const {outletComparison, comparisonAmounts} = load("lib/accounting/outlet-comparison.ts");
const {outletProfitExport, reportMoney} = load("lib/accounting/financial-report-export.ts");
const {financialReportPdf} = load("lib/accounting/financial-report-pdf.ts");
const {PDFDocument} = require("pdf-lib");
const account = (key, label, amount, propertyId="a") => ({key,label,amount,details:[{id:key,propertyId,propertyName:"Outlet A",amount}]});
const report = {revenue:[account("income","Income",2000)],costsOfSales:[account("property_rental_cost","Property Rental Cost",800)],
 expenses:[account("utility_electricity","Electricity Utilities",150),account("utility_water","Water Utilities",50),
 account("internet","Telephone and Internet Expenses",100),account("credit","Internet Expenses",-20),
 account("repair","Water Pump Repairs",90),account("office","Office Supplies",30,null)],
 totalRevenue:2000,totalCostOfSales:800,totalExpenses:400,netProfit:800};
const outlets=[{id:"a",name:"Outlet A"},{id:"b",name:"No activity"}];
const input={company:{name:"DEKEZ SDN BHD",registration:"TEST ONLY",address:"Synthetic layout verification"},report,outlets,startDate:"2026-09-01",endDate:"2026-09-30"};
test("nine-column comparison keeps each source once, credits, empty outlets and unallocated intact",()=>{
 const original=JSON.stringify(report), result=outletComparison(report,outlets);
 assert.deepEqual(comparisonAmounts(result.rows.find(r=>r.id==="a")),[2000,800,150,50,80,90,1170,830]);
 assert.equal(result.rows.find(r=>r.id==="unallocated").operating,30);
 assert.equal(result.rows.find(r=>r.id==="b").totalExpenses,0);
 assert.equal(result.totals.totalExpenses,1200);
 assert.equal(result.totals.profit,800);
 assert.equal(result.warnings.length,0);
 assert.equal(JSON.stringify(report),original);
 const pdf=outletProfitExport(input);
 assert.deepEqual(pdf.rows.at(-1).cells,["TOTAL",...comparisonAmounts(result.totals).map(reportMoney)]);
 assert.equal(pdf.orientation,"landscape");
 assert.equal(pdf.widths.reduce((a,b)=>a+b),782);
 assert.match(pdf.period,/September 2026/);
 assert.match(outletProfitExport({...input,startDate:"2026-10-01",endDate:"2026-10-31"}).period,/October 2026/);
});
test("ambiguous utilities and incomplete detail are flagged, never guessed or balanced away",()=>{
 const ambiguous={...report,expenses:[account("utilities_expense","Utilities",400)]};
 const result=outletComparison(ambiguous,outlets);
 assert.equal(result.totals.electricity,0);
 assert.equal(result.totals.operating,400);
 assert.equal(result.warnings.length,1);
 const missing={...report,revenue:[{...report.revenue[0],details:[]}]};
 assert.ok(outletComparison(missing,outlets).warnings.some(w=>w.includes("reconcile")));
});
test("landscape comparison supports many outlets and repeated pages",async()=>{
 const spec=outletProfitExport(input);
 const populated = spec.rows.find(row => row.cells[0] === "Outlet A");
 const office = spec.rows.find(row=>row.cells[0]==="Office / unallocated");
 const parse = value => Number(value.replace(/RM |,/g,""));
 const total = {kind:"final",cells:["TOTAL",...populated.cells.slice(1).map((value,i)=>reportMoney(parse(value)*45+parse(office.cells[i+1])))]};
 spec.rows=[...Array.from({length:45},(_,i)=>({...populated,cells:[`TEST Outlet ${i+1} - Long property name`,...populated.cells.slice(1)]})),office,total];
 const result=await financialReportPdf(spec,new Date("2026-11-03T00:00:00Z"));
 const pdf=await PDFDocument.load(result.bytes);
 assert.ok(pdf.getPageCount()>1);
 for(const page of pdf.getPages()) assert.ok(page.getWidth()>page.getHeight());
 if(process.env.COMPARISON_PDF_OUTPUT) require("node:fs").writeFileSync(process.env.COMPARISON_PDF_OUTPUT,result.bytes);
});
