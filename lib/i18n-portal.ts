import type { AppLocale } from "@/lib/i18n";

type PhraseTable = Record<string, string>;

const ms: PhraseTable = {
  "Management Team": "Pasukan Pengurusan",
  "Daily Operations": "Operasi Harian",
  "Follow up rent and deposits, process maintenance work, submit claims and verify tenant registrations from one mobile workspace.":
    "Susulan sewa dan deposit, urus kerja penyelenggaraan, hantar tuntutan dan sahkan pendaftaran penyewa daripada satu ruang kerja mudah alih.",
  Maintenance: "Penyelenggaraan",
  "Open reports, update work status and submit completion photos.":
    "Buka laporan, kemas kini status kerja dan hantar gambar siap.",
  Verification: "Pengesahan",
  "Review tenant registrations and signed tenancy agreements.":
    "Semak pendaftaran penyewa dan perjanjian sewa yang telah ditandatangani.",
  "Claim Bills": "Bil Tuntutan",
  "Submit repair receipts and follow reimbursement status.":
    "Hantar resit pembaikan dan ikuti status bayaran balik.",
  "Rent Due Tracker": "Penjejak Tarikh Sewa",
  "Open full tracker": "Buka penjejak penuh",
  "Before due": "Sebelum tamat",
  Due: "Tamat",
  Overdue: "Tertunggak",
  "Due today": "Tamat hari ini",
  "Send an early reminder before the rent becomes due.":
    "Hantar peringatan awal sebelum sewa perlu dibayar.",
  "Cash received goes into company cash in hand. Online asks for the transfer slip.":
    "Tunai diterima dimasukkan ke dalam tunai syarikat. Pembayaran dalam talian memerlukan slip pindahan.",
  "Follow up overdue rent or record the payment received.":
    "Susulan sewa tertunggak atau rekod bayaran yang diterima.",
  "Open tracker": "Buka penjejak",
  "No tenants in this category.": "Tiada penyewa dalam kategori ini.",
  "Deposit Outstanding": "Deposit Tertunggak",
  Hide: "Sembunyi",
  Show: "Tunjuk",
  Deposit: "Deposit",
  received: "diterima",
  outstanding: "tertunggak",
  "Cash received": "Tunai diterima",
  "Online received": "Dalam talian diterima",
  "View details": "Lihat butiran",
  "Show first 10": "Tunjuk 10 pertama",
  "No outstanding tenant deposits.": "Tiada deposit penyewa tertunggak.",
  tenants: "penyewa",
  tenant: "penyewa",
  "still owe": "masih berhutang",
  "in total": "secara keseluruhan",
  "coming up": "akan datang",
  due: "perlu dibayar",
  Room: "Bilik",
  Online: "Dalam talian",
};

const zh: PhraseTable = {
  "Management Team": "管理团队",
  "Daily Operations": "日常运营",
  "Follow up rent and deposits, process maintenance work, submit claims and verify tenant registrations from one mobile workspace.":
    "在一个移动工作区跟进租金与押金、处理维修工作、提交报销并审核租户登记。",
  Maintenance: "维修",
  "Open reports, update work status and submit completion photos.":
    "查看报告、更新工作状态并提交完工照片。",
  Verification: "审核",
  "Review tenant registrations and signed tenancy agreements.":
    "审核租户登记和已签署的租赁协议。",
  "Claim Bills": "报销单据",
  "Submit repair receipts and follow reimbursement status.":
    "提交维修收据并跟进报销状态。",
  "Rent Due Tracker": "租金到期追踪",
  "Open full tracker": "打开完整追踪",
  "Before due": "到期前",
  Due: "到期",
  Overdue: "逾期",
  "Due today": "今日到期",
  "Send an early reminder before the rent becomes due.": "在租金到期前发送提醒。",
  "Cash received goes into company cash in hand. Online asks for the transfer slip.":
    "收到的现金计入公司库存现金；线上付款需要上传转账凭证。",
  "Follow up overdue rent or record the payment received.":
    "跟进逾期租金或记录已收付款。",
  "Open tracker": "打开追踪",
  "No tenants in this category.": "此类别没有租户。",
  "Deposit Outstanding": "未付押金",
  Hide: "隐藏",
  Show: "显示",
  Deposit: "押金",
  received: "已收",
  outstanding: "未付",
  "Cash received": "已收现金",
  "Online received": "已收线上付款",
  "View details": "查看详情",
  "Show first 10": "显示前10项",
  "No outstanding tenant deposits.": "没有未付的租户押金。",
  tenants: "名租户",
  tenant: "名租户",
  "still owe": "仍欠",
  "in total": "合计",
  "coming up": "即将到期",
  due: "到期",
  Room: "房间",
  Online: "线上",
};

