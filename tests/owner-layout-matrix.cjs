// Local-only browser layout checks. No login, live API or financial writes.
const sizes=[[320,568],[375,812],[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1024,1366],[1280,800],[1366,768],[1440,900],[1920,1080],[2560,1440],[3440,1440]];
const pages=['home','properties','properties/a','finance','finance/collection','finance/expenses','finance/maintenance-claims','finance/maintenance-claims/claim','finance/payouts','finance/statements','documents','profile'];
function inspectLayout() {
 const d=document,w=window,width=w.innerWidth;
 const rect=e=>e.getBoundingClientRect();
 const visible=e=>!!e&&rect(e).width>0&&rect(e).height>0&&w.getComputedStyle(e).display!=='none';
 const errors=[],check=(ok,msg)=>{if(!ok)errors.push(msg);};
 const sidebar=d.querySelector('.sidebar'),bottom=d.querySelector('.bottomNav'),main=d.querySelector('.main'),content=d.querySelector('.content');
 if(!main)return ['Page did not render'];
 check(d.documentElement.scrollWidth<=width+1,'page horizontal overflow');
 check(visible(sidebar)===(width>=1024),'sidebar breakpoint');
 check(visible(bottom)===(width<1024),'bottom navigation breakpoint');
 const mainRect=rect(main),expectedLeft=width>=1024?232:0;
 check(Math.abs(mainRect.left-expectedLeft)<=1,'main left edge');
 check(Math.abs(mainRect.right-d.documentElement.clientWidth)<=1,'main must fill remaining width');
 
 const navigation=width>=1024?sidebar.querySelectorAll('nav a'):bottom.querySelectorAll('a');
 check(navigation.length===5,'five primary destinations');
 for(const a of navigation)check(rect(a).height>=44&&rect(a).width>=44,'navigation touch target');
 if(width<1024)check(+w.getComputedStyle(d.querySelector('.footer')).paddingBottom.replace('px','')>=rect(bottom).height,'bottom content clearance');
 for(const e of d.querySelectorAll('.metric strong,.line > span,.stats > span,.recordHeading,.documentHeading h2,.card h2,.propertyBody h2')) {
  if(visible(e))check(e.scrollWidth<=e.clientWidth+1,'clipped text: '+e.textContent.slice(0,65));
 }
 for(const e of d.querySelectorAll('input:not([type=hidden]),select'))check(+w.getComputedStyle(e).fontSize.replace('px','')>=16,'input text below iOS 16px');
 for(const e of d.querySelectorAll('.propertyCard,.card'))if(visible(e))check(rect(e).left>=rect(content).left-1&&rect(e).right<=rect(content).right+1,'card outside content');
 const summary=d.querySelector('.summary'),grid=d.querySelector('.propertyGrid');
 if(summary)check(w.getComputedStyle(summary).gridTemplateColumns.split(' ').length===(width>=1200?4:2),'summary columns');
 if(grid)check(w.getComputedStyle(grid).gridTemplateColumns.split(' ').length===(width>=1440?3:width>=768?2:1),'property columns');
 const tabs=d.querySelector('.tabs');
 if(tabs)check(w.getComputedStyle(tabs).flexWrap==='nowrap'&&rect(tabs).right<=rect(content).right+1,'finance tabs local scrolling');
 const metric=d.querySelector('.metric strong');
 if(metric&&d.URL.includes('stress=1'))check(d.querySelector('.summary').textContent.includes('Not issued'),'unissued payout preserved');
 return [...new Set(errors)];
}
module.exports={sizes,pages,inspectLayout};
