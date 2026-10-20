import Link from "next/link";
import { renovationContext, renovationLists } from "@/lib/renovation/server";
import { CatalogueForm } from "@/components/renovation/forms";
import { money } from "@/lib/renovation/model";

export default async function ItemLibrary({searchParams}:{searchParams:Promise<{q?:string;active?:string}>}) {
  await renovationContext(true);
  const [{catalogue},{q='',active='all'}]=await Promise.all([renovationLists(),searchParams]);
  const items=catalogue.filter(i=>`${i.item_code??''} ${i.category??''} ${i.description}`.toLowerCase().includes(q.toLowerCase())&&(active==='all'||(i.active!==false)===(active==='true')));
  return <main className="mx-auto max-w-5xl space-y-5"><Link href="/renovation" className="underline">← Client folders</Link><h1 className="text-2xl font-bold">Renovation Item Library</h1>
    <p>Prices and translations are copied into documents when inserted. Library changes never rewrite existing documents.</p>
    <details className="rounded border bg-white p-5"><summary className="font-semibold">+ New master item</summary><CatalogueForm/></details>
    <form className="flex flex-wrap gap-3"><input className="min-w-0 flex-1 rounded border p-2" aria-label="Search item library" name="q" defaultValue={q} placeholder="Code, description or category"/><select name="active" aria-label="Item availability" defaultValue={active}><option value="all">All items</option><option value="true">Active</option><option value="false">Inactive</option></select><button className="rounded border p-2">Search</button></form>
    {items.map(item=><details key={item.id} className="rounded border bg-white p-5"><summary>{item.item_code} · {item.description} · {money(Number(item.rate))} / {item.unit}{item.active===false?' · Inactive':''}</summary><div className="mt-4"><CatalogueForm item={item}/></div></details>)}
    {!items.length&&<p>No matching items.</p>}
  </main>;
}