const ta: PhraseTable = {
  "Management Team": "நிர்வாகக் குழு",
  "Daily Operations": "தினசரி செயல்பாடுகள்",
  "Follow up rent and deposits, process maintenance work, submit claims and verify tenant registrations from one mobile workspace.":
    "ஒரே மொபைல் பணியிடத்தில் வாடகை மற்றும் வைப்புத்தொகையைப் பின்தொடரவும், பராமரிப்பைச் செயல்படுத்தவும், கோரிக்கைகளைச் சமர்ப்பிக்கவும், வாடகையாளர் பதிவுகளைச் சரிபார்க்கவும்.",
  Maintenance: "பராமரிப்பு",
  "Open reports, update work status and submit completion photos.":
    "அறிக்கைகளைத் திறந்து, பணிநிலையைப் புதுப்பித்து, நிறைவு புகைப்படங்களைச் சமர்ப்பிக்கவும்.",
  Verification: "சரிபார்ப்பு",
  "Review tenant registrations and signed tenancy agreements.":
    "வாடகையாளர் பதிவுகள் மற்றும் கையொப்பமிட்ட ஒப்பந்தங்களை மதிப்பாய்வு செய்யவும்.",
  "Claim Bills": "கோரிக்கை பில்கள்",
  "Submit repair receipts and follow reimbursement status.":
    "பழுதுபார்ப்பு ரசீதுகளைச் சமர்ப்பித்து, திருப்பிச் செலுத்தும் நிலையைப் பின்தொடரவும்.",
  "Rent Due Tracker": "வாடகை நிலுவை கண்காணிப்பு",
  "Open full tracker": "முழு கண்காணிப்பைத் திற",
  "Before due": "நிலுவைக்கு முன்",
  Due: "நிலுவை",
  Overdue: "காலாவதி",
  "Due today": "இன்று நிலுவை",
  "Send an early reminder before the rent becomes due.":
    "வாடகை நிலுவைக்கு முன் நினைவூட்டலை அனுப்பவும்.",
  "Cash received goes into company cash in hand. Online asks for the transfer slip.":
    "பெறப்பட்ட பணம் நிறுவனக் கையிருப்பில் சேரும். இணையப் பணத்திற்கு பரிமாற்றச் சீட்டு தேவை.",
  "Follow up overdue rent or record the payment received.":
    "காலாவதியான வாடகையைப் பின்தொடரவும் அல்லது பெறப்பட்ட பணத்தைப் பதிவு செய்யவும்.",
  "Open tracker": "கண்காணிப்பைத் திற",
  "No tenants in this category.": "இந்தப் பிரிவில் வாடகையாளர்கள் இல்லை.",
  "Deposit Outstanding": "நிலுவை வைப்புத்தொகை",
  Hide: "மறை",
  Show: "காட்டு",
  Deposit: "வைப்புத்தொகை",
  received: "பெறப்பட்டது",
  outstanding: "நிலுவை",
  "Cash received": "பணம் பெறப்பட்டது",
  "Online received": "இணையப் பணம் பெறப்பட்டது",
  "View details": "விவரங்களைக் காண்க",
  "Show first 10": "முதல் 10ஐ காட்டு",
  "No outstanding tenant deposits.": "நிலுவை வாடகையாளர் வைப்புத்தொகை இல்லை.",
  tenants: "வாடகையாளர்கள்",
  tenant: "வாடகையாளர்",
  "still owe": "இன்னும் செலுத்த வேண்டும்",
  "in total": "மொத்தம்",
  "coming up": "வரவுள்ளது",
  due: "நிலுவை",
  Room: "அறை",
  Online: "இணையம்",
};

const tables: Record<Exclude<AppLocale, "en">, PhraseTable> = { ms, zh, ta };

export function portalText(locale: AppLocale, english: string) {
  if (locale === "en") return english;
  return tables[locale][english] ?? english;
}

