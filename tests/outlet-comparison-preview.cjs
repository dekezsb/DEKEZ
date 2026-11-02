// Local synthetic visual fixture only. No database or production route.
const fs=require("node:fs"), path=require("node:path"), React=require("react");
const {renderToStaticMarkup}=require("react-dom/server");
const load=require("./renovation-loader.cjs");
const {OutletProfitTable}=load("components/accounting/outlet-profit-table.tsx");
const {outletProfitExport}=load("lib/accounting/financial-report-export.ts");
const {financialReportPdf}=load("lib/accounting/financial-report-pdf.ts");
const account=(key,label,amount,propertyId="a")=>({key,label,amount,details:[{id:key,propertyId,propertyName:"Preview outlet",amount}]});
const report={revenue:[account("income","Rental income",12000)],costsOfSales:[account("property_rental_cost","Property Rental Cost",4000)],
expenses:[account("utility_electricity","Electricity Utilities",800),account("utility_water","Water Utilities",200),account("internet","Telephone and Internet Expenses",150),account("repairs","Repairs",500),account("office","Office Supplies",100,null)],
totalRevenue:12000,totalCostOfSales:4000,totalExpenses:1750,netProfit:6250};
const input={company:{name:"DEKEZ SDN BHD",registration:"TEST ONLY",address:"Synthetic layout preview - not actual accounts"},report,outlets:[{id:"a",name:"TEST - Preview outlet"},{id:"b",name:"TEST - No activity"}],startDate:"2026-10-01",endDate:"2026-10-31"};
(async()=>{
 const css=await require("postcss")([require("@tailwindcss/postcss")()]).process(fs.readFileSync("app/globals.css","utf8"),{from:path.resolve("app/globals.css")});
 const body=[1440,768,390].map(w=>`<h2>Layout test: ${w}px container</h2><div class="app-responsive" style="width:${w}px;max-width:100%">${renderToStaticMarkup(React.createElement(OutletProfitTable,input))}</div>`).join("");
 fs.writeFileSync(process.argv[2],`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body style="padding:16px;background:#faf8f1"><h1>SYNTHETIC PREVIEW ONLY - not actual financial data</h1>${body}</body></html>`);
})();
