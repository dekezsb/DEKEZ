import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, BriefcaseBusiness, Building2, Check, CheckCheck,
  CircleHelp, ClipboardList, Clock3, CreditCard, FileText, House, ImagePlus,
  MapPin, MessageSquare, Settings2, ShieldCheck, Sparkles, Star, UserRound,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import {
  contractorMobileSection, contractorPreviewPath, sectionTitles, type ContractorSection,
} from "@/lib/marketplace/portal";
import styles from "./contractor-portal.module.css";

const navigation = [
  { section: "dashboard", label: "Dashboard", mobile: "Home", icon: House },
  { section: "jobs", label: "Job Opportunities", mobile: "Jobs", icon: BriefcaseBusiness },
  { section: "quotations", label: "My Quotations", mobile: "Quotations", icon: FileText },
  { section: "my-jobs", label: "My Jobs", icon: ClipboardList },
  { section: "messages", label: "Messages", mobile: "Messages", icon: MessageSquare },
  { section: "subscription", label: "Subscription", icon: CreditCard },
  { section: "profile", label: "Company Profile", mobile: "Profile", icon: Building2 },
  { section: "support", label: "Help & Support", icon: CircleHelp },
] as const;
const primary = navigation.filter(item => "mobile" in item);
const profileTabs = [
  { section: "profile", label: "Basic information" },
  { section: "profile/services", label: "Services & areas" },
  { section: "profile/portfolio", label: "Portfolio" },
  { section: "profile/verification", label: "Verification" },
  { section: "reviews", label: "Reviews" },
] as const;
const href = (section: string) => `${contractorPreviewPath}/${section}`;

function Card({ title, icon, children, action }: { title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return <section className={styles.card}><div className={styles.cardHeading}><h2>{icon}{title}</h2>{action}</div>{children}</section>;
}
function Empty({ title, children, icon = <BriefcaseBusiness /> }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return <div className={styles.empty}><span className={styles.emptyIcon}>{icon}</span><h3>{title}</h3><p>{children}</p></div>;
}
function ActionLink({ section, children }: { section: string; children: ReactNode }) {
  return <Link className={styles.action} href={href(section)}>{children}<ArrowRight size={17} aria-hidden /></Link>;
}
function AccountExit({ pilot, sidebar = false }: { pilot: boolean; sidebar?: boolean }) {
  const icon = sidebar ? <ArrowLeft size={18} aria-hidden /> : <ShieldCheck size={18} aria-hidden />;
  if (pilot) return <form className={sidebar ? styles.back : undefined} action="/logout" method="post"><button type="submit" aria-label="Sign out" className={sidebar ? "flex min-h-11 items-center gap-3" : styles.adminBadge}>{icon}<span>Sign out</span></button></form>;
  return <Link className={sidebar ? styles.back : styles.adminBadge} href="/admin/marketplace">{icon}<span>{sidebar ? "Back to management" : "Admin preview"}</span></Link>;
}
function Membership() {
  return <Card title="Membership Status" icon={<ShieldCheck aria-hidden />}>
    <span className={styles.badge}>Billing not configured</span>
    <h3 className={styles.planName}>DEKEZ Contractor Membership</h3>
    <p className={styles.muted}>Plan pricing and checkout will appear after Admin configures billing. No subscription is active in this preview.</p>
    <ul className={styles.checkList}><li><Check aria-hidden />Relevant job invitations</li><li><Check aria-hidden />Professional quotations</li><li><Check aria-hidden />Job-based conversations</li></ul>
    <ActionLink section="subscription">Membership details</ActionLink>
    <p className={styles.note}>Verification and active membership are both required for new opportunities. Membership does not guarantee jobs.</p>
  </Card>;
}

function Dashboard() {
  const metrics = [
    { label: "New opportunities", icon: BriefcaseBusiness, section: "jobs", tone: "gold" },
    { label: "Quotations submitted", icon: FileText, section: "quotations", tone: "blue" },
    { label: "Quotations accepted", icon: CheckCheck, section: "quotations", tone: "green" },
    { label: "Jobs in progress", icon: Settings2, section: "my-jobs", tone: "blue" },
    { label: "Completed jobs", icon: ShieldCheck, section: "my-jobs", tone: "green" },
    { label: "Your rating", icon: Star, section: "reviews", tone: "gold" },
  ];
  return <>
    <div className={styles.welcome}><div><span className={styles.eyebrow}>YOUR NEXT CHAPTER STARTS HERE</span><h2>A home for your growing business.</h2><p>Manage opportunities, quotations and conversations in one place.</p></div><Link className={styles.goldButton} href={href("profile")}>Explore your profile<ArrowRight size={18} aria-hidden /></Link></div>
    <div className={styles.metrics}>{metrics.map(metric => <Link key={metric.label} href={href(metric.section)} className={styles.metric}>
      <span className={`${styles.metricIcon} ${styles[metric.tone]}`}><metric.icon aria-hidden /></span>
      <span className={styles.metricLabel}>{metric.label}</span><strong aria-label="Not connected">—</strong><small>Available after setup</small>
    </Link>)}</div>
    <div className={styles.dashboardGrid}><div className={styles.stack}>
      <Card title="Latest Job Opportunities" action={<Link className={styles.textLink} href={href("jobs")}>View all<ArrowRight size={15} aria-hidden /></Link>}>
        <Empty title="Your opportunities will appear here">Once your business is verified and your membership is active, eligible job invitations will appear here. Marketplace data is not connected yet.</Empty>
      </Card>
      <Card title="Getting started" icon={<Sparkles aria-hidden />}><div className={styles.steps}>
        {[{ title: "Introduce your business", detail: "Company details, services and coverage areas.", section: "profile" }, { title: "Prepare your verification", detail: "Business documents and relevant trade qualifications.", section: "profile/verification" }, { title: "Choose your membership", detail: "Subscribe when billing is available.", section: "subscription" }].map((step, i) => <Link className={styles.step} key={step.title} href={href(step.section)}><span className={styles.stepNumber}>{i + 1}</span><div><h3>{step.title}</h3><p>{step.detail}</p></div><ArrowRight size={18} aria-hidden /></Link>)}
      </div></Card>
    </div><div className={styles.stack}><Membership /><Card title="Recent Activity" icon={<Clock3 aria-hidden />}><p className={styles.muted}>Activity will appear after marketplace records are connected. No activity has been created.</p></Card></div></div>
  </>;
}

function Profile({ section, pilot }: { section: ContractorSection; pilot: boolean }) {
  let content: ReactNode;
  if (section === "profile/services") content = <Card title="Your services and coverage" icon={<MapPin aria-hidden />}><Empty title="Service categories are not configured" icon={<MapPin />}>Admin will configure service categories and areas. Your selected services, coverage and qualifications determine which invitations you can receive.</Empty></Card>;
  else if (section === "profile/portfolio") content = <Card title="Showcase your work" icon={<ImagePlus aria-hidden />}><Empty title="No portfolio connected" icon={<ImagePlus />}>Project photos and descriptions will appear here after secure uploads are enabled. No files are uploaded in this foundation preview.</Empty></Card>;
  else if (section === "profile/verification") content = <Card title="Business verification" icon={<ShieldCheck aria-hidden />}><span className={styles.badge}>Not submitted</span><Empty title="Verification is not enabled yet" icon={<ShieldCheck />}>Admin will configure the documents required for each service. Business registration alone does not establish professional or trade qualifications.</Empty><p className={styles.note}>Verification documents remain private. Subscription payment never approves your verification.</p></Card>;
  else if (section === "reviews") content = <Card title="Reviews" icon={<Star aria-hidden />}><Empty title="No reviews connected" icon={<Star />}>Reviews are linked to real jobs and eligible completion. Both parties can share their experience independently.</Empty></Card>;
  else content = <div className={styles.twoColumns}>
    <Card title="Basic information" icon={<Building2 aria-hidden />}><dl className={styles.details}>{["Company / business name", "SSM registration number", "Contact person", "Phone number", "Email", "Business address", "Company description"].map(label => <div key={label}><dt>{label}</dt><dd>Not connected</dd></div>)}</dl><p className={styles.note}>No company profile has been created. Profile editing will be enabled after the secure data foundation is installed.</p></Card>
    <div className={styles.stack}><Card title="Your workspace"><div className={styles.menuLinks}>{[{ section: "my-jobs", label: "My Jobs" }, { section: "subscription", label: "Subscription" }, { section: "subscription/billing", label: "Billing History" }, { section: "support", label: "Help & Support" }].map(item => <ActionLink key={item.section} section={item.section}>{item.label}</ActionLink>)}</div></Card><Card title="Your account" icon={<UserRound aria-hidden />}><p className={styles.muted}>{pilot ? "You are signed in with restricted test access. This account cannot access Admin, rental records or financial data." : "You are viewing the Contractor layout through your existing Admin session. Your permissions are unchanged."}</p><p className={styles.note}>Approved test accounts use phone and temporary-password sign-in. WhatsApp OTP is deferred.</p></Card></div>
  </div>;
  return <><nav className={styles.tabs} aria-label="Company profile sections">{profileTabs.map(tab => <Link key={tab.section} aria-current={tab.section === section ? "page" : undefined} href={href(tab.section)}>{tab.label}</Link>)}</nav>{content}</>;
}

function Content({ section, pilot }: { section: ContractorSection; pilot: boolean }) {
  if (section === "dashboard") return <Dashboard />;
  if (section.startsWith("profile") || section === "reviews") return <Profile section={section} pilot={pilot} />;
  if (section === "jobs") return <><div className={styles.explainer}><ShieldCheck aria-hidden /><p>Invitations are based on service, location, qualifications, verification and membership—not first-click wins.</p></div><Card title="Eligible opportunities"><Empty title="Job opportunities are not connected">No live jobs are loaded in this preview. After setup, only valid invitations for your business will be shown.</Empty><ActionLink section="profile/services">Review services and areas</ActionLink></Card></>;
  if (section === "quotations") return <Card title="Quotation workspace" icon={<FileText aria-hidden />}><Empty title="No quotations connected" icon={<FileText />}>Your drafts, submitted versions and accepted quotations will be managed here. The quotation editor will be connected in the next delivery phases.</Empty><ActionLink section="jobs">Browse opportunities</ActionLink><p className={styles.note}>A quotation is not a DEKEZ invoice and does not create an accounting entry.</p></Card>;
  if (section === "my-jobs") return <Card title="Your accepted projects" icon={<ClipboardList aria-hidden />}><Empty title="No accepted jobs connected" icon={<ClipboardList />}>Selected projects, progress photos and owner completion confirmations will appear here. Existing accepted-job access will remain available if membership expires.</Empty><ActionLink section="jobs">Explore job opportunities</ActionLink></Card>;
  if (section === "messages") return <Card title="Job conversations" icon={<MessageSquare aria-hidden />}><Empty title="Messaging is not connected" icon={<MessageSquare />}>Secure conversations will be linked to jobs and visible only to authorized participants. No messages are sent from this preview.</Empty><ActionLink section="my-jobs">View your jobs</ActionLink></Card>;
  if (section === "subscription/billing") return <Card title="Billing History" icon={<CreditCard aria-hidden />}><Empty title="Billing is not configured" icon={<CreditCard />}>No subscription invoices or payments have been generated. Billing records will come from the configured payment provider.</Empty><ActionLink section="subscription">Back to membership</ActionLink></Card>;
  if (section === "subscription") return <div className={styles.twoColumns}><Membership /><Card title="Membership and payments"><h3>Subscription only</h3><p className={styles.muted}>DEKEZ charges contractor membership fees only. Owners post jobs for free.</p><h3>Project payments stay between you</h3><p className={styles.muted}>Arrange renovation and service payments directly with the owner. DEKEZ does not collect project deposits, hold project funds or charge project commissions.</p><ActionLink section="subscription/billing">View billing history</ActionLink><p className={styles.note}>Subscribe, renewal and cancellation controls will become available when the payment integration is configured and tested.</p></Card></div>;
  return <Card title="Help & Support" icon={<CircleHelp aria-hidden />}><div className={styles.faq}>
    <details open><summary>How do job invitations work?</summary><p>Eligible, verified members receive invitations in configurable batches. Service coverage, qualifications and invitation history help distribute opportunities fairly.</p></details>
    <details><summary>Does membership guarantee a job?</summary><p>No. Owners compare quotations and choose their contractor. Membership gives access to eligible opportunities, not guaranteed awards.</p></details>
    <details><summary>Does DEKEZ collect project payments?</summary><p>No. Project payment arrangements are directly between owner and contractor. DEKEZ charges membership fees only.</p></details>
    <details><summary>Why are actions not available in this preview?</summary><p>This is the portal foundation. Secure profile storage, job records, messaging and billing must be installed and tested before their actions are enabled.</p></details>
  </div><p className={styles.note}>The support contact will be shown after Admin configures it. No support message is submitted here.</p></Card>;
}

/** Read-only Phase 1 shell. No sample business records or optimistic live metrics. */
export function ContractorPortal({ section, pilot = false }: { section: ContractorSection; pilot?: boolean }) {
  const mobileActive = contractorMobileSection(section);
  return <div className={styles.portal}>
    <a className={styles.skip} href="#contractor-content">Skip to content</a>
    <aside className={styles.sidebar}><Link className={styles.brand} href={href("dashboard")}><BrandLogo size={40} /><span><b>DEKEZ</b><small>Contractor Portal</small></span></Link><nav aria-label="Contractor portal">{navigation.map(item => <Link key={item.section} href={href(item.section)} aria-current={section === item.section || section.startsWith(`${item.section}/`) ? "page" : undefined}><item.icon size={19} aria-hidden /><span>{item.label}</span></Link>)}</nav><AccountExit pilot={pilot} sidebar /></aside>
    <div className={styles.main}><header className={styles.header}><div><p className={styles.eyebrow}>DEKEZ HOME SERVICES</p><h1>{sectionTitles[section]}</h1><p className={styles.subtitle}>Find more jobs. Grow your business.</p></div><AccountExit pilot={pilot} /></header>
      <div className={styles.previewNotice}><span className={styles.previewDot} /><p><strong>Foundation preview.</strong> Navigation is ready to explore. Live records, uploads and payments are not connected.{pilot ? " You are signed in with restricted test access." : " Restricted Contractor test login is available."}</p></div>
      <main id="contractor-content" className={styles.content}><Content section={section} pilot={pilot} /></main>
      <footer className={styles.footer}>DEKEZ SDN BHD · Home Services Marketplace<span>Project payments are arranged directly with owners.</span></footer>
    </div>
    <nav className={styles.bottomNav} aria-label="Contractor mobile navigation">{primary.map(item => <Link key={item.section} href={href(item.section)} aria-current={mobileActive === item.section ? "page" : undefined}><item.icon size={21} aria-hidden /><span>{item.mobile}</span></Link>)}</nav>
  </div>;
}
