
const SUPABASE_URL = "https://mfuijgzytzfgigepaocz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BSsA8_YGwXByhgc0_A4YyA_7QPMvELF";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = id => document.getElementById(id);
let cashflowChart = null;
let expenseChart = null;
let currentProfile = null;
let currentSession = null;

let incomeInstitutions = [];
let incomeAccounts = [];
let incomeFundSources = [];
let incomeRowsCache = [];
let pendingIncomeSaveAction = "draft";
let editingIncomeId = null;

let expenseInstitutions = [];
let expenseAccounts = [];
let expenseCategories = [];
let expenseRowsCache = [];
let pendingExpenseSaveAction = "draft";
let editingExpenseId = null;

let transferInstitutions = [];
let transferAccounts = [];
let transferBalances = [];
let transferRowsCache = [];
let pendingTransferSaveAction = "draft";
let editingTransferId = null;

let reportInstitutions = [];
let reportRowsCache = [];

let lpjInstitutions = [];
let lpjDataCache = null;

let assetInstitutions=[];
let assetCategories=[];
let assetRowsCache=[];
let assetExpenseRows=[];
let editingAssetId=null;
let selectedAssetIds=new Set();
let pendingAssetDeepLinkHandled=false;

let analyticsInstitutions = [];
let analyticsRowsCache = [];
let analyticsCashflowChart = null;
let analyticsExpenseChart = null;
let analyticsIncomeSourceChart = null;
let analyticsInstitutionChart = null;

let masterInstitutions = [];
let usersRowsCache = [];
let editingUserProfileId = null;

let evidenceInstitutions = [];
let evidenceRowsCache = [];
let currentEvidenceExternalUrl = null;
let evidenceThumbGeneration = 0;

let auditInstitutions = [];
let auditProfiles = [];
let auditRowsCache = [];

let budgetInstitutions = [];
let budgetCategories = [];
let budgetRowsCache = [];

let closingInstitutions = [];
let closingRowsCache = [];
let closingPendingRows = [];

let executiveInstitutions = [];
let executiveBalanceChart = null;
let executiveFlowChart = null;
let executiveDataCache = null;

const rupiah = n => new Intl.NumberFormat("id-ID",{
  style:"currency",currency:"IDR",maximumFractionDigits:0
}).format(Number(n||0));

const shortMoney = n => {
  n = Number(n||0);
  if (Math.abs(n)>=1e9) return "Rp"+(n/1e9).toFixed(1)+" M";
  if (Math.abs(n)>=1e6) return "Rp"+(n/1e6).toFixed(1)+" jt";
  if (Math.abs(n)>=1e3) return "Rp"+(n/1e3).toFixed(0)+" rb";
  return rupiah(n);
};

const escapeHtml = s => String(s??"")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

function toast(msg){
  const t=$("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove("show"),2800);
}

function roleLabel(r){
  return {SUPER_ADMIN:"Super Admin Yayasan",FOUNDATION_TREASURER:"Bendahara Yayasan",
    INSTITUTION_ADMIN:"Admin/Bendahara Lembaga",VIEWER:"Viewer"}[r]||r||"-";
}
function typeLabel(t){return {INCOME:"Pemasukan",EXPENSE:"Pengeluaran",TRANSFER:"Transfer"}[t]||t}
function storageTypeLabel(type){
  return {CASH:"Cash / Tunai",BANK:"Rekening Bank",E_WALLET:"E-Wallet",OTHER:"Lainnya"}[type]||"Lainnya";
}
function storageTypeClass(type){
  if(type==="CASH") return "cash";
  if(type==="BANK") return "bank";
  return "other";
}
function typeClass(t){return {INCOME:"income",EXPENSE:"expense",TRANSFER:"transfer"}[t]||""}
function statusClass(s){
  return {APPROVED:"approved",SUBMITTED:"submitted",DRAFT:"draft",REJECTED:"rejected",VOID:"void"}[s]||"draft"
}
function formatDate(v){
  if(!v)return "-";
  return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(v+"T00:00:00"));
}
function monthRange(){
  const d=new Date(), y=d.getFullYear(), m=d.getMonth();
  const start=new Date(y,m,1).toISOString().slice(0,10);
  const next=new Date(y,m+1,1).toISOString().slice(0,10);
  return {start,next};
}
function isCentralUser(){
  return ["SUPER_ADMIN","FOUNDATION_TREASURER"].includes(currentProfile?.role);
}

function canCorrectTransactionType(type){
  if(isCentralUser()) return true;
  return currentProfile?.role==="INSTITUTION_ADMIN" && ["INCOME","EXPENSE"].includes(type);
}

function isTransactionEditAllowed(row){
  return row?.status==="DRAFT" && canCorrectTransactionType(row?.transaction_type||"");
}

async function reloadTransactionModule(type){
  if(type==="INCOME") await loadIncomeTransactions();
  if(type==="EXPENSE") await loadExpenseTransactions();
  if(type==="TRANSFER") await loadTransferModule();
  await loadDashboard();
}

async function deleteDraftTransaction(id,type,proofPaths=[]){
  if(!confirm("Hapus transaksi Draft ini secara permanen? Tindakan ini akan tercatat di Audit Trail.")) return;

  const {error}=await sb.rpc("delete_draft_transaction",{p_transaction_id:id});
  if(error) throw error;

  if(proofPaths.length){
    const {error:storageError}=await sb.storage.from("transaction-proofs").remove(proofPaths);
    if(storageError){
      console.warn("Transaksi terhapus, tetapi pembersihan file Storage gagal:",storageError);
      toast("Transaksi terhapus. Ada file Storage yang perlu dibersihkan.");
    }
  }

  await reloadTransactionModule(type);
  toast("Draft berhasil dihapus.");
}

async function withdrawSubmittedTransaction(id,type){
  const note=prompt("Alasan menarik pengajuan (contoh: salah nominal / salah akun):");
  if(note===null) return;
  if(!note.trim()) throw new Error("Alasan menarik pengajuan wajib diisi.");

  const {error}=await sb.rpc("withdraw_transaction",{
    p_transaction_id:id,
    p_note:note.trim()
  });
  if(error) throw error;

  await reloadTransactionModule(type);
  toast("Pengajuan ditarik. Status kembali menjadi DRAFT.");
}

async function reopenRejectedTransaction(id,type){
  const note=prompt("Catatan perbaikan sebelum transaksi dikembalikan ke Draft:");
  if(note===null) return;
  if(!note.trim()) throw new Error("Catatan perbaikan wajib diisi.");

  const {error}=await sb.rpc("reopen_rejected_transaction",{
    p_transaction_id:id,
    p_note:note.trim()
  });
  if(error) throw error;

  await reloadTransactionModule(type);

  if(type==="INCOME") startEditIncome(id);
  if(type==="EXPENSE") startEditExpense(id);
  if(type==="TRANSFER") startEditTransfer(id);

  toast("Transaksi dikembalikan ke Draft untuk diperbaiki.");
}

async function voidApprovedTransaction(id,type){
  const reason=prompt("Alasan VOID transaksi APPROVED:");
  if(reason===null) return;
  if(!reason.trim()) throw new Error("Alasan VOID wajib diisi.");

  if(!confirm("VOID transaksi ini? Dampaknya pada saldo akan dibalik, tetapi riwayat transaksi tetap tersimpan.")) return;

  const {error}=await sb.rpc("void_transaction",{
    p_transaction_id:id,
    p_reason:reason.trim()
  });
  if(error) throw error;

  await reloadTransactionModule(type);
  toast("Transaksi berhasil di-VOID. Saldo telah disesuaikan.");
}
function todayISO(){
  const d=new Date();
  const tz=d.getTimezoneOffset();
  return new Date(d.getTime()-tz*60000).toISOString().slice(0,10);
}

async function getProfile(uid){
  const {data,error}=await sb.from("profiles")
    .select("id,full_name,role,institution_id,institutions:institution_id(id,name,code,institution_type)")
    .eq("id",uid).single();
  if(error) throw error;
  return data;
}

async function enterApp(session){
  try{
    currentSession=session;
    currentProfile=await getProfile(session.user.id);
    const p=currentProfile;

    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");

    const first=(p.full_name||"Pengguna").trim().split(/\s+/)[0];
    $("userName").textContent=p.full_name||"Pengguna";
    $("userRole").textContent=roleLabel(p.role);
    $("avatar").textContent=first.charAt(0).toUpperCase();
    $("welcomeName").textContent=first;
    $("welcomeInstitution").textContent=
      isCentralUser()
      ? "Dashboard konsolidasi Yayasan dan seluruh lembaga"
      : "Lembaga: "+(p.institutions?.name||"-");
    $("today").textContent=new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());

    applyRoleBasedUI();
    await loadDashboard();
    await handleAssetDeepLink();
  }catch(err){
    console.error(err);
    await sb.auth.signOut();
    currentProfile=null; currentSession=null;
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("loginError").textContent="Login berhasil, tetapi profil SIMKEU tidak ditemukan. Periksa tabel profiles.";
    $("loginError").classList.remove("hidden");
  }
}

async function loadDashboard(){
  $("refreshBtn").disabled=true;
  try{
    const r=monthRange(), y=new Date().getFullYear();
    const [balances,accountsMaster,monthly,pending,recent,yearly]=await Promise.all([
      sb.from("v_account_balances").select("account_id,institution_id,institution_name,account_name,current_balance"),
      sb.from("accounts").select("id,account_type").eq("is_active",true),
      sb.from("transactions").select("id,transaction_type,amount,expense_category_id,status,transaction_date,expense_categories:expense_category_id(name)")
        .eq("status","APPROVED").gte("transaction_date",r.start).lt("transaction_date",r.next),
      sb.from("transactions").select("id",{count:"exact",head:true}).eq("status","SUBMITTED"),
      sb.from("transactions").select("id,transaction_number,transaction_date,transaction_type,amount,status,institutions:institution_id(name)")
        .order("transaction_date",{ascending:false}).order("created_at",{ascending:false}).limit(8),
      sb.from("transactions").select("transaction_date,transaction_type,amount,status").eq("status","APPROVED")
        .gte("transaction_date",`${y}-01-01`).lt("transaction_date",`${y+1}-01-01`)
    ]);
    [balances,accountsMaster,monthly,pending,recent,yearly].forEach(x=>{if(x.error)throw x.error});
    const b=balances.data||[], m=monthly.data||[];
    const accountTypeMap=new Map((accountsMaster.data||[]).map(a=>[a.id,a.account_type]));
    const total=b.reduce((s,x)=>s+Number(x.current_balance||0),0);
    const cashTotal=b.filter(x=>accountTypeMap.get(x.account_id)==="CASH")
      .reduce((s,x)=>s+Number(x.current_balance||0),0);
    const bankTotal=b.filter(x=>accountTypeMap.get(x.account_id)==="BANK")
      .reduce((s,x)=>s+Number(x.current_balance||0),0);

    $("totalBalance").textContent=rupiah(total);
    $("totalCashBalance").textContent=rupiah(cashTotal);
    $("totalBankBalance").textContent=rupiah(bankTotal);
    $("ledgerGrandBalance").textContent=rupiah(total);
    $("monthlyIncome").textContent=rupiah(m.filter(x=>x.transaction_type==="INCOME").reduce((s,x)=>s+Number(x.amount||0),0));
    $("monthlyExpense").textContent=rupiah(m.filter(x=>x.transaction_type==="EXPENSE").reduce((s,x)=>s+Number(x.amount||0),0));
    $("pendingCount").textContent=pending.count||0;
    renderInstitutions(b,accountTypeMap);
    renderRecent(recent.data||[]);
    renderCashflow(yearly.data||[]);
    renderExpense(m);
  }catch(err){
    console.error(err);
    toast("Gagal memuat dashboard: "+(err.message||"error"));
  }finally{$("refreshBtn").disabled=false}
}

function renderInstitutions(rows,accountTypeMap=new Map()){
  const map=new Map();
  rows.forEach(r=>{
    const n=r.institution_name||"Lembaga";
    if(!map.has(n))map.set(n,{total:0,cash:0,bank:0,other:0,count:0});
    const target=map.get(n);
    const amount=Number(r.current_balance||0);
    const type=accountTypeMap.get(r.account_id)||"OTHER";
    target.total+=amount;
    target.count++;
    if(type==="CASH")target.cash+=amount;
    else if(type==="BANK")target.bank+=amount;
    else target.other+=amount;
  });
  $("institutionBalances").innerHTML=map.size?[...map.entries()].map(([n,v])=>`
    <div class="institution-row">
      <div class="institution-name">
        <div class="badge">${escapeHtml(n.slice(0,3).toUpperCase())}</div>
        <div>
          <strong>${escapeHtml(n)}</strong>
          <span class="institution-balance-breakdown">Cash ${rupiah(v.cash)} • Rekening ${rupiah(v.bank)}</span>
        </div>
      </div>
      <div class="institution-amount">${rupiah(v.total)}</div>
    </div>`).join(""):`<div class="empty">Belum ada akun kas/bank.</div>`;
}

function renderRecent(rows){
  $("recentTransactions").innerHTML=rows.length?rows.map(t=>`
    <tr>
      <td>${formatDate(t.transaction_date)}</td>
      <td><strong>${escapeHtml(t.transaction_number||"-")}</strong></td>
      <td><span class="pill ${typeClass(t.transaction_type)}">${typeLabel(t.transaction_type)}</span></td>
      <td>${escapeHtml(t.institutions?.name||"-")}</td>
      <td><strong>${rupiah(t.amount)}</strong></td>
      <td><span class="pill ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td>
    </tr>`).join(""):`<tr><td colspan="6" class="empty">Belum ada transaksi.</td></tr>`;
}

function renderCashflow(rows){
  const inc=Array(12).fill(0), exp=Array(12).fill(0);
  rows.forEach(t=>{
    const m=new Date(t.transaction_date+"T00:00:00").getMonth();
    if(t.transaction_type==="INCOME")inc[m]+=Number(t.amount||0);
    if(t.transaction_type==="EXPENSE")exp[m]+=Number(t.amount||0);
  });
  if(cashflowChart)cashflowChart.destroy();
  cashflowChart=new Chart($("cashflowChart"),{
    type:"line",
    data:{labels:["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"],
      datasets:[
        {label:"Pemasukan",data:inc,borderColor:"#F89921",backgroundColor:"rgba(248,153,33,.10)",fill:true,tension:.35,borderWidth:2,pointRadius:2},
        {label:"Pengeluaran",data:exp,borderColor:"#8C3F20",backgroundColor:"rgba(140,63,32,.03)",fill:false,tension:.35,borderWidth:2,pointRadius:2}
      ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"top",align:"end"},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${rupiah(c.raw)}`}}},
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,ticks:{callback:v=>shortMoney(v)},grid:{color:"#F0ECE7"}}}}
  });
}

function renderExpense(rows){
  const map=new Map();
  rows.filter(x=>x.transaction_type==="EXPENSE").forEach(x=>{
    const n=x.expense_categories?.name||"Lainnya";
    map.set(n,(map.get(n)||0)+Number(x.amount||0));
  });
  let labels=[...map.keys()], data=[...map.values()];
  const empty=!data.length;
  if(empty){labels=["Belum ada pengeluaran"];data=[1]}
  if(expenseChart)expenseChart.destroy();
  expenseChart=new Chart($("expenseChart"),{
    type:"doughnut",
    data:{labels,datasets:[{data,backgroundColor:empty?["#E7E3DE"]:["#F89921","#CD6828","#2D2A27","#E9B44C","#8C3F20","#F2C078","#6B5A49","#C97A40","#A69A8B"],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"67%",plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:8,font:{size:10}}},tooltip:{callbacks:{label:c=>empty?"Belum ada data":`${c.label}: ${rupiah(c.raw)}`}}}}
  });
}

/* =========================================================
   MODUL PEMASUKAN
   ========================================================= */

async function loadIncomeModule(){
  try{
    $("incomeTransactionsBody").innerHTML=`<tr><td colspan="8" class="empty">Memuat...</td></tr>`;

    const [instRes, accountRes, fundRes] = await Promise.all([
      sb.from("institutions").select("id,code,name,institution_type").eq("is_active",true).order("name"),
      sb.from("accounts").select("id,institution_id,account_name,account_type,bank_name,is_active").eq("is_active",true).order("account_name"),
      sb.from("fund_sources").select("id,code,name,is_active").eq("is_active",true).order("name")
    ]);
    [instRes,accountRes,fundRes].forEach(r=>{if(r.error)throw r.error});

    incomeInstitutions=instRes.data||[];
    incomeAccounts=accountRes.data||[];
    incomeFundSources=fundRes.data||[];

    fillIncomeMasterOptions();
    if(!$("incomeDate").value) $("incomeDate").value=todayISO();

    await loadIncomeTransactions();
  }catch(err){
    console.error(err);
    toast("Gagal memuat modul pemasukan: "+(err.message||"error"));
  }
}

function fillIncomeMasterOptions(){
  const instSelect=$("incomeInstitution");
  const fundSelect=$("incomeFundSource");

  instSelect.innerHTML=`<option value="">Pilih lembaga</option>`+
    incomeInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

  fundSelect.innerHTML=`<option value="">Pilih sumber dana</option>`+
    incomeFundSources.map(f=>`<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");

  if(!isCentralUser() && currentProfile?.institution_id){
    instSelect.value=currentProfile.institution_id;
    instSelect.disabled=true;
    refreshIncomeAccountOptions();
  }else{
    instSelect.disabled=false;
  }
}

function refreshIncomeAccountOptions(){
  const institutionId=$("incomeInstitution").value;
  const storageType=$("incomeStorageType").value;
  const accountSelect=$("incomeDestinationAccount");

  const rows=incomeAccounts.filter(a=>a.institution_id===institutionId && a.account_type===storageType);

  let placeholder="Pilih lembaga dan jenis penyimpanan";
  if(institutionId && !storageType) placeholder="Pilih Cash / Rekening terlebih dahulu";
  if(institutionId && storageType && !rows.length){
    placeholder=storageType==="CASH"
      ? "Belum ada akun Cash untuk lembaga ini"
      : "Belum ada rekening bank untuk lembaga ini";
  }
  if(rows.length) placeholder=storageType==="CASH" ? "Pilih Kas Tunai" : "Pilih Rekening Bank";

  accountSelect.innerHTML=`<option value="">${placeholder}</option>`+
    rows.map(a=>{
      const bankInfo=a.account_type==="BANK" && a.bank_name && a.bank_name!=="Belum Diisi"
        ? ` — ${escapeHtml(a.bank_name)}` : "";
      return `<option value="${a.id}">${escapeHtml(a.account_name)}${bankInfo}</option>`;
    }).join("");

  accountSelect.disabled=!institutionId || !storageType || !rows.length;

  if($("incomeStorageHelp")){
    $("incomeStorageHelp").textContent=storageType==="CASH"
      ? "Uang akan tercatat sebagai kas tunai, tetapi tetap masuk ke Total Buku Besar."
      : storageType==="BANK"
        ? "Uang akan tercatat di rekening bank, tetapi tetap masuk ke Total Buku Besar."
        : "Cash dan rekening tetap dijumlahkan sebagai satu saldo Buku Besar.";
  }
}

async function loadIncomeTransactions(){
  const {data,error}=await sb.from("transactions")
    .select(`
      id,
      transaction_number,
      transaction_date,
      amount,
      description,
      status,
      created_at,
      institution_id,
      destination_account_id,
      fund_source_id,
      institutions:institution_id(name),
      fund_sources:fund_source_id(name),
      accounts:destination_account_id(account_name,account_type,bank_name)
    `)
    .eq("transaction_type","INCOME")
    .order("transaction_date",{ascending:false})
    .order("created_at",{ascending:false})
    .limit(150);

  if(error) throw error;
  incomeRowsCache=data||[];
  updateIncomeModuleStats();
  renderIncomeRows();
}

function updateIncomeModuleStats(){
  const r=monthRange();
  const approvedRows=incomeRowsCache
    .filter(x=>x.status==="APPROVED" && x.transaction_date>=r.start && x.transaction_date<r.next);

  const approvedMonth=approvedRows.reduce((s,x)=>s+Number(x.amount||0),0);
  const cashMonth=approvedRows.filter(x=>x.accounts?.account_type==="CASH")
    .reduce((s,x)=>s+Number(x.amount||0),0);
  const bankMonth=approvedRows.filter(x=>x.accounts?.account_type==="BANK")
    .reduce((s,x)=>s+Number(x.amount||0),0);

  $("incomeModuleApproved").textContent=rupiah(approvedMonth);
  $("incomeCashApproved").textContent=rupiah(cashMonth);
  $("incomeBankApproved").textContent=rupiah(bankMonth);
  $("incomeDraftCount").textContent=incomeRowsCache.filter(x=>x.status==="DRAFT").length;
  $("incomeSubmittedCount").textContent=incomeRowsCache.filter(x=>x.status==="SUBMITTED").length;
}

function renderIncomeRows(){
  const term=($("incomeSearch").value||"").trim().toLowerCase();
  const status=$("incomeStatusFilter").value;
  const storage=$("incomeStorageFilter")?.value||"ALL";

  const rows=incomeRowsCache.filter(x=>{
    const hay=[
      x.transaction_number,
      x.description,
      x.institutions?.name,
      x.fund_sources?.name,
      x.accounts?.account_name,
      storageTypeLabel(x.accounts?.account_type)
    ].filter(Boolean).join(" ").toLowerCase();
    return (!term || hay.includes(term)) &&
      (status==="ALL" || x.status===status) &&
      (storage==="ALL" || x.accounts?.account_type===storage);
  });

  $("incomeTransactionsBody").innerHTML=rows.length?rows.map(row=>{
    const actions=[];
    const canCorrect=canCorrectTransactionType("INCOME");

    if(row.status==="DRAFT" && canCorrect){
      actions.push(`<button class="table-action edit" data-income-action="edit" data-id="${row.id}">Edit</button>`);
      actions.push(`<button class="table-action primary" data-income-action="submit" data-id="${row.id}">Ajukan</button>`);
      actions.push(`<button class="table-action delete" data-income-action="delete" data-id="${row.id}">Hapus</button>`);
    }
    if(row.status==="SUBMITTED"){
      if(canCorrect){
        actions.push(`<button class="table-action withdraw" data-income-action="withdraw" data-id="${row.id}">Tarik</button>`);
      }
      if(isCentralUser()){
        actions.push(`<button class="table-action approve" data-income-action="approve" data-id="${row.id}">Setujui</button>`);
        actions.push(`<button class="table-action reject" data-income-action="reject" data-id="${row.id}">Tolak</button>`);
      }
    }
    if(row.status==="REJECTED" && canCorrect){
      actions.push(`<button class="table-action fix" data-income-action="reopen" data-id="${row.id}">Perbaiki</button>`);
    }
    if(row.status==="APPROVED" && isCentralUser()){
      actions.push(`<button class="table-action void-action" data-income-action="void" data-id="${row.id}">VOID</button>`);
    }

    return `
      <tr>
        <td>${formatDate(row.transaction_date)}</td>
        <td><strong>${escapeHtml(row.transaction_number||"-")}</strong><span class="account-sub description-cell" title="${escapeHtml(row.description||"")}">${escapeHtml(row.description||"")}</span></td>
        <td>${escapeHtml(row.institutions?.name||"-")}</td>
        <td>${escapeHtml(row.fund_sources?.name||"-")}</td>
        <td><span class="storage-chip ${storageTypeClass(row.accounts?.account_type)}">${escapeHtml(storageTypeLabel(row.accounts?.account_type))}</span></td>
        <td>${escapeHtml(row.accounts?.account_name||"-")}</td>
        <td><strong>${rupiah(row.amount)}</strong></td>
        <td><span class="pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td><div class="action-group">${actions.join("") || `<span class="account-sub">—</span>`}</div></td>
      </tr>`;
  }).join(""):`<tr><td colspan="9" class="empty">Belum ada data pemasukan sesuai filter.</td></tr>`;
}

function setIncomeEditMode(active){
  $("incomeFormCard").classList.toggle("editing-transaction",active);
  $("incomeFormTitle").textContent=active?"Edit Pemasukan Draft":"Input Pemasukan";
  $("incomeFormSubtitle").textContent=active
    ?"Perubahan hanya dapat dilakukan selama status masih DRAFT."
    :"Lengkapi informasi dana yang diterima.";
  $("saveIncomeDraftBtn").textContent=active?"Simpan Perubahan":"Simpan Draft";
  $("saveIncomeSubmitBtn").classList.toggle("hidden",active);
  $("cancelIncomeEditBtn").classList.toggle("hidden",!active);
}

function resetIncomeForm(){
  editingIncomeId=null;
  setIncomeEditMode(false);
  $("incomeForm").reset();
  $("incomeDate").value=todayISO();
  $("incomeAmountPreview").textContent="Rp0";
  if(!isCentralUser() && currentProfile?.institution_id){
    $("incomeInstitution").value=currentProfile.institution_id;
    $("incomeInstitution").disabled=true;
    refreshIncomeAccountOptions();
  }else{
    $("incomeInstitution").disabled=false;
    $("incomeDestinationAccount").innerHTML=`<option value="">Pilih jenis penyimpanan terlebih dahulu</option>`;
    $("incomeDestinationAccount").disabled=true;
  }
}

function startEditIncome(id){
  const row=incomeRowsCache.find(x=>x.id===id);
  if(!row) throw new Error("Transaksi tidak ditemukan.");
  if(row.status!=="DRAFT") throw new Error("Hanya transaksi DRAFT yang dapat diedit.");
  if(!canCorrectTransactionType("INCOME")) throw new Error("Anda tidak memiliki hak untuk mengedit transaksi ini.");

  editingIncomeId=id;
  setIncomeEditMode(true);

  $("incomeDate").value=row.transaction_date;
  $("incomeInstitution").value=row.institution_id;
  $("incomeFundSource").value=row.fund_source_id||"";
  $("incomeStorageType").value=row.accounts?.account_type||"";
  refreshIncomeAccountOptions();
  $("incomeDestinationAccount").value=row.destination_account_id||"";
  $("incomeAmount").value=Number(row.amount||0);
  $("incomeAmountPreview").textContent=rupiah(row.amount);
  $("incomeDescription").value=row.description||"";

  $("incomeFormCard").scrollIntoView({behavior:"smooth",block:"start"});
}

async function saveIncome(action){
  if(!currentSession?.user?.id) throw new Error("Sesi login tidak ditemukan.");

  const institution_id=$("incomeInstitution").value;
  const fund_source_id=$("incomeFundSource").value;
  const destination_account_id=$("incomeDestinationAccount").value;
  const transaction_date=$("incomeDate").value;
  const amount=Number($("incomeAmount").value);
  const description=($("incomeDescription").value||"").trim();
  const storage_type=$("incomeStorageType").value;

  if(!transaction_date||!institution_id||!fund_source_id||!storage_type||!destination_account_id||!amount||amount<=0){
    throw new Error("Lengkapi tanggal, lembaga, sumber dana, penyimpanan Cash/Rekening, akun tujuan, dan nominal.");
  }

  const selectedAccount=incomeAccounts.find(a=>a.id===destination_account_id);
  if(!selectedAccount || selectedAccount.institution_id!==institution_id){
    throw new Error("Akun tujuan tidak sesuai dengan lembaga yang dipilih.");
  }
  if(selectedAccount.account_type!==storage_type){
    throw new Error("Jenis penyimpanan tidak sesuai dengan akun tujuan. Pilih ulang Cash/Rekening.");
  }

  if(editingIncomeId){
    const {error:editError}=await sb.rpc("edit_draft_transaction",{
      p_transaction_id:editingIncomeId,
      p_transaction_date:transaction_date,
      p_institution_id:institution_id,
      p_fund_source_id:fund_source_id,
      p_expense_category_id:null,
      p_source_account_id:null,
      p_destination_account_id:destination_account_id,
      p_amount:amount,
      p_description:description||null
    });
    if(editError) throw editError;

    resetIncomeForm();
    await Promise.all([loadIncomeTransactions(),loadDashboard()]);
    toast("Pemasukan Draft berhasil diperbarui.");
    return;
  }

  const payload={
    transaction_type:"INCOME",
    transaction_date,
    institution_id,
    fund_source_id,
    destination_account_id,
    source_account_id:null,
    expense_category_id:null,
    amount,
    description:description||null,
    status:"DRAFT",
    created_by:currentSession.user.id
  };

  const {data,error}=await sb.from("transactions").insert(payload).select("id,transaction_number").single();
  if(error) throw error;

  if(action==="submit"){
    const {error:submitError}=await sb.rpc("submit_transaction",{p_transaction_id:data.id});
    if(submitError) throw submitError;
  }

  resetIncomeForm();
  await Promise.all([loadIncomeTransactions(),loadDashboard()]);
  toast(action==="submit" ? `Pemasukan ${data.transaction_number} berhasil diajukan.` : `Pemasukan ${data.transaction_number} disimpan sebagai Draft.`);
}

async function submitExistingIncome(id){
  const {error}=await sb.rpc("submit_transaction",{p_transaction_id:id});
  if(error) throw error;
  await Promise.all([loadIncomeTransactions(),loadDashboard()]);
  toast("Transaksi berhasil diajukan untuk approval.");
}

async function approveIncome(id){
  if(!confirm("Setujui transaksi pemasukan ini? Setelah APPROVED, transaksi akan memengaruhi saldo.")) return;
  const {error}=await sb.rpc("approve_transaction",{p_transaction_id:id,p_note:"Disetujui melalui SIMKEU"});
  if(error) throw error;
  await Promise.all([loadIncomeTransactions(),loadDashboard()]);
  toast("Pemasukan disetujui. Saldo sudah diperbarui.");
}

async function rejectIncome(id){
  const note=prompt("Masukkan alasan penolakan:");
  if(note===null) return;
  if(!note.trim()){toast("Alasan penolakan wajib diisi.");return}
  const {error}=await sb.rpc("reject_transaction",{p_transaction_id:id,p_note:note.trim()});
  if(error) throw error;
  await Promise.all([loadIncomeTransactions(),loadDashboard()]);
  toast("Transaksi pemasukan ditolak.");
}


/* =========================================================
   MODUL PENGELUARAN + BUKTI TRANSAKSI
   ========================================================= */

async function loadExpenseModule(){
  try{
    $("expenseTransactionsBody").innerHTML=`<tr><td colspan="9" class="empty">Memuat...</td></tr>`;

    const [instRes, accountRes, catRes] = await Promise.all([
      sb.from("institutions").select("id,code,name,institution_type").eq("is_active",true).order("name"),
      sb.from("accounts").select("id,institution_id,account_name,account_type,bank_name,is_active").eq("is_active",true).order("account_name"),
      sb.from("expense_categories").select("id,code,name,is_active").eq("is_active",true).order("name")
    ]);
    [instRes,accountRes,catRes].forEach(r=>{if(r.error)throw r.error});

    expenseInstitutions=instRes.data||[];
    expenseAccounts=accountRes.data||[];
    expenseCategories=catRes.data||[];

    fillExpenseMasterOptions();
    if(!$("expenseDate").value) $("expenseDate").value=todayISO();

    await loadExpenseTransactions();
  }catch(err){
    console.error(err);
    toast("Gagal memuat modul pengeluaran: "+(err.message||"error"));
  }
}

function fillExpenseMasterOptions(){
  const instSelect=$("expenseInstitution");
  const catSelect=$("expenseCategory");

  instSelect.innerHTML=`<option value="">Pilih lembaga</option>`+
    expenseInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

  catSelect.innerHTML=`<option value="">Pilih kategori</option>`+
    expenseCategories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  if(!isCentralUser() && currentProfile?.institution_id){
    instSelect.value=currentProfile.institution_id;
    instSelect.disabled=true;
    refreshExpenseAccountOptions();
  }else{
    instSelect.disabled=false;
  }
}

function refreshExpenseAccountOptions(){
  const institutionId=$("expenseInstitution").value;
  const accountSelect=$("expenseSourceAccount");
  const rows=expenseAccounts.filter(a=>a.institution_id===institutionId);

  accountSelect.innerHTML=`<option value="">Pilih kas/bank sumber</option>`+
    rows.map(a=>`<option value="${a.id}">${escapeHtml(a.account_name)}${a.bank_name&&a.bank_name!=="Belum Diisi" ? " — "+escapeHtml(a.bank_name) : ""}</option>`).join("");

  accountSelect.disabled=!institutionId || !rows.length;
}

async function loadExpenseTransactions(){
  const {data,error}=await sb.from("transactions")
    .select(`
      id,
      transaction_number,
      transaction_date,
      amount,
      description,
      status,
      created_at,
      institution_id,
      source_account_id,
      expense_category_id,
      institutions:institution_id(name),
      expense_categories:expense_category_id(name),
      accounts:source_account_id(account_name,account_type,bank_name),
      transaction_attachments(id,file_name,file_path,file_type,uploaded_at)
    `)
    .eq("transaction_type","EXPENSE")
    .order("transaction_date",{ascending:false})
    .order("created_at",{ascending:false})
    .limit(150);

  if(error) throw error;
  expenseRowsCache=data||[];
  updateExpenseModuleStats();
  renderExpenseRows();
}

function updateExpenseModuleStats(){
  const r=monthRange();
  const approvedMonth=expenseRowsCache
    .filter(x=>x.status==="APPROVED" && x.transaction_date>=r.start && x.transaction_date<r.next)
    .reduce((s,x)=>s+Number(x.amount||0),0);

  $("expenseModuleApproved").textContent=rupiah(approvedMonth);
  $("expenseDraftCount").textContent=expenseRowsCache.filter(x=>x.status==="DRAFT").length;
  $("expenseSubmittedCount").textContent=expenseRowsCache.filter(x=>x.status==="SUBMITTED").length;
}

function renderExpenseRows(){
  const term=($("expenseSearch").value||"").trim().toLowerCase();
  const status=$("expenseStatusFilter").value;

  const rows=expenseRowsCache.filter(x=>{
    const hay=[
      x.transaction_number,
      x.description,
      x.institutions?.name,
      x.expense_categories?.name,
      x.accounts?.account_name
    ].filter(Boolean).join(" ").toLowerCase();
    return (!term || hay.includes(term)) && (status==="ALL" || x.status===status);
  });

  $("expenseTransactionsBody").innerHTML=rows.length?rows.map(row=>{
    const actions=[];
    const canCorrect=canCorrectTransactionType("EXPENSE");

    if(row.status==="DRAFT" && canCorrect){
      actions.push(`<button class="table-action edit" data-expense-action="edit" data-id="${row.id}">Edit</button>`);
      actions.push(`<button class="table-action primary" data-expense-action="submit" data-id="${row.id}">Ajukan</button>`);
      actions.push(`<button class="table-action delete" data-expense-action="delete" data-id="${row.id}">Hapus</button>`);
    }
    if(row.status==="SUBMITTED"){
      if(canCorrect){
        actions.push(`<button class="table-action withdraw" data-expense-action="withdraw" data-id="${row.id}">Tarik</button>`);
      }
      if(isCentralUser()){
        actions.push(`<button class="table-action approve" data-expense-action="approve" data-id="${row.id}">Setujui</button>`);
        actions.push(`<button class="table-action reject" data-expense-action="reject" data-id="${row.id}">Tolak</button>`);
      }
    }
    if(row.status==="REJECTED" && canCorrect){
      actions.push(`<button class="table-action fix" data-expense-action="reopen" data-id="${row.id}">Perbaiki</button>`);
    }
    if(row.status==="APPROVED" && isCentralUser()){
      actions.push(`<button class="table-action void-action" data-expense-action="void" data-id="${row.id}">VOID</button>`);
    }

    const proofs=row.transaction_attachments||[];
    const proofCell=proofs.length
      ? `<button class="proof-btn" data-expense-action="proof" data-id="${row.id}">Lihat Bukti (${proofs.length})</button>`
      : `<span class="proof-missing">Belum ada</span>`;

    return `
      <tr>
        <td>${formatDate(row.transaction_date)}</td>
        <td><strong>${escapeHtml(row.transaction_number||"-")}</strong><span class="account-sub description-cell" title="${escapeHtml(row.description||"")}">${escapeHtml(row.description||"")}</span></td>
        <td>${escapeHtml(row.institutions?.name||"-")}</td>
        <td>${escapeHtml(row.expense_categories?.name||"-")}</td>
        <td>${escapeHtml(row.accounts?.account_name||"-")}</td>
        <td><strong>${rupiah(row.amount)}</strong></td>
        <td>${proofCell}</td>
        <td><span class="pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td><div class="action-group">${actions.join("") || `<span class="account-sub">—</span>`}</div></td>
      </tr>`;
  }).join(""):`<tr><td colspan="9" class="empty">Belum ada data pengeluaran sesuai filter.</td></tr>`;
}

function setExpenseEditMode(active){
  $("expenseFormCard").classList.toggle("editing-transaction",active);
  $("expenseFormTitle").textContent=active?"Edit Pengeluaran Draft":"Input Pengeluaran";
  $("expenseFormSubtitle").textContent=active
    ?"Perbaiki data Draft. File bukti baru (jika dipilih) akan ditambahkan ke bukti yang sudah ada."
    :"Bukti nota/kuitansi dapat diunggah langsung dari HP.";
  $("saveExpenseDraftBtn").textContent=active?"Simpan Perubahan":"Simpan Draft";
  $("saveExpenseSubmitBtn").classList.toggle("hidden",active);
  $("cancelExpenseEditBtn").classList.toggle("hidden",!active);
}

function resetExpenseForm(){
  editingExpenseId=null;
  setExpenseEditMode(false);
  $("expenseForm").reset();
  $("expenseDate").value=todayISO();
  $("expenseAmountPreview").textContent="Rp0";
  $("expenseProofName").textContent="Belum ada file dipilih";

  if(!isCentralUser() && currentProfile?.institution_id){
    $("expenseInstitution").value=currentProfile.institution_id;
    $("expenseInstitution").disabled=true;
    refreshExpenseAccountOptions();
  }else{
    $("expenseInstitution").disabled=false;
    $("expenseSourceAccount").innerHTML=`<option value="">Pilih kas/bank sumber</option>`;
    $("expenseSourceAccount").disabled=true;
  }
}

function startEditExpense(id){
  const row=expenseRowsCache.find(x=>x.id===id);
  if(!row) throw new Error("Transaksi tidak ditemukan.");
  if(row.status!=="DRAFT") throw new Error("Hanya transaksi DRAFT yang dapat diedit.");
  if(!canCorrectTransactionType("EXPENSE")) throw new Error("Anda tidak memiliki hak untuk mengedit transaksi ini.");

  editingExpenseId=id;
  setExpenseEditMode(true);

  $("expenseDate").value=row.transaction_date;
  $("expenseInstitution").value=row.institution_id;
  refreshExpenseAccountOptions();
  $("expenseCategory").value=row.expense_category_id||"";
  $("expenseSourceAccount").value=row.source_account_id||"";
  $("expenseAmount").value=Number(row.amount||0);
  $("expenseAmountPreview").textContent=rupiah(row.amount);
  $("expenseDescription").value=row.description||"";
  $("expenseProof").value="";
  $("expenseProofName").textContent=(row.transaction_attachments||[]).length
    ? `${row.transaction_attachments.length} bukti sudah tersimpan • pilih file hanya jika ingin menambah bukti`
    : "Belum ada bukti • Anda dapat menambahkan file sekarang";

  $("expenseFormCard").scrollIntoView({behavior:"smooth",block:"start"});
}

function safeFileName(name){
  return String(name||"bukti")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g,"_")
    .replace(/_+/g,"_")
    .slice(-120);
}

async function uploadExpenseProof(transactionId,file){
  if(!file) return null;
  if(file.size>5*1024*1024) throw new Error("Ukuran bukti maksimal 5 MB.");

  const allowed=["image/jpeg","image/png","image/webp","application/pdf"];
  if(!allowed.includes(file.type)) throw new Error("Format bukti harus JPG, PNG, WEBP, atau PDF.");

  const path=`${transactionId}/${Date.now()}_${safeFileName(file.name)}`;
  const {error:uploadError}=await sb.storage
    .from("transaction-proofs")
    .upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});

  if(uploadError) throw uploadError;

  const {error:metaError}=await sb.from("transaction_attachments").insert({
    transaction_id:transactionId,
    file_name:file.name,
    file_path:path,
    file_type:file.type,
    uploaded_by:currentSession.user.id
  });

  if(metaError){
    await sb.storage.from("transaction-proofs").remove([path]);
    throw metaError;
  }

  return path;
}

async function saveExpense(action){
  if(!currentSession?.user?.id) throw new Error("Sesi login tidak ditemukan.");

  const institution_id=$("expenseInstitution").value;
  const expense_category_id=$("expenseCategory").value;
  const source_account_id=$("expenseSourceAccount").value;
  const transaction_date=$("expenseDate").value;
  const amount=Number($("expenseAmount").value);
  const description=($("expenseDescription").value||"").trim();
  const file=$("expenseProof").files?.[0]||null;

  if(!transaction_date||!institution_id||!expense_category_id||!source_account_id||!amount||amount<=0){
    throw new Error("Lengkapi tanggal, lembaga, kategori, akun sumber, dan nominal.");
  }

  if(action==="submit" && !file){
    throw new Error("Bukti transaksi wajib diunggah sebelum pengeluaran diajukan.");
  }

  const selectedAccount=expenseAccounts.find(a=>a.id===source_account_id);
  if(!selectedAccount || selectedAccount.institution_id!==institution_id){
    throw new Error("Akun sumber tidak sesuai dengan lembaga yang dipilih.");
  }

  if(editingExpenseId){
    const {error:editError}=await sb.rpc("edit_draft_transaction",{
      p_transaction_id:editingExpenseId,
      p_transaction_date:transaction_date,
      p_institution_id:institution_id,
      p_fund_source_id:null,
      p_expense_category_id:expense_category_id,
      p_source_account_id:source_account_id,
      p_destination_account_id:null,
      p_amount:amount,
      p_description:description||null
    });
    if(editError) throw editError;

    if(file) await uploadExpenseProof(editingExpenseId,file);

    resetExpenseForm();
    await Promise.all([loadExpenseTransactions(),loadDashboard()]);
    toast("Pengeluaran Draft berhasil diperbarui.");
    return;
  }

  const payload={
    transaction_type:"EXPENSE",
    transaction_date,
    institution_id,
    fund_source_id:null,
    expense_category_id,
    source_account_id,
    destination_account_id:null,
    amount,
    description:description||null,
    status:"DRAFT",
    created_by:currentSession.user.id
  };

  const {data,error}=await sb.from("transactions").insert(payload).select("id,transaction_number").single();
  if(error) throw error;

  try{
    if(file) await uploadExpenseProof(data.id,file);

    if(action==="submit"){
      const {error:submitError}=await sb.rpc("submit_transaction",{p_transaction_id:data.id});
      if(submitError) throw submitError;
    }
  }catch(err){
    // Keep the draft transaction if proof/submission fails so there is an audit trail.
    throw new Error(`${err.message || "Gagal memproses bukti/submit"}. Transaksi tersimpan sebagai Draft.`);
  }

  resetExpenseForm();
  await Promise.all([loadExpenseTransactions(),loadDashboard()]);
  toast(action==="submit" ? `Pengeluaran ${data.transaction_number} berhasil diajukan.` : `Pengeluaran ${data.transaction_number} disimpan sebagai Draft.`);
}

async function submitExistingExpense(id){
  const row=expenseRowsCache.find(x=>x.id===id);
  const proofs=row?.transaction_attachments||[];
  if(!proofs.length){
    throw new Error("Transaksi belum memiliki bukti. Unggah bukti melalui form transaksi baru atau lengkapi bukti sebelum diajukan.");
  }
  const {error}=await sb.rpc("submit_transaction",{p_transaction_id:id});
  if(error) throw error;
  await Promise.all([loadExpenseTransactions(),loadDashboard()]);
  toast("Pengeluaran berhasil diajukan untuk approval.");
}

async function approveExpense(id){
  const row=expenseRowsCache.find(x=>x.id===id);
  if(!(row?.transaction_attachments||[]).length){
    throw new Error("Tidak dapat menyetujui pengeluaran tanpa bukti transaksi.");
  }
  if(!confirm("Setujui pengeluaran ini? Setelah APPROVED, saldo akun akan berkurang.")) return;
  const {error}=await sb.rpc("approve_transaction",{p_transaction_id:id,p_note:"Disetujui melalui SIMKEU"});
  if(error) throw error;
  await Promise.all([loadExpenseTransactions(),loadDashboard()]);
  toast("Pengeluaran disetujui. Saldo sudah diperbarui.");
}

async function rejectExpense(id){
  const note=prompt("Masukkan alasan penolakan:");
  if(note===null) return;
  if(!note.trim()){toast("Alasan penolakan wajib diisi.");return}
  const {error}=await sb.rpc("reject_transaction",{p_transaction_id:id,p_note:note.trim()});
  if(error) throw error;
  await Promise.all([loadExpenseTransactions(),loadDashboard()]);
  toast("Transaksi pengeluaran ditolak.");
}

async function viewExpenseProof(id){
  const row=expenseRowsCache.find(x=>x.id===id);
  const proofs=row?.transaction_attachments||[];
  if(!proofs.length) throw new Error("Bukti transaksi tidak ditemukan.");

  // Open first proof; if more than one, user can use repeated click after selecting in prompt
  let chosen=proofs[0];
  if(proofs.length>1){
    const list=proofs.map((p,i)=>`${i+1}. ${p.file_name}`).join("\n");
    const pick=prompt(`Pilih nomor bukti yang ingin dibuka:\n\n${list}`,"1");
    if(pick===null) return;
    const idx=Number(pick)-1;
    if(!Number.isInteger(idx)||idx<0||idx>=proofs.length) throw new Error("Pilihan bukti tidak valid.");
    chosen=proofs[idx];
  }

  const {data,error}=await sb.storage
    .from("transaction-proofs")
    .createSignedUrl(chosen.file_path,60);

  if(error) throw error;
  window.open(data.signedUrl,"_blank","noopener,noreferrer");
}


/* =========================================================
   MODUL TRANSFER INTERNAL
   ========================================================= */

async function loadTransferModule(){
  try{
    $("transferTransactionsBody").innerHTML=`<tr><td colspan="7" class="empty">Memuat...</td></tr>`;

    const [instRes, accountRes, balanceRes] = await Promise.all([
      sb.from("institutions").select("id,code,name,institution_type").eq("is_active",true).order("name"),
      sb.from("accounts").select("id,institution_id,account_name,account_type,bank_name,is_active").eq("is_active",true).order("account_name"),
      sb.from("v_account_balances").select("account_id,institution_id,institution_name,account_name,current_balance")
    ]);
    [instRes,accountRes,balanceRes].forEach(r=>{if(r.error)throw r.error});

    transferInstitutions=instRes.data||[];
    transferAccounts=accountRes.data||[];
    transferBalances=balanceRes.data||[];

    fillTransferMasterOptions();
    if(!$("transferDate").value) $("transferDate").value=todayISO();

    // Admin lembaga boleh membaca transfer yang menyentuh akunnya, tetapi tidak membuat transfer baru.
    const canCreate=isCentralUser();
    [
      "transferDate","transferSourceInstitution","transferSourceAccount",
      "transferDestinationInstitution","transferDestinationAccount",
      "transferAmount","transferDescription","saveTransferDraftBtn","saveTransferSubmitBtn"
    ].forEach(id=>{
      const node=$(id);
      if(node) node.disabled=!canCreate || (["transferSourceAccount","transferDestinationAccount"].includes(id) && !node.value);
    });

    $("newTransferBtn").style.display=canCreate ? "" : "none";

    const existing=$("transferFormCard").querySelector(".central-only-note");
    if(!canCreate && !existing){
      const note=document.createElement("div");
      note.className="central-only-note";
      note.textContent="Akun lembaga dapat melihat transfer yang berkaitan dengan lembaganya, tetapi pembuatan transfer baru hanya dapat dilakukan oleh Yayasan.";
      $("transferFormCard").prepend(note);
    }

    await loadTransferTransactions();
  }catch(err){
    console.error(err);
    toast("Gagal memuat transfer internal: "+(err.message||"error"));
  }
}

function fillTransferMasterOptions(){
  const sourceInst=$("transferSourceInstitution");
  const destInst=$("transferDestinationInstitution");
  const options=`<option value="">Pilih lembaga</option>`+
    transferInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

  sourceInst.innerHTML=options;
  destInst.innerHTML=options;

  $("transferSourceAccount").innerHTML=`<option value="">Pilih kas/bank sumber</option>`;
  $("transferDestinationAccount").innerHTML=`<option value="">Pilih kas/bank tujuan</option>`;
  $("transferSourceAccount").disabled=true;
  $("transferDestinationAccount").disabled=true;
  updateTransferBalanceHint();
}

function refreshTransferSourceAccounts(){
  const institutionId=$("transferSourceInstitution").value;
  const accountSelect=$("transferSourceAccount");
  const rows=transferAccounts.filter(a=>a.institution_id===institutionId);

  accountSelect.innerHTML=`<option value="">Pilih kas/bank sumber</option>`+
    rows.map(a=>`<option value="${a.id}">${escapeHtml(a.account_name)}${a.bank_name&&a.bank_name!=="Belum Diisi" ? " — "+escapeHtml(a.bank_name) : ""}</option>`).join("");

  accountSelect.disabled=!isCentralUser() || !institutionId || !rows.length;
  updateTransferBalanceHint();
  validateDifferentTransferAccounts();
}

function refreshTransferDestinationAccounts(){
  const institutionId=$("transferDestinationInstitution").value;
  const accountSelect=$("transferDestinationAccount");
  const sourceId=$("transferSourceAccount").value;
  const rows=transferAccounts.filter(a=>a.institution_id===institutionId && a.id!==sourceId);

  accountSelect.innerHTML=`<option value="">Pilih kas/bank tujuan</option>`+
    rows.map(a=>`<option value="${a.id}">${escapeHtml(a.account_name)}${a.bank_name&&a.bank_name!=="Belum Diisi" ? " — "+escapeHtml(a.bank_name) : ""}</option>`).join("");

  accountSelect.disabled=!isCentralUser() || !institutionId || !rows.length;
  validateDifferentTransferAccounts();
}

function validateDifferentTransferAccounts(){
  const source=$("transferSourceAccount").value;
  const dest=$("transferDestinationAccount").value;
  if(source && dest && source===dest){
    $("transferDestinationAccount").value="";
    toast("Akun sumber dan tujuan transfer tidak boleh sama.");
  }
}

function updateTransferBalanceHint(){
  const sourceId=$("transferSourceAccount").value;
  const amount=Number($("transferAmount").value||0);
  const balanceRow=transferBalances.find(b=>b.account_id===sourceId);
  const balance=Number(balanceRow?.current_balance||0);
  const hint=$("transferSourceBalance");

  hint.textContent=sourceId ? `Saldo tersedia: ${rupiah(balance)}` : "Saldo tersedia: —";
  hint.classList.toggle("insufficient",!!sourceId && amount>balance);
  if(sourceId && amount>balance){
    hint.textContent=`Saldo tersedia: ${rupiah(balance)} — nominal transfer melebihi saldo`;
  }
}

async function loadTransferTransactions(){
  const {data,error}=await sb.from("transactions")
    .select(`
      id,
      transaction_number,
      transaction_date,
      amount,
      description,
      status,
      created_at,
      institution_id,
      source_account_id,
      destination_account_id,
      institutions:institution_id(name),
      source_account:source_account_id(account_name,institution_id),
      destination_account:destination_account_id(account_name,institution_id)
    `)
    .eq("transaction_type","TRANSFER")
    .order("transaction_date",{ascending:false})
    .order("created_at",{ascending:false})
    .limit(150);

  if(error) throw error;

  transferRowsCache=data||[];

  // Resolve institution names from account institution_id
  const instMap=new Map(transferInstitutions.map(i=>[i.id,i.name]));
  transferRowsCache.forEach(r=>{
    r._sourceInstitutionName=instMap.get(r.source_account?.institution_id)||r.institutions?.name||"-";
    r._destinationInstitutionName=instMap.get(r.destination_account?.institution_id)||"-";
  });

  updateTransferModuleStats();
  renderTransferRows();
}

function updateTransferModuleStats(){
  const r=monthRange();
  const approvedMonth=transferRowsCache
    .filter(x=>x.status==="APPROVED" && x.transaction_date>=r.start && x.transaction_date<r.next)
    .reduce((s,x)=>s+Number(x.amount||0),0);

  $("transferModuleApproved").textContent=rupiah(approvedMonth);
  $("transferDraftCount").textContent=transferRowsCache.filter(x=>x.status==="DRAFT").length;
  $("transferSubmittedCount").textContent=transferRowsCache.filter(x=>x.status==="SUBMITTED").length;
}

function renderTransferRows(){
  const term=($("transferSearch").value||"").trim().toLowerCase();
  const status=$("transferStatusFilter").value;

  const rows=transferRowsCache.filter(x=>{
    const hay=[
      x.transaction_number,x.description,x._sourceInstitutionName,x._destinationInstitutionName,
      x.source_account?.account_name,x.destination_account?.account_name
    ].filter(Boolean).join(" ").toLowerCase();
    return (!term || hay.includes(term)) && (status==="ALL" || x.status===status);
  });

  $("transferTransactionsBody").innerHTML=rows.length?rows.map(row=>{
    const actions=[];
    if(row.status==="DRAFT" && isCentralUser()){
      actions.push(`<button class="table-action edit" data-transfer-action="edit" data-id="${row.id}">Edit</button>`);
      actions.push(`<button class="table-action primary" data-transfer-action="submit" data-id="${row.id}">Ajukan</button>`);
      actions.push(`<button class="table-action delete" data-transfer-action="delete" data-id="${row.id}">Hapus</button>`);
    }
    if(row.status==="SUBMITTED" && isCentralUser()){
      actions.push(`<button class="table-action withdraw" data-transfer-action="withdraw" data-id="${row.id}">Tarik</button>`);
      actions.push(`<button class="table-action approve" data-transfer-action="approve" data-id="${row.id}">Setujui</button>`);
      actions.push(`<button class="table-action reject" data-transfer-action="reject" data-id="${row.id}">Tolak</button>`);
    }
    if(row.status==="REJECTED" && isCentralUser()){
      actions.push(`<button class="table-action fix" data-transfer-action="reopen" data-id="${row.id}">Perbaiki</button>`);
    }
    if(row.status==="APPROVED" && isCentralUser()){
      actions.push(`<button class="table-action void-action" data-transfer-action="void" data-id="${row.id}">VOID</button>`);
    }

    return `
      <tr>
        <td>${formatDate(row.transaction_date)}</td>
        <td><strong>${escapeHtml(row.transaction_number||"-")}</strong><span class="account-sub description-cell" title="${escapeHtml(row.description||"")}">${escapeHtml(row.description||"")}</span></td>
        <td>
          <div class="route-node">
            <strong>${escapeHtml(row._sourceInstitutionName)}</strong>
            <small>${escapeHtml(row.source_account?.account_name||"-")}</small>
          </div>
        </td>
        <td>
          <div class="route-node">
            <strong>${escapeHtml(row._destinationInstitutionName)}</strong>
            <small>${escapeHtml(row.destination_account?.account_name||"-")}</small>
          </div>
        </td>
        <td><strong>${rupiah(row.amount)}</strong></td>
        <td><span class="pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td><div class="action-group">${actions.join("") || `<span class="account-sub">—</span>`}</div></td>
      </tr>`;
  }).join(""):`<tr><td colspan="7" class="empty">Belum ada transfer internal sesuai filter.</td></tr>`;
}

function setTransferEditMode(active){
  $("transferFormCard").classList.toggle("editing-transaction",active);
  $("transferFormTitle").textContent=active?"Edit Transfer Draft":"Form Transfer Internal";
  $("transferFormSubtitle").textContent=active
    ?"Perubahan transfer hanya dapat dilakukan selama status masih DRAFT."
    :"Pilih akun sumber dan akun tujuan.";
  $("saveTransferDraftBtn").textContent=active?"Simpan Perubahan":"Simpan Draft";
  $("saveTransferSubmitBtn").classList.toggle("hidden",active);
  $("cancelTransferEditBtn").classList.toggle("hidden",!active);
}

function resetTransferForm(){
  editingTransferId=null;
  setTransferEditMode(false);
  $("transferForm").reset();
  $("transferDate").value=todayISO();
  $("transferAmountPreview").textContent="Rp0";
  fillTransferMasterOptions();
}

function startEditTransfer(id){
  const row=transferRowsCache.find(x=>x.id===id);
  if(!row) throw new Error("Transfer tidak ditemukan.");
  if(row.status!=="DRAFT") throw new Error("Hanya transfer DRAFT yang dapat diedit.");
  if(!isCentralUser()) throw new Error("Hanya akun Yayasan yang dapat mengedit transfer.");

  editingTransferId=id;
  setTransferEditMode(true);

  $("transferDate").value=row.transaction_date;
  $("transferSourceInstitution").value=row.institution_id;
  refreshTransferSourceAccounts();
  $("transferSourceAccount").value=row.source_account_id||"";
  updateTransferBalanceHint();

  const destinationInstitutionId=row.destination_account?.institution_id||"";
  $("transferDestinationInstitution").value=destinationInstitutionId;
  refreshTransferDestinationAccounts();
  $("transferDestinationAccount").value=row.destination_account_id||"";

  $("transferAmount").value=Number(row.amount||0);
  $("transferAmountPreview").textContent=rupiah(row.amount);
  $("transferDescription").value=row.description||"";
  updateTransferBalanceHint();

  $("transferFormCard").scrollIntoView({behavior:"smooth",block:"start"});
}

async function saveTransfer(action){
  if(!isCentralUser()) throw new Error("Hanya Yayasan yang dapat membuat transfer internal.");
  if(!currentSession?.user?.id) throw new Error("Sesi login tidak ditemukan.");

  const transaction_date=$("transferDate").value;
  const sourceInstitutionId=$("transferSourceInstitution").value;
  const source_account_id=$("transferSourceAccount").value;
  const destinationInstitutionId=$("transferDestinationInstitution").value;
  const destination_account_id=$("transferDestinationAccount").value;
  const amount=Number($("transferAmount").value);
  const description=($("transferDescription").value||"").trim();

  if(!transaction_date||!sourceInstitutionId||!source_account_id||!destinationInstitutionId||!destination_account_id||!amount||amount<=0){
    throw new Error("Lengkapi tanggal, sumber, tujuan, dan nominal transfer.");
  }
  if(source_account_id===destination_account_id){
    throw new Error("Akun sumber dan tujuan tidak boleh sama.");
  }

  const sourceAccount=transferAccounts.find(a=>a.id===source_account_id);
  const destAccount=transferAccounts.find(a=>a.id===destination_account_id);
  if(!sourceAccount || sourceAccount.institution_id!==sourceInstitutionId){
    throw new Error("Akun sumber tidak sesuai dengan lembaga sumber.");
  }
  if(!destAccount || destAccount.institution_id!==destinationInstitutionId){
    throw new Error("Akun tujuan tidak sesuai dengan lembaga tujuan.");
  }

  const balanceRow=transferBalances.find(b=>b.account_id===source_account_id);
  const sourceBalance=Number(balanceRow?.current_balance||0);

  if(action==="submit" && amount>sourceBalance){
    throw new Error(`Saldo akun sumber tidak cukup. Saldo tersedia ${rupiah(sourceBalance)}.`);
  }

  if(editingTransferId){
    const {error:editError}=await sb.rpc("edit_draft_transaction",{
      p_transaction_id:editingTransferId,
      p_transaction_date:transaction_date,
      p_institution_id:sourceInstitutionId,
      p_fund_source_id:null,
      p_expense_category_id:null,
      p_source_account_id:source_account_id,
      p_destination_account_id:destination_account_id,
      p_amount:amount,
      p_description:description||null
    });
    if(editError) throw editError;

    resetTransferForm();
    await Promise.all([loadTransferModule(),loadDashboard()]);
    toast("Transfer Draft berhasil diperbarui.");
    return;
  }

  const payload={
    transaction_type:"TRANSFER",
    transaction_date,
    institution_id:sourceInstitutionId,
    fund_source_id:null,
    expense_category_id:null,
    source_account_id,
    destination_account_id,
    amount,
    description:description||null,
    status:"DRAFT",
    created_by:currentSession.user.id
  };

  const {data,error}=await sb.from("transactions").insert(payload).select("id,transaction_number").single();
  if(error) throw error;

  if(action==="submit"){
    const {error:submitError}=await sb.rpc("submit_transaction",{p_transaction_id:data.id});
    if(submitError) throw submitError;
  }

  resetTransferForm();
  await Promise.all([loadTransferModule(),loadDashboard()]);
  toast(action==="submit" ? `Transfer ${data.transaction_number} berhasil diajukan.` : `Transfer ${data.transaction_number} disimpan sebagai Draft.`);
}

async function submitExistingTransfer(id){
  const row=transferRowsCache.find(x=>x.id===id);
  if(!row) throw new Error("Transfer tidak ditemukan.");

  const balanceRes=await sb.from("v_account_balances")
    .select("current_balance")
    .eq("account_id",row.source_account_id)
    .single();
  if(balanceRes.error) throw balanceRes.error;

  const balance=Number(balanceRes.data?.current_balance||0);
  if(Number(row.amount)>balance){
    throw new Error(`Saldo akun sumber tidak cukup. Saldo tersedia ${rupiah(balance)}.`);
  }

  const {error}=await sb.rpc("submit_transaction",{p_transaction_id:id});
  if(error) throw error;
  await Promise.all([loadTransferModule(),loadDashboard()]);
  toast("Transfer berhasil diajukan untuk approval.");
}

async function approveTransfer(id){
  const row=transferRowsCache.find(x=>x.id===id);
  if(!row) throw new Error("Transfer tidak ditemukan.");

  const balanceRes=await sb.from("v_account_balances")
    .select("current_balance")
    .eq("account_id",row.source_account_id)
    .single();
  if(balanceRes.error) throw balanceRes.error;

  const balance=Number(balanceRes.data?.current_balance||0);
  if(Number(row.amount)>balance){
    throw new Error(`Transfer tidak dapat disetujui. Saldo sumber hanya ${rupiah(balance)}.`);
  }

  if(!confirm("Setujui transfer internal ini? Saldo sumber akan berkurang dan saldo tujuan bertambah.")) return;

  const {error}=await sb.rpc("approve_transaction",{p_transaction_id:id,p_note:"Transfer internal disetujui melalui SIMKEU"});
  if(error) throw error;

  await Promise.all([loadTransferModule(),loadDashboard()]);
  toast("Transfer disetujui. Saldo kedua akun telah diperbarui.");
}

async function rejectTransfer(id){
  const note=prompt("Masukkan alasan penolakan transfer:");
  if(note===null) return;
  if(!note.trim()){toast("Alasan penolakan wajib diisi.");return}

  const {error}=await sb.rpc("reject_transaction",{p_transaction_id:id,p_note:note.trim()});
  if(error) throw error;

  await Promise.all([loadTransferModule(),loadDashboard()]);
  toast("Transfer internal ditolak.");
}



/* ==================== ASET & INVENTARIS v7.0 ==================== */
function assetConditionLabel(v){return {GOOD:"Baik",LIGHT_DAMAGE:"Rusak Ringan",HEAVY_DAMAGE:"Rusak Berat"}[v]||v||"-"}
function assetConditionClass(v){return {GOOD:"good",LIGHT_DAMAGE:"light",HEAVY_DAMAGE:"heavy"}[v]||""}
function assetStatusLabel(v){return {ACTIVE:"Aktif",MAINTENANCE:"Maintenance",LOST:"Hilang",DISPOSED:"Dihapuskan"}[v]||v||"-"}
function assetStatusClass(v){return {ACTIVE:"active",MAINTENANCE:"maintenance",LOST:"lost",DISPOSED:"disposed"}[v]||""}
function movementLabel(v){return {REGISTERED:"Registrasi",MUTATION:"Mutasi",CONDITION_CHANGE:"Perubahan Kondisi",STATUS_CHANGE:"Perubahan Status",DISPOSAL:"Penghapusan",ADJUSTMENT:"Penyesuaian"}[v]||v}
function canManageAssets(){return isCentralUser()||currentProfile?.role==="INSTITUTION_ADMIN"}

async function loadAssetsModule(){
  try{
    if(!assetInstitutions.length||!assetCategories.length){
      const [i,c]=await Promise.all([
        sb.from("institutions").select("id,code,name,is_active").eq("is_active",true).order("name"),
        sb.from("asset_categories").select("id,code,name,is_active").eq("is_active",true).order("name")
      ]);
      if(i.error)throw i.error;if(c.error)throw c.error;
      assetInstitutions=i.data||[];assetCategories=c.data||[];
    }
    $("assetCategoryFilter").innerHTML=`<option value="ALL">Semua Kategori</option>`+assetCategories.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("");
    $("assetCategory").innerHTML=`<option value="">Pilih kategori</option>`+assetCategories.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("");
    if(isCentralUser()){
      $("assetInstitutionFilter").innerHTML=`<option value="ALL">Semua Lembaga</option>`+assetInstitutions.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("");
      $("assetInstitution").innerHTML=`<option value="">Pilih lembaga</option>`+assetInstitutions.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("");
      $("assetInstitutionFilter").disabled=false;$("assetInstitution").disabled=false;
    }else{
      restrictInstitutionSelector("assetInstitutionFilter",assetInstitutions);
      restrictInstitutionSelector("assetInstitution",assetInstitutions);
    }
    $("newAssetBtn").classList.toggle("hidden",!canManageAssets());
    $("assetFormCard").classList.toggle("hidden",!canManageAssets());
    if(canManageAssets()&&!$("assetAcquisitionDate").value)resetAssetForm();
    await fetchAssets();
  }catch(e){console.error(e);toast("Gagal memuat aset: "+(e.message||"error"))}
}
async function fetchAssets(){
  let q=sb.from("assets").select(`id,asset_code,institution_id,asset_category_id,asset_name,description,brand_model,serial_number,quantity,unit,acquisition_date,acquisition_value,acquisition_transaction_id,location,custodian,asset_condition,status,notes,created_at,updated_at,institutions:institution_id(id,name,code),asset_categories:asset_category_id(id,name,code),acquisition_transaction:acquisition_transaction_id(id,transaction_number,transaction_date,amount,description)`).order("asset_code");
  const inst=$("assetInstitutionFilter").value;if(inst&&inst!=="ALL")q=q.eq("institution_id",inst);
  const {data,error}=await q;if(error)throw error;assetRowsCache=data||[];
  renderAssets();await loadAssetExpenses();
}
async function loadAssetExpenses(){
  const {data,error}=await sb.from("transactions").select(`id,transaction_number,transaction_date,institution_id,amount,description,expense_categories:expense_category_id(name)`).eq("transaction_type","EXPENSE").eq("status","APPROVED").order("transaction_date",{ascending:false}).limit(1500);
  if(error)throw error;assetExpenseRows=data||[];refreshAssetExpenseOptions();
}
function filteredAssets(){
  const c=$("assetCategoryFilter").value,k=$("assetConditionFilter").value,s=$("assetStatusFilter").value,t=($("assetSearch").value||"").toLowerCase().trim();
  return assetRowsCache.filter(a=>{
    const h=[a.asset_code,a.asset_name,a.brand_model,a.serial_number,a.location,a.custodian,a.institutions?.name,a.asset_categories?.name].filter(Boolean).join(" ").toLowerCase();
    return(c==="ALL"||a.asset_category_id===c)&&(k==="ALL"||a.asset_condition===k)&&(s==="ALL"||a.status===s)&&(!t||h.includes(t));
  });
}
function renderAssets(){
  const rows=filteredAssets(),active=assetRowsCache.filter(a=>a.status!=="DISPOSED");

  // Bersihkan pilihan yang sudah tidak dapat diakses lagi.
  const accessibleIds=new Set(assetRowsCache.map(a=>a.id));
  [...selectedAssetIds].forEach(id=>{if(!accessibleIds.has(id))selectedAssetIds.delete(id)});

  $("assetTotalQty").textContent=active.reduce((s,a)=>s+Number(a.quantity||0),0).toLocaleString("id-ID");
  $("assetTotalValue").textContent=rupiah(assetRowsCache.reduce((s,a)=>s+Number(a.acquisition_value||0),0));
  $("assetGoodCount").textContent=active.filter(a=>a.asset_condition==="GOOD").reduce((s,a)=>s+Number(a.quantity||0),0).toLocaleString("id-ID");
  $("assetAttentionCount").textContent=active.filter(a=>a.asset_condition!=="GOOD"||["MAINTENANCE","LOST"].includes(a.status)).reduce((s,a)=>s+Number(a.quantity||0),0).toLocaleString("id-ID");
  $("assetResultInfo").textContent=`${rows.length} record • ${rows.reduce((s,a)=>s+Number(a.quantity||0),0)} unit`;

  $("assetTableBody").innerHTML=rows.length?rows.map(a=>`<tr>
    <td class="asset-check-col"><input class="asset-row-check" data-asset-select="${a.id}" type="checkbox" ${selectedAssetIds.has(a.id)?"checked":""} aria-label="Pilih ${escapeHtml(a.asset_code)}"></td>
    <td><span class="asset-code-chip">${escapeHtml(a.asset_code)}</span></td>
    <td><div class="asset-name-cell"><strong>${escapeHtml(a.asset_name)}</strong><span>${escapeHtml(a.asset_categories?.name||"-")} • ${a.quantity} ${escapeHtml(a.unit||"UNIT")}</span></div></td>
    <td>${escapeHtml(a.institutions?.name||"-")}</td><td>${escapeHtml(a.location||"-")}</td><td><strong>${rupiah(a.acquisition_value)}</strong></td>
    <td><span class="asset-condition ${assetConditionClass(a.asset_condition)}">${assetConditionLabel(a.asset_condition)}</span></td>
    <td><span class="asset-status ${assetStatusClass(a.status)}">${assetStatusLabel(a.status)}</span></td>
    <td><div class="asset-actions">
      <button class="asset-btn label" data-aa="label" data-id="${a.id}" type="button">Label</button>
      <button class="asset-btn" data-aa="detail" data-id="${a.id}" type="button">Detail</button>
      ${canManageAssets()?`<button class="asset-btn edit" data-aa="edit" data-id="${a.id}" type="button">Edit</button><button class="asset-btn move" data-aa="move" data-id="${a.id}" type="button">Mutasi</button>`:""}
    </div></td>
  </tr>`).join(""):`<tr><td colspan="9" class="empty">Belum ada aset sesuai filter.</td></tr>`;

  updateAssetSelectionUI();
}
function setAssetEdit(active){
  $("assetFormCard").classList.toggle("asset-form-editing",active);$("assetFormTitle").textContent=active?"Edit Data Aset":"Tambah Aset";$("saveAssetBtn").textContent=active?"Simpan Perubahan":"Simpan Aset";$("cancelAssetEditBtn").classList.toggle("hidden",!active);
  $("assetInstitution").disabled=active||!isCentralUser();
}
function resetAssetForm(){
  editingAssetId=null;["assetLocation","assetCustodian","assetCondition","assetStatus"].forEach(id=>$(id).disabled=false);
  $("assetForm").reset();setAssetEdit(false);$("assetQuantity").value=1;$("assetUnit").value="UNIT";$("assetAcquisitionSource").value="TRANSACTION";$("assetAcquisitionDate").value=todayISO();$("assetAcquisitionValue").value=0;$("assetValuePreview").textContent="Rp0";$("assetCondition").value="GOOD";$("assetStatus").value="ACTIVE";
  if(!isCentralUser()&&currentProfile?.institution_id){$("assetInstitution").value=currentProfile.institution_id;$("assetInstitution").disabled=true}
  toggleAssetSource();refreshAssetExpenseOptions();
}
function toggleAssetSource(){const t=$("assetAcquisitionSource").value==="TRANSACTION";$("assetExpenseField").classList.toggle("hidden",!t);$("assetExpenseTransaction").required=t;if(!t)$("assetExpenseTransaction").value=""}
function refreshAssetExpenseOptions(){
  const i=$("assetInstitution").value,rows=assetExpenseRows.filter(t=>!i||t.institution_id===i);
  $("assetExpenseTransaction").innerHTML=`<option value="">Pilih transaksi pengeluaran</option>`+rows.map(t=>`<option value="${t.id}">${formatDate(t.transaction_date)} • ${escapeHtml(t.transaction_number)} • ${rupiah(t.amount)}</option>`).join("");
  $("assetExpenseTransaction").disabled=!i||!rows.length;
}
function applyAssetExpense(){
  const t=assetExpenseRows.find(x=>x.id===$("assetExpenseTransaction").value);if(!t)return;
  $("assetAcquisitionDate").value=t.transaction_date;$("assetAcquisitionValue").value=Number(t.amount||0);$("assetValuePreview").textContent=rupiah(t.amount);if(!$("assetDescription").value&&t.description)$("assetDescription").value=t.description;
}
function editAsset(id){
  const a=assetRowsCache.find(x=>x.id===id);if(!a)throw new Error("Aset tidak ditemukan.");editingAssetId=id;setAssetEdit(true);
  $("assetInstitution").value=a.institution_id;$("assetCategory").value=a.asset_category_id;$("assetName").value=a.asset_name||"";$("assetBrandModel").value=a.brand_model||"";$("assetSerialNumber").value=a.serial_number||"";$("assetQuantity").value=a.quantity;$("assetUnit").value=a.unit||"UNIT";
  $("assetAcquisitionSource").value=a.acquisition_transaction_id?"TRANSACTION":"MANUAL";toggleAssetSource();refreshAssetExpenseOptions();$("assetExpenseTransaction").value=a.acquisition_transaction_id||"";$("assetAcquisitionDate").value=a.acquisition_date;$("assetAcquisitionValue").value=a.acquisition_value;$("assetValuePreview").textContent=rupiah(a.acquisition_value);$("assetLocation").value=a.location||"";$("assetCustodian").value=a.custodian||"";$("assetCondition").value=a.asset_condition;$("assetStatus").value=a.status;$("assetDescription").value=a.description||"";$("assetNotes").value=a.notes||"";
  ["assetLocation","assetCustodian","assetCondition","assetStatus"].forEach(id=>$(id).disabled=true);$("assetFormCard").scrollIntoView({behavior:"smooth",block:"start"});
}
async function saveAsset(){
  const wasEditing=!!editingAssetId;
  const p={institution_id:$("assetInstitution").value,asset_category_id:$("assetCategory").value,asset_name:$("assetName").value.trim(),description:$("assetDescription").value.trim()||null,brand_model:$("assetBrandModel").value.trim()||null,serial_number:$("assetSerialNumber").value.trim()||null,quantity:Number($("assetQuantity").value),unit:$("assetUnit").value.trim().toUpperCase(),acquisition_date:$("assetAcquisitionDate").value,acquisition_value:Number($("assetAcquisitionValue").value),acquisition_transaction_id:$("assetAcquisitionSource").value==="TRANSACTION"?$("assetExpenseTransaction").value:null,location:$("assetLocation").value.trim()||null,custodian:$("assetCustodian").value.trim()||null,condition:$("assetCondition").value,status:$("assetStatus").value,notes:$("assetNotes").value.trim()||null};
  if(!p.institution_id||!p.asset_category_id||!p.asset_name||!p.acquisition_date||p.quantity<1)throw new Error("Lengkapi data wajib aset.");
  if($("assetAcquisitionSource").value==="TRANSACTION"&&!p.acquisition_transaction_id)throw new Error("Pilih pengeluaran APPROVED terkait.");
  if(editingAssetId){
    const {error}=await sb.rpc("update_asset_master",{p_asset_id:editingAssetId,p_asset_category_id:p.asset_category_id,p_asset_name:p.asset_name,p_description:p.description,p_brand_model:p.brand_model,p_serial_number:p.serial_number,p_quantity:p.quantity,p_unit:p.unit,p_acquisition_date:p.acquisition_date,p_acquisition_value:p.acquisition_value,p_acquisition_transaction_id:p.acquisition_transaction_id,p_notes:p.notes});if(error)throw error;
  }else{
    const {error}=await sb.rpc("create_asset",{p_institution_id:p.institution_id,p_asset_category_id:p.asset_category_id,p_asset_name:p.asset_name,p_description:p.description,p_brand_model:p.brand_model,p_serial_number:p.serial_number,p_quantity:p.quantity,p_unit:p.unit,p_acquisition_date:p.acquisition_date,p_acquisition_value:p.acquisition_value,p_acquisition_transaction_id:p.acquisition_transaction_id,p_location:p.location,p_custodian:p.custodian,p_condition:p.condition,p_status:p.status,p_notes:p.notes});if(error)throw error;
  }
  resetAssetForm();await fetchAssets();toast(wasEditing?"Aset berhasil diperbarui.":"Aset berhasil dicatat.");
}
async function showAssetDetail(id){
  const a=assetRowsCache.find(x=>x.id===id);if(!a)return;
  const {data,error}=await sb.from("asset_movements").select("*").eq("asset_id",id).order("movement_date",{ascending:false}).order("created_at",{ascending:false});if(error)throw error;
  $("assetDetailTitle").textContent=a.asset_name;$("assetDetailCode").textContent=a.asset_code;
  $("assetDetailBody").innerHTML=`<div class="asset-detail-grid">
    ${[["Lembaga",a.institutions?.name],["Kategori",a.asset_categories?.name],["Nilai Perolehan",rupiah(a.acquisition_value)],["Tanggal Perolehan",formatDate(a.acquisition_date)],["Jumlah",`${a.quantity} ${a.unit}`],["Merek / Model",a.brand_model||"-"],["Serial Number",a.serial_number||"-"],["Lokasi",a.location||"-"],["Penanggung Jawab",a.custodian||"-"],["Kondisi",assetConditionLabel(a.asset_condition)],["Status",assetStatusLabel(a.status)],["Catatan",a.notes||"-"]].map(x=>`<div class="asset-detail-box"><span>${x[0]}</span><strong>${escapeHtml(x[1]||"-")}</strong></div>`).join("")}
    </div>
    <div class="asset-source-note">${a.acquisition_transaction?`Terkait transaksi ${escapeHtml(a.acquisition_transaction.transaction_number)} • ${formatDate(a.acquisition_transaction.transaction_date)} • ${rupiah(a.acquisition_transaction.amount)}`:"Input manual / aset lama."}</div>
    ${a.description?`<div class="asset-detail-title">Spesifikasi</div><div class="asset-source-note">${escapeHtml(a.description)}</div>`:""}
    <div class="asset-detail-title">Riwayat Mutasi</div><div class="asset-history">${(data||[]).length?(data||[]).map(m=>`<div class="asset-history-row"><span>${formatDate(m.movement_date)}</span><strong>${movementLabel(m.movement_type)}</strong><div>${m.from_location!==m.to_location?`Lokasi: ${escapeHtml(m.from_location||"-")} → ${escapeHtml(m.to_location||"-")}<br>`:""}${m.old_condition!==m.new_condition?`Kondisi: ${assetConditionLabel(m.old_condition)} → ${assetConditionLabel(m.new_condition)}<br>`:""}${m.old_status!==m.new_status?`Status: ${assetStatusLabel(m.old_status)} → ${assetStatusLabel(m.new_status)}<br>`:""}${escapeHtml(m.note||"")}</div></div>`).join(""):`<div class="empty">Belum ada riwayat.</div>`}</div>`;
  $("assetDetailModal").classList.remove("hidden");
}
function openMovement(id){
  const a=assetRowsCache.find(x=>x.id===id);if(!a)throw new Error("Aset tidak ditemukan.");
  $("assetMovementId").value=a.id;$("assetMovementCode").textContent=`${a.asset_code} • ${a.asset_name}`;$("assetMovementDate").value=todayISO();$("assetMovementLocation").value=a.location||"";$("assetMovementCustodian").value=a.custodian||"";$("assetMovementCondition").value=a.asset_condition;$("assetMovementStatus").value=a.status;$("assetMovementNote").value="";$("assetMovementModal").classList.remove("hidden");
}
async function saveMovement(){
  const {error}=await sb.rpc("record_asset_movement",{p_asset_id:$("assetMovementId").value,p_movement_date:$("assetMovementDate").value,p_new_location:$("assetMovementLocation").value.trim()||null,p_new_custodian:$("assetMovementCustodian").value.trim()||null,p_new_condition:$("assetMovementCondition").value,p_new_status:$("assetMovementStatus").value,p_note:$("assetMovementNote").value.trim()});if(error)throw error;
  $("assetMovementModal").classList.add("hidden");await fetchAssets();toast("Mutasi aset tersimpan.");
}

function updateAssetSelectionUI(){
  const count=selectedAssetIds.size;
  $("selectedAssetCount").textContent=`(${count})`;
  $("printAssetLabelsBtn").disabled=count===0;
}

function assetDeepLink(assetCode){
  const url=new URL(window.location.href);
  url.search="";
  url.hash="";
  url.searchParams.set("asset",assetCode);
  return url.toString();
}

function createQrDataUrl(text,size=220){
  if(typeof QRCode==="undefined"){
    throw new Error("Library QR Code belum termuat. Periksa koneksi internet lalu refresh.");
  }
  const host=document.createElement("div");
  host.style.position="fixed";
  host.style.left="-9999px";
  host.style.top="-9999px";
  document.body.appendChild(host);

  new QRCode(host,{
    text,
    width:size,
    height:size,
    colorDark:"#000000",
    colorLight:"#ffffff",
    correctLevel:QRCode.CorrectLevel.M
  });

  const canvas=host.querySelector("canvas");
  const img=host.querySelector("img");
  let dataUrl="";
  if(canvas) dataUrl=canvas.toDataURL("image/png");
  else if(img) dataUrl=img.src;
  host.remove();

  if(!dataUrl) throw new Error("QR Code gagal dibuat.");
  return dataUrl;
}

function selectedAssets(){
  return assetRowsCache.filter(a=>selectedAssetIds.has(a.id));
}

function selectAllFilteredAssets(){
  filteredAssets().forEach(a=>selectedAssetIds.add(a.id));
  renderAssets();
  toast(`${selectedAssetIds.size} aset dipilih untuk label.`);
}

function clearSelectedAssets(){
  selectedAssetIds.clear();
  renderAssets();
}

function previewLabelHtml(a){
  const qr=createQrDataUrl(assetDeepLink(a.asset_code),150);
  const showInst=$("assetLabelShowInstitution").value==="YES";
  const showLoc=$("assetLabelShowLocation").value==="YES";
  return `<div class="asset-label-preview-card">
    <div class="asset-label-preview-qr"><img src="${qr}" alt="QR ${escapeHtml(a.asset_code)}"></div>
    <div class="asset-label-preview-info">
      <div class="foundation">Yayasan Ar-Raudlah Kapedi</div>
      <strong>${escapeHtml(a.asset_name)}</strong>
      <div class="code">${escapeHtml(a.asset_code)}</div>
      ${showInst?`<small>${escapeHtml(a.institutions?.name||"-")}</small>`:""}
      ${showLoc?`<small>Lokasi: ${escapeHtml(a.location||"-")}</small>`:""}
    </div>
  </div>`;
}

function refreshAssetLabelPreview(){
  const rows=selectedAssets();
  $("assetLabelModalInfo").textContent=`${rows.length} aset dipilih`;
  const previewRows=rows.slice(0,6);
  try{
    $("assetLabelPreview").innerHTML=previewRows.map(previewLabelHtml).join("")+
      (rows.length>6?`<div class="asset-label-preview-card"><div class="asset-label-preview-info"><strong>+ ${rows.length-6} label lainnya</strong><small>Akan ikut dicetak.</small></div></div>`:"");
  }catch(err){
    console.error(err);
    $("assetLabelPreview").innerHTML=`<div class="empty">${escapeHtml(err.message||"QR gagal dibuat.")}</div>`;
  }
}

function openAssetLabelModal(ids=null){
  if(Array.isArray(ids)){
    selectedAssetIds.clear();
    ids.forEach(id=>selectedAssetIds.add(id));
    renderAssets();
  }
  if(!selectedAssetIds.size){
    toast("Pilih minimal satu aset.");
    return;
  }
  $("assetLabelModal").classList.remove("hidden");
  refreshAssetLabelPreview();
}

function closeAssetLabelModal(){
  $("assetLabelModal").classList.add("hidden");
}

function labelDimensions(){
  const value=$("assetLabelSize").value;
  const map={
    "50x30":{w:50,h:30,qr:22,name:8,code:7.2,meta:5.5},
    "70x35":{w:70,h:35,qr:27,name:9,code:8,meta:6},
    "100x50":{w:100,h:50,qr:39,name:12,code:10,meta:7.5}
  };
  return map[value]||map["70x35"];
}

function printSelectedAssetLabels(){
  const rows=selectedAssets();
  if(!rows.length){
    toast("Tidak ada aset yang dipilih.");
    return;
  }

  const dim=labelDimensions();
  const showInst=$("assetLabelShowInstitution").value==="YES";
  const showLoc=$("assetLabelShowLocation").value==="YES";

  let labels="";
  try{
    labels=rows.map(a=>{
      const qr=createQrDataUrl(assetDeepLink(a.asset_code),220);
      return `<div class="label">
        <div class="qr"><img src="${qr}"></div>
        <div class="info">
          <div class="foundation">YAYASAN AR-RAUDLAH KAPEDI</div>
          <div class="name">${escapeHtml(a.asset_name)}</div>
          <div class="code">${escapeHtml(a.asset_code)}</div>
          ${showInst?`<div class="meta">${escapeHtml(a.institutions?.name||"-")}</div>`:""}
          ${showLoc?`<div class="meta">Lokasi: ${escapeHtml(a.location||"-")}</div>`:""}
          <div class="scan">SCAN UNTUK DETAIL ASET</div>
        </div>
      </div>`;
    }).join("");
  }catch(err){
    console.error(err);
    toast("Gagal membuat QR: "+(err.message||"error"));
    return;
  }

  const w=window.open("","_blank","width=1100,height=850");
  if(!w){
    toast("Browser memblokir jendela cetak. Izinkan pop-up untuk SIMKEU.");
    return;
  }

  w.document.write(`<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Label QR Aset SIMKEU</title>
    <style>
      @page{size:A4;margin:8mm}
      *{box-sizing:border-box}
      body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff}
      .sheet{display:flex;flex-wrap:wrap;align-content:flex-start;gap:3mm}
      .label{
        width:${dim.w}mm;height:${dim.h}mm;border:0.35mm solid #222;border-radius:2mm;
        display:grid;grid-template-columns:${dim.qr}mm 1fr;gap:2mm;align-items:center;
        padding:2mm;overflow:hidden;page-break-inside:avoid;background:#fff
      }
      .qr{width:${dim.qr}mm;height:${dim.qr}mm;display:grid;place-items:center}
      .qr img{width:100%;height:100%;object-fit:contain}
      .info{min-width:0;overflow:hidden}
      .foundation{font-size:${dim.meta}px;font-weight:800;color:#A54E13;white-space:nowrap}
      .name{font-size:${dim.name}px;font-weight:800;line-height:1.1;margin:1.2mm 0 .5mm;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .code{font-size:${dim.code}px;font-weight:900;letter-spacing:.04em;white-space:nowrap}
      .meta{font-size:${dim.meta}px;margin-top:.4mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .scan{font-size:${max(4.5,dim.meta-0.5)}px;font-weight:800;color:#666;margin-top:.8mm}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style>
  </head>
  <body>
    <div class="sheet">${labels}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),300);<\/script>
  </body>
  </html>`);
  w.document.close();
}

async function handleAssetDeepLink(){
  if(pendingAssetDeepLinkHandled)return;

  const params=new URLSearchParams(window.location.search);
  const code=(params.get("asset")||"").trim();
  if(!code)return;

  pendingAssetDeepLinkHandled=true;

  try{
    await switchView("aset");
    const target=assetRowsCache.find(a=>a.asset_code===code);
    if(!target){
      toast("Aset tidak ditemukan atau akun ini tidak memiliki akses.");
      return;
    }
    await showAssetDetail(target.id);
  }catch(err){
    console.error(err);
    toast("Gagal membuka QR aset: "+(err.message||"error"));
  }
}

function exportAssetsCsv(){
  const rows=filteredAssets();if(!rows.length){toast("Tidak ada aset untuk diekspor.");return}
  const h=["Kode","Nama","Kategori","Lembaga","Jumlah","Satuan","Tanggal Perolehan","Nilai","Lokasi","Penanggung Jawab","Kondisi","Status","Serial Number","Merek/Model"];
  const b=rows.map(a=>[a.asset_code,a.asset_name,a.asset_categories?.name||"",a.institutions?.name||"",a.quantity,a.unit,a.acquisition_date,a.acquisition_value,a.location||"",a.custodian||"",assetConditionLabel(a.asset_condition),assetStatusLabel(a.status),a.serial_number||"",a.brand_model||""]);
  const csv="\uFEFF"+[h,...b].map(r=>r.map(csvCell).join(",")).join("\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}),u=URL.createObjectURL(blob),x=document.createElement("a");x.href=u;x.download=`Inventaris_SIMKEU_${todayISO()}.csv`;x.click();URL.revokeObjectURL(u);
}


/* =========================================================
   LAPORAN
   ========================================================= */

function firstDayOfCurrentMonth(){
  const d=new Date();
  const x=new Date(d.getFullYear(),d.getMonth(),1);
  const tz=x.getTimezoneOffset();
  return new Date(x.getTime()-tz*60000).toISOString().slice(0,10);
}

async function loadReportModule(){
  try{
    if(!$("reportDateFrom").value) $("reportDateFrom").value=firstDayOfCurrentMonth();
    if(!$("reportDateTo").value) $("reportDateTo").value=todayISO();

    if(!reportInstitutions.length){
      const {data,error}=await sb.from("institutions")
        .select("id,code,name,institution_type")
        .eq("is_active",true)
        .order("name");
      if(error) throw error;
      reportInstitutions=data||[];
      if(isCentralUser()){
        $("reportInstitution").innerHTML=`<option value="ALL">Semua Lembaga</option>`+
          reportInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
        $("reportInstitution").disabled=false;
      }else{
        restrictInstitutionSelector("reportInstitution",reportInstitutions);
      }
    }

    await fetchReportTransactions();
  }catch(err){
    console.error(err);
    toast("Gagal memuat laporan: "+(err.message||"error"));
  }
}

async function fetchReportTransactions(){
  $("reportTransactionsBody").innerHTML=`<tr><td colspan="8" class="empty">Memuat laporan...</td></tr>`;

  const from=$("reportDateFrom").value;
  const to=$("reportDateTo").value;
  if(!from||!to) throw new Error("Tanggal awal dan akhir wajib diisi.");
  if(from>to) throw new Error("Tanggal awal tidak boleh melewati tanggal akhir.");

  const {data,error}=await sb.from("transactions")
    .select(`
      id,
      transaction_number,
      transaction_date,
      transaction_type,
      institution_id,
      amount,
      description,
      status,
      created_at,
      institutions:institution_id(name),
      fund_sources:fund_source_id(name),
      expense_categories:expense_category_id(name),
      source_account:source_account_id(account_name,institution_id),
      destination_account:destination_account_id(account_name,institution_id)
    `)
    .gte("transaction_date",from)
    .lte("transaction_date",to)
    .order("transaction_date",{ascending:false})
    .order("created_at",{ascending:false})
    .limit(1000);

  if(error) throw error;

  reportRowsCache=(data||[]).map(r=>{
    const sourceInst=reportInstitutions.find(i=>i.id===r.source_account?.institution_id);
    const destInst=reportInstitutions.find(i=>i.id===r.destination_account?.institution_id);
    return {
      ...r,
      _sourceInstitutionName:sourceInst?.name||r.institutions?.name||"-",
      _destinationInstitutionName:destInst?.name||"-"
    };
  });

  renderReportRows();
}

function getFilteredReportRows(){
  const institution=$("reportInstitution").value;
  const type=$("reportType").value;
  const status=$("reportStatus").value;

  return reportRowsCache.filter(r=>{
    const institutionMatch=
      institution==="ALL" ||
      r.institution_id===institution ||
      r.source_account?.institution_id===institution ||
      r.destination_account?.institution_id===institution;

    return institutionMatch &&
      (type==="ALL" || r.transaction_type===type) &&
      (status==="ALL" || r.status===status);
  });
}

function reportSourceCategory(row){
  if(row.transaction_type==="INCOME") return row.fund_sources?.name||"Sumber Pemasukan";
  if(row.transaction_type==="EXPENSE") return row.expense_categories?.name||"Kategori Pengeluaran";
  return `${row._sourceInstitutionName} → ${row._destinationInstitutionName}`;
}

function renderReportRows(){
  const rows=getFilteredReportRows();
  const approved=rows.filter(r=>r.status==="APPROVED");

  const income=approved.filter(r=>r.transaction_type==="INCOME").reduce((s,r)=>s+Number(r.amount||0),0);
  const expense=approved.filter(r=>r.transaction_type==="EXPENSE").reduce((s,r)=>s+Number(r.amount||0),0);
  const transfer=approved.filter(r=>r.transaction_type==="TRANSFER").reduce((s,r)=>s+Number(r.amount||0),0);

  $("reportIncomeTotal").textContent=rupiah(income);
  $("reportExpenseTotal").textContent=rupiah(expense);
  $("reportTransferTotal").textContent=rupiah(transfer);
  $("reportNetTotal").textContent=rupiah(income-expense);
  $("reportResultInfo").textContent=`${rows.length} transaksi • ${formatDate($("reportDateFrom").value)} s.d. ${formatDate($("reportDateTo").value)}`;

  $("reportTransactionsBody").innerHTML=rows.length?rows.map(r=>{
    const amountClass=r.transaction_type==="INCOME"?"report-amount-income":
      r.transaction_type==="EXPENSE"?"report-amount-expense":"report-amount-transfer";
    return `
      <tr>
        <td>${formatDate(r.transaction_date)}</td>
        <td><strong>${escapeHtml(r.transaction_number||"-")}</strong></td>
        <td>${escapeHtml(r.institutions?.name||r._sourceInstitutionName||"-")}</td>
        <td><span class="pill ${typeClass(r.transaction_type)}">${typeLabel(r.transaction_type)}</span></td>
        <td>${escapeHtml(reportSourceCategory(r))}</td>
        <td><span class="report-description" title="${escapeHtml(r.description||"")}">${escapeHtml(r.description||"-")}</span></td>
        <td><strong class="${amountClass}">${rupiah(r.amount)}</strong></td>
        <td><span class="pill ${statusClass(r.status)}">${escapeHtml(r.status)}</span></td>
      </tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">Tidak ada transaksi sesuai filter.</td></tr>`;
}

function csvCell(value){
  const s=String(value??"").replaceAll('"','""');
  return `"${s}"`;
}

function exportReportCsv(){
  const rows=getFilteredReportRows();
  if(!rows.length){toast("Tidak ada data untuk diekspor.");return}

  const header=["Tanggal","No Transaksi","Lembaga","Jenis","Sumber/Kategori","Keterangan","Nominal","Status"];
  const body=rows.map(r=>[
    r.transaction_date,
    r.transaction_number||"",
    r.institutions?.name||r._sourceInstitutionName||"",
    typeLabel(r.transaction_type),
    reportSourceCategory(r),
    r.description||"",
    Number(r.amount||0),
    r.status
  ]);

  const csv="\uFEFF"+[header,...body].map(row=>row.map(csvCell).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`Laporan_SIMKEU_${$("reportDateFrom").value}_${$("reportDateTo").value}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Laporan CSV berhasil dibuat.");
}

function printReport(){
  const rows=getFilteredReportRows();
  if(!rows.length){toast("Tidak ada data untuk dicetak.");return}

  const approved=rows.filter(r=>r.status==="APPROVED");
  const income=approved.filter(r=>r.transaction_type==="INCOME").reduce((s,r)=>s+Number(r.amount||0),0);
  const expense=approved.filter(r=>r.transaction_type==="EXPENSE").reduce((s,r)=>s+Number(r.amount||0),0);
  const transfer=approved.filter(r=>r.transaction_type==="TRANSFER").reduce((s,r)=>s+Number(r.amount||0),0);

  const tableRows=rows.map(r=>`
    <tr>
      <td>${formatDate(r.transaction_date)}</td>
      <td>${escapeHtml(r.transaction_number||"-")}</td>
      <td>${escapeHtml(r.institutions?.name||r._sourceInstitutionName||"-")}</td>
      <td>${escapeHtml(typeLabel(r.transaction_type))}</td>
      <td>${escapeHtml(reportSourceCategory(r))}</td>
      <td>${escapeHtml(r.description||"-")}</td>
      <td class="num">${rupiah(r.amount)}</td>
      <td>${escapeHtml(r.status)}</td>
    </tr>`).join("");

  const w=window.open("","_blank","width=1200,height=800");
  if(!w){toast("Browser memblokir jendela cetak. Izinkan pop-up untuk situs ini.");return}

  w.document.write(`<!doctype html><html><head><title>Laporan SIMKEU</title>
    <style>
      body{font-family:Arial,sans-serif;color:#222;padding:28px;font-size:11px}
      .head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #F89921;padding-bottom:14px;margin-bottom:18px}
      .head h1{font-size:18px;margin:0}.head p{margin:4px 0 0;color:#666}
      .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}
      .box{border:1px solid #ddd;padding:10px;border-radius:6px}.box span{display:block;color:#777;font-size:9px}.box strong{display:block;margin-top:4px;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:14px}
      th,td{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}
      th{background:#f4f1ed}.num{text-align:right;white-space:nowrap}
      .footer{margin-top:16px;color:#777;font-size:9px}
      @media print{body{padding:0}.summary{break-inside:avoid}}
    </style></head><body>
    <div class="head"><div><h1>SIMKEU YAYASAN AR-RAUDLAH KAPEDI</h1>
    <p>Laporan Keuangan ${formatDate($("reportDateFrom").value)} s.d. ${formatDate($("reportDateTo").value)}</p></div></div>
    <div class="summary">
      <div class="box"><span>Pemasukan Approved</span><strong>${rupiah(income)}</strong></div>
      <div class="box"><span>Pengeluaran Approved</span><strong>${rupiah(expense)}</strong></div>
      <div class="box"><span>Transfer Internal</span><strong>${rupiah(transfer)}</strong></div>
      <div class="box"><span>Arus Bersih</span><strong>${rupiah(income-expense)}</strong></div>
    </div>
    <table><thead><tr><th>Tanggal</th><th>No.</th><th>Lembaga</th><th>Jenis</th><th>Sumber/Kategori</th><th>Keterangan</th><th>Nominal</th><th>Status</th></tr></thead>
    <tbody>${tableRows}</tbody></table>
    <div class="footer">Dicetak dari SIMKEU Yayasan Ar-Raudlah Kapedi • ${new Date().toLocaleString("id-ID")}</div>
    <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`);
  w.document.close();
}



/* =========================================================
   LPJ BULANAN v6.9
   ========================================================= */

function lpjMonthBounds(year,month){
  const start=`${year}-${String(month).padStart(2,"0")}-01`;
  const nextDate=new Date(year,month,1);
  const next=`${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,"0")}-01`;
  const endDate=new Date(year,month,0);
  const end=`${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,"0")}-${String(endDate.getDate()).padStart(2,"0")}`;
  return {start,next,end};
}

function lpjMonthName(month){
  return MONTH_NAMES[Number(month)-1]||"-";
}

function lpjSignatureKey(institutionId){
  return `simkeu_lpj_signatures_${institutionId||"default"}`;
}

function loadLPJSignatures(){
  const institutionId=$("lpjInstitution").value;
  let saved={};
  try{
    saved=JSON.parse(localStorage.getItem(lpjSignatureKey(institutionId))||"{}");
  }catch(_){saved={}}

  $("lpjTreasurerName").value=saved.treasurer||"";
  $("lpjHeadName").value=saved.head||"";
  $("lpjChairName").value=saved.chair||"";
  $("lpjSignCity").value=saved.city||"Kapedi";
}

function saveLPJSignatures(){
  const institutionId=$("lpjInstitution").value;
  if(!institutionId){
    toast("Pilih lembaga terlebih dahulu.");
    return;
  }

  localStorage.setItem(lpjSignatureKey(institutionId),JSON.stringify({
    treasurer:$("lpjTreasurerName").value.trim(),
    head:$("lpjHeadName").value.trim(),
    chair:$("lpjChairName").value.trim(),
    city:$("lpjSignCity").value.trim()||"Kapedi"
  }));
  toast("Nama penandatangan LPJ disimpan di browser ini.");
}

async function loadLPJModule(){
  try{
    fillYearOptions("lpjYear",5,1);

    const now=new Date();
    if(!$("lpjMonth").dataset.initialized){
      $("lpjMonth").value=String(now.getMonth()+1);
      $("lpjYear").value=String(now.getFullYear());
      $("lpjMonth").dataset.initialized="1";
    }

    if(!lpjInstitutions.length){
      const {data,error}=await sb.from("institutions")
        .select("id,code,name,institution_type,address,phone,is_active")
        .eq("is_active",true)
        .order("name");
      if(error) throw error;
      lpjInstitutions=data||[];
    }

    if(isCentralUser()){
      $("lpjInstitution").innerHTML=`<option value="">Pilih lembaga</option>`+
        lpjInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
      $("lpjInstitution").disabled=false;

      if(!$("lpjInstitution").value && currentProfile?.institution_id){
        $("lpjInstitution").value=currentProfile.institution_id;
      }
    }else{
      restrictInstitutionSelector("lpjInstitution",lpjInstitutions);
    }

    loadLPJSignatures();

    if($("lpjInstitution").value){
      await fetchLPJData();
    }else{
      renderLPJEmpty();
    }
  }catch(err){
    console.error(err);
    toast("Gagal memuat LPJ: "+(err.message||"error"));
  }
}

function renderLPJEmpty(){
  lpjDataCache=null;
  $("lpjOpeningBalance").textContent="Rp0";
  $("lpjClosingBalance").textContent="Rp0";
  $("lpjIncomeTotal").textContent="Rp0";
  $("lpjExpenseTotal").textContent="Rp0";
  $("lpjOpeningBreakdown").textContent="Cash Rp0 • Rekening Rp0";
  $("lpjClosingBreakdown").textContent="Cash Rp0 • Rekening Rp0";
  $("lpjIncomeCount").textContent="0 transaksi";
  $("lpjExpenseCount").textContent="0 transaksi";
  $("lpjTransferIn").textContent="Rp0";
  $("lpjTransferOut").textContent="Rp0";
  $("lpjInternalTransfer").textContent="Rp0";
  $("lpjProofStatus").textContent="0 / 0";
  $("lpjAccountBody").innerHTML=`<tr><td colspan="5" class="empty">Pilih periode dan lembaga.</td></tr>`;
  $("lpjIncomeBody").innerHTML=`<tr><td colspan="6" class="empty">Belum ada data.</td></tr>`;
  $("lpjExpenseBody").innerHTML=`<tr><td colspan="7" class="empty">Belum ada data.</td></tr>`;
  $("lpjTransferBody").innerHTML=`<tr><td colspan="6" class="empty">Belum ada data.</td></tr>`;
  $("lpjBudgetList").innerHTML=`<div class="empty">Belum ada data.</div>`;
  $("lpjPeriodStatus").textContent="OPEN";
  $("lpjPeriodStatus").className="period-chip open";
  $("lpjConsistencyAlert").classList.add("hidden");
}

async function fetchLPJData(){
  const institutionId=$("lpjInstitution").value;
  const year=Number($("lpjYear").value);
  const month=Number($("lpjMonth").value);

  if(!institutionId){
    renderLPJEmpty();
    return;
  }

  const bounds=lpjMonthBounds(year,month);
  const yearStart=`${year}-01-01`;

  $("lpjAccountBody").innerHTML=`<tr><td colspan="5" class="empty">Menyusun LPJ...</td></tr>`;

  const [accountsRes,trxRes,budgetRes,closureRes]=await Promise.all([
    sb.from("accounts")
      .select("id,institution_id,account_name,account_type,bank_name,account_number,opening_balance,is_active")
      .eq("institution_id",institutionId)
      .order("account_type")
      .order("account_name"),

    sb.from("transactions")
      .select(`
        id,
        transaction_number,
        transaction_date,
        transaction_type,
        institution_id,
        fund_source_id,
        expense_category_id,
        source_account_id,
        destination_account_id,
        amount,
        description,
        status,
        created_at,
        fund_sources:fund_source_id(name),
        expense_categories:expense_category_id(name),
        source_account:source_account_id(id,account_name,account_type,institution_id),
        destination_account:destination_account_id(id,account_name,account_type,institution_id),
        transaction_attachments(id,file_name,file_path,file_type,uploaded_at)
      `)
      .eq("status","APPROVED")
      .lte("transaction_date",bounds.end)
      .order("transaction_date",{ascending:true})
      .order("created_at",{ascending:true})
      .limit(10000),

    sb.from("budgets")
      .select("id,fiscal_year,institution_id,expense_category_id,budget_amount,note,expense_categories:expense_category_id(name)")
      .eq("institution_id",institutionId)
      .eq("fiscal_year",year)
      .order("budget_amount",{ascending:false}),

    sb.from("period_closures")
      .select("id,status,closed_at,note")
      .eq("institution_id",institutionId)
      .eq("fiscal_year",year)
      .eq("period_month",month)
      .eq("status","CLOSED")
      .maybeSingle()
  ]);

  [accountsRes,trxRes,budgetRes,closureRes].forEach(r=>{if(r.error)throw r.error});

  const institution=lpjInstitutions.find(i=>i.id===institutionId);
  const accounts=accountsRes.data||[];
  const allTransactions=trxRes.data||[];
  const budgets=budgetRes.data||[];
  const closure=closureRes.data||null;
  const accountIds=new Set(accounts.map(a=>a.id));

  // Hanya transaksi yang benar-benar menyentuh akun milik lembaga.
  const relevant=allTransactions.filter(t=>
    accountIds.has(t.source_account_id) ||
    accountIds.has(t.destination_account_id) ||
    (t.institution_id===institutionId && t.transaction_type!=="TRANSFER")
  );

  const openingByAccount=new Map(accounts.map(a=>[a.id,Number(a.opening_balance||0)]));
  const closingByAccount=new Map(accounts.map(a=>[a.id,Number(a.opening_balance||0)]));

  function applyMovement(map,t){
    const amount=Number(t.amount||0);
    if(t.transaction_type==="INCOME"){
      if(map.has(t.destination_account_id)){
        map.set(t.destination_account_id,map.get(t.destination_account_id)+amount);
      }
    }else if(t.transaction_type==="EXPENSE"){
      if(map.has(t.source_account_id)){
        map.set(t.source_account_id,map.get(t.source_account_id)-amount);
      }
    }else if(t.transaction_type==="TRANSFER"){
      if(map.has(t.source_account_id)){
        map.set(t.source_account_id,map.get(t.source_account_id)-amount);
      }
      if(map.has(t.destination_account_id)){
        map.set(t.destination_account_id,map.get(t.destination_account_id)+amount);
      }
    }
  }

  relevant.forEach(t=>{
    if(t.transaction_date<bounds.start) applyMovement(openingByAccount,t);
    applyMovement(closingByAccount,t);
  });

  const periodTransactions=relevant.filter(t=>
    t.transaction_date>=bounds.start &&
    t.transaction_date<=bounds.end
  );

  const incomeRows=periodTransactions.filter(t=>
    t.transaction_type==="INCOME" &&
    accountIds.has(t.destination_account_id)
  );

  const expenseRows=periodTransactions.filter(t=>
    t.transaction_type==="EXPENSE" &&
    accountIds.has(t.source_account_id)
  );

  const transferRows=periodTransactions.filter(t=>t.transaction_type==="TRANSFER");

  const transferInRows=transferRows.filter(t=>
    !accountIds.has(t.source_account_id) &&
    accountIds.has(t.destination_account_id)
  );
  const transferOutRows=transferRows.filter(t=>
    accountIds.has(t.source_account_id) &&
    !accountIds.has(t.destination_account_id)
  );
  const transferInternalRows=transferRows.filter(t=>
    accountIds.has(t.source_account_id) &&
    accountIds.has(t.destination_account_id)
  );

  const openingCash=accounts
    .filter(a=>a.account_type==="CASH")
    .reduce((s,a)=>s+Number(openingByAccount.get(a.id)||0),0);
  const openingBank=accounts
    .filter(a=>a.account_type==="BANK")
    .reduce((s,a)=>s+Number(openingByAccount.get(a.id)||0),0);
  const closingCash=accounts
    .filter(a=>a.account_type==="CASH")
    .reduce((s,a)=>s+Number(closingByAccount.get(a.id)||0),0);
  const closingBank=accounts
    .filter(a=>a.account_type==="BANK")
    .reduce((s,a)=>s+Number(closingByAccount.get(a.id)||0),0);

  const openingTotal=accounts.reduce((s,a)=>s+Number(openingByAccount.get(a.id)||0),0);
  const closingTotal=accounts.reduce((s,a)=>s+Number(closingByAccount.get(a.id)||0),0);
  const incomeTotal=incomeRows.reduce((s,t)=>s+Number(t.amount||0),0);
  const expenseTotal=expenseRows.reduce((s,t)=>s+Number(t.amount||0),0);
  const transferIn=transferInRows.reduce((s,t)=>s+Number(t.amount||0),0);
  const transferOut=transferOutRows.reduce((s,t)=>s+Number(t.amount||0),0);
  const internalTransfer=transferInternalRows.reduce((s,t)=>s+Number(t.amount||0),0);

  const proofComplete=expenseRows.filter(t=>(t.transaction_attachments||[]).length>0).length;

  const ytdExpenses=relevant.filter(t=>
    t.transaction_type==="EXPENSE" &&
    accountIds.has(t.source_account_id) &&
    t.transaction_date>=yearStart &&
    t.transaction_date<=bounds.end
  );

  const budgetRows=budgets.map(b=>{
    const realization=ytdExpenses
      .filter(t=>t.expense_category_id===b.expense_category_id)
      .reduce((s,t)=>s+Number(t.amount||0),0);
    const amount=Number(b.budget_amount||0);
    return {
      ...b,
      realization,
      remaining:amount-realization,
      absorption:amount>0?realization/amount*100:(realization>0?999:0)
    };
  });

  lpjDataCache={
    institution,year,month,bounds,accounts,relevant,periodTransactions,
    incomeRows,expenseRows,transferRows,transferInRows,transferOutRows,transferInternalRows,
    openingByAccount,closingByAccount,
    openingCash,openingBank,closingCash,closingBank,
    openingTotal,closingTotal,incomeTotal,expenseTotal,transferIn,transferOut,internalTransfer,
    proofComplete,budgetRows,closure
  };

  renderLPJ();
}

function lpjTransferClassification(t,accountIds){
  const sourceOwn=accountIds.has(t.source_account_id);
  const destOwn=accountIds.has(t.destination_account_id);

  if(sourceOwn && destOwn) return {label:"Pemindahan Internal",cls:"internal"};
  if(!sourceOwn && destOwn) return {label:"Transfer Masuk",cls:"in"};
  if(sourceOwn && !destOwn) return {label:"Transfer Keluar",cls:"out"};
  return {label:"Transfer",cls:""};
}

function renderLPJ(){
  const d=lpjDataCache;
  if(!d){renderLPJEmpty();return}

  $("lpjOpeningBalance").textContent=rupiah(d.openingTotal);
  $("lpjOpeningBreakdown").textContent=`Cash ${rupiah(d.openingCash)} • Rekening ${rupiah(d.openingBank)}`;
  $("lpjClosingBalance").textContent=rupiah(d.closingTotal);
  $("lpjClosingBreakdown").textContent=`Cash ${rupiah(d.closingCash)} • Rekening ${rupiah(d.closingBank)}`;
  $("lpjIncomeTotal").textContent=rupiah(d.incomeTotal);
  $("lpjIncomeCount").textContent=`${d.incomeRows.length} transaksi`;
  $("lpjExpenseTotal").textContent=rupiah(d.expenseTotal);
  $("lpjExpenseCount").textContent=`${d.expenseRows.length} transaksi`;

  $("lpjTransferIn").textContent=rupiah(d.transferIn);
  $("lpjTransferOut").textContent=rupiah(d.transferOut);
  $("lpjInternalTransfer").textContent=rupiah(d.internalTransfer);
  $("lpjProofStatus").textContent=`${d.proofComplete} / ${d.expenseRows.length}`;

  if(d.closure){
    $("lpjPeriodStatus").textContent="CLOSED";
    $("lpjPeriodStatus").className="period-chip closed";
  }else{
    $("lpjPeriodStatus").textContent="OPEN";
    $("lpjPeriodStatus").className="period-chip open";
  }

  const expected=d.openingTotal+d.incomeTotal-d.expenseTotal+d.transferIn-d.transferOut;
  const difference=Math.round((d.closingTotal-expected)*100)/100;
  $("lpjConsistencyAlert").classList.remove("hidden","ok","warn");

  if(Math.abs(difference)<0.01){
    $("lpjConsistencyAlert").classList.add("ok");
    $("lpjConsistencyAlert").textContent=
      `✓ Saldo konsisten: Saldo Awal + Pemasukan − Pengeluaran + Transfer Bersih = Saldo Akhir (${rupiah(d.closingTotal)}).`;
  }else{
    $("lpjConsistencyAlert").classList.add("warn");
    $("lpjConsistencyAlert").textContent=
      `⚠ Terdapat selisih ${rupiah(difference)} pada rekonsiliasi saldo. Periksa akun awal atau riwayat transaksi.`;
  }

  $("lpjAccountBody").innerHTML=d.accounts.length?d.accounts.map(a=>{
    const opening=Number(d.openingByAccount.get(a.id)||0);
    const closing=Number(d.closingByAccount.get(a.id)||0);
    const movement=closing-opening;
    return `<tr>
      <td><strong>${escapeHtml(a.account_name)}</strong>${a.bank_name?`<span class="account-sub">${escapeHtml(a.bank_name)}</span>`:""}</td>
      <td><span class="storage-chip ${storageTypeClass(a.account_type)}">${escapeHtml(storageTypeLabel(a.account_type))}</span></td>
      <td>${rupiah(opening)}</td>
      <td class="${movement>=0?"lpj-account-positive":"lpj-account-negative"}">${movement>=0?"+":""}${rupiah(movement)}</td>
      <td><strong>${rupiah(closing)}</strong></td>
    </tr>`;
  }).join(""):`<tr><td colspan="5" class="empty">Belum ada akun keuangan.</td></tr>`;

  $("lpjIncomeBody").innerHTML=d.incomeRows.length?d.incomeRows.map(t=>`
    <tr>
      <td>${formatDate(t.transaction_date)}</td>
      <td><strong>${escapeHtml(t.transaction_number||"-")}</strong></td>
      <td>${escapeHtml(t.fund_sources?.name||"-")}</td>
      <td><span class="storage-chip ${storageTypeClass(t.destination_account?.account_type)}">${escapeHtml(storageTypeLabel(t.destination_account?.account_type))}</span></td>
      <td>${escapeHtml(t.description||"-")}</td>
      <td><strong>${rupiah(t.amount)}</strong></td>
    </tr>`).join(""):`<tr><td colspan="6" class="empty">Tidak ada pemasukan APPROVED pada periode ini.</td></tr>`;

  $("lpjExpenseBody").innerHTML=d.expenseRows.length?d.expenseRows.map(t=>{
    const proofs=t.transaction_attachments||[];
    return `<tr>
      <td>${formatDate(t.transaction_date)}</td>
      <td><strong>${escapeHtml(t.transaction_number||"-")}</strong></td>
      <td>${escapeHtml(t.expense_categories?.name||"-")}</td>
      <td>${escapeHtml(t.source_account?.account_name||"-")}</td>
      <td>${escapeHtml(t.description||"-")}</td>
      <td><strong>${rupiah(t.amount)}</strong></td>
      <td>${proofs.length
        ? `<span class="lpj-proof-ok">Ada (${proofs.length})</span>`
        : `<span class="lpj-proof-missing">Belum Ada</span>`}
      </td>
    </tr>`;
  }).join(""):`<tr><td colspan="7" class="empty">Tidak ada pengeluaran APPROVED pada periode ini.</td></tr>`;

  const accountIds=new Set(d.accounts.map(a=>a.id));
  $("lpjTransferBody").innerHTML=d.transferRows.length?d.transferRows.map(t=>{
    const c=lpjTransferClassification(t,accountIds);
    return `<tr>
      <td>${formatDate(t.transaction_date)}</td>
      <td><strong>${escapeHtml(t.transaction_number||"-")}</strong></td>
      <td>${escapeHtml(t.source_account?.account_name||"-")}</td>
      <td>${escapeHtml(t.destination_account?.account_name||"-")}</td>
      <td><span class="lpj-transfer-type ${c.cls}">${c.label}</span></td>
      <td><strong>${rupiah(t.amount)}</strong></td>
    </tr>`;
  }).join(""):`<tr><td colspan="6" class="empty">Tidak ada transfer APPROVED pada periode ini.</td></tr>`;

  $("lpjBudgetSubtitle").textContent=`Realisasi Januari–${lpjMonthName(d.month)} ${d.year}.`;
  $("lpjBudgetList").innerHTML=d.budgetRows.length?d.budgetRows.map(b=>{
    const cls=b.absorption>100?"over":b.absorption>=80?"warning":"";
    const pct=b.absorption>=999?">999":(Math.round(b.absorption*10)/10).toLocaleString("id-ID");
    return `<div class="lpj-budget-row ${cls}">
      <div class="lpj-budget-top">
        <strong>${escapeHtml(b.expense_categories?.name||"Kategori")}</strong>
        <span>${pct}%</span>
      </div>
      <div class="lpj-budget-meta">
        <span>Realisasi ${rupiah(b.realization)}</span>
        <span>Anggaran ${rupiah(b.budget_amount)}</span>
      </div>
      <div class="lpj-budget-progress"><i style="width:${Math.min(100,b.absorption)}%"></i></div>
    </div>`;
  }).join(""):`<div class="empty">Belum ada anggaran ${d.year} untuk lembaga ini.</div>`;

  $("lpjIncomeInfo").textContent=`${d.incomeRows.length} transaksi • ${lpjMonthName(d.month)} ${d.year}`;
  $("lpjExpenseInfo").textContent=
    `${d.expenseRows.length} transaksi • ${d.proofComplete} memiliki bukti • ${d.expenseRows.length-d.proofComplete} belum memiliki bukti`;
}

function lpjPrintTableRows(rows,type){
  if(!rows.length){
    const cols=type==="expense"?7:type==="income"?6:6;
    return `<tr><td colspan="${cols}" class="empty-print">Tidak ada transaksi.</td></tr>`;
  }

  if(type==="income"){
    return rows.map(t=>`
      <tr>
        <td>${formatDate(t.transaction_date)}</td>
        <td>${escapeHtml(t.transaction_number||"-")}</td>
        <td>${escapeHtml(t.fund_sources?.name||"-")}</td>
        <td>${escapeHtml(storageTypeLabel(t.destination_account?.account_type))}</td>
        <td>${escapeHtml(t.description||"-")}</td>
        <td class="num">${rupiah(t.amount)}</td>
      </tr>`).join("");
  }

  if(type==="expense"){
    return rows.map(t=>{
      const proofs=t.transaction_attachments||[];
      return `<tr>
        <td>${formatDate(t.transaction_date)}</td>
        <td>${escapeHtml(t.transaction_number||"-")}</td>
        <td>${escapeHtml(t.expense_categories?.name||"-")}</td>
        <td>${escapeHtml(t.source_account?.account_name||"-")}</td>
        <td>${escapeHtml(t.description||"-")}</td>
        <td class="num">${rupiah(t.amount)}</td>
        <td>${proofs.length?`Ada (${proofs.length})`:"Belum Ada"}</td>
      </tr>`;
    }).join("");
  }

  const ids=new Set(lpjDataCache.accounts.map(a=>a.id));
  return rows.map(t=>{
    const c=lpjTransferClassification(t,ids);
    return `<tr>
      <td>${formatDate(t.transaction_date)}</td>
      <td>${escapeHtml(t.transaction_number||"-")}</td>
      <td>${escapeHtml(t.source_account?.account_name||"-")}</td>
      <td>${escapeHtml(t.destination_account?.account_name||"-")}</td>
      <td>${escapeHtml(c.label)}</td>
      <td class="num">${rupiah(t.amount)}</td>
    </tr>`;
  }).join("");
}

function printLPJ(){
  const d=lpjDataCache;
  if(!d){
    toast("Pilih lembaga dan muat LPJ terlebih dahulu.");
    return;
  }

  const treasurer=$("lpjTreasurerName").value.trim()||"(................................)";
  const head=$("lpjHeadName").value.trim()||"(................................)";
  const chair=$("lpjChairName").value.trim()||"(................................)";
  const city=$("lpjSignCity").value.trim()||"Kapedi";
  const monthName=lpjMonthName(d.month);
  const logoUrl=new URL("logo-yayasan.jpeg",window.location.href).href;

  const accountRows=d.accounts.map(a=>{
    const opening=Number(d.openingByAccount.get(a.id)||0);
    const closing=Number(d.closingByAccount.get(a.id)||0);
    return `<tr>
      <td>${escapeHtml(a.account_name)}</td>
      <td>${escapeHtml(storageTypeLabel(a.account_type))}</td>
      <td class="num">${rupiah(opening)}</td>
      <td class="num">${rupiah(closing-opening)}</td>
      <td class="num">${rupiah(closing)}</td>
    </tr>`;
  }).join("");

  const budgetRows=d.budgetRows.length?d.budgetRows.map(b=>{
    const pct=b.absorption>=999?">999":(Math.round(b.absorption*10)/10).toLocaleString("id-ID");
    return `<tr>
      <td>${escapeHtml(b.expense_categories?.name||"-")}</td>
      <td class="num">${rupiah(b.budget_amount)}</td>
      <td class="num">${rupiah(b.realization)}</td>
      <td class="num">${rupiah(b.remaining)}</td>
      <td class="num">${pct}%</td>
    </tr>`;
  }).join(""):`<tr><td colspan="5" class="empty-print">Belum ada anggaran.</td></tr>`;

  const proofList=d.expenseRows.flatMap(t=>
    (t.transaction_attachments||[]).map(p=>({
      transaction_number:t.transaction_number,
      date:t.transaction_date,
      file_name:p.file_name
    }))
  );

  const proofRows=proofList.length?proofList.map((p,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${formatDate(p.date)}</td>
      <td>${escapeHtml(p.transaction_number||"-")}</td>
      <td>${escapeHtml(p.file_name||"-")}</td>
    </tr>`).join(""):`<tr><td colspan="4" class="empty-print">Tidak ada lampiran bukti.</td></tr>`;

  const closureText=d.closure
    ? `CLOSED • Ditutup ${auditLocalDateTime(d.closure.closed_at)}`
    : "OPEN";

  const signDate=new Intl.DateTimeFormat("id-ID",{
    day:"2-digit",month:"long",year:"numeric"
  }).format(new Date());

  const w=window.open("","_blank","width=1200,height=900");
  if(!w){
    toast("Browser memblokir jendela cetak. Izinkan pop-up untuk situs ini.");
    return;
  }

  w.document.write(`<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>LPJ ${escapeHtml(d.institution?.name||"Lembaga")} - ${monthName} ${d.year}</title>
    <style>
      @page{size:A4 portrait;margin:14mm 12mm 15mm}
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:9.3px;line-height:1.35}
      .letterhead{display:grid;grid-template-columns:72px 1fr 72px;align-items:center;border-bottom:3px double #111;padding-bottom:8px;margin-bottom:12px}
      .logo{width:64px;height:64px;object-fit:contain}
      .letterhead-center{text-align:center}
      .letterhead-center h2{font-size:14px;margin:0 0 2px;letter-spacing:.3px}
      .letterhead-center h1{font-size:17px;margin:0 0 2px}
      .letterhead-center p{font-size:9px;margin:2px 0}
      .doc-title{text-align:center;margin:14px 0 10px}
      .doc-title h2{font-size:14px;margin:0;text-decoration:underline}
      .doc-title p{margin:3px 0 0}
      .meta{width:100%;margin:0 0 10px}
      .meta td{padding:2px 3px;border:0}
      .meta td:first-child{width:115px}
      .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:9px 0}
      .sum{border:1px solid #999;padding:7px}
      .sum span{display:block;font-size:7.5px;color:#555}
      .sum strong{display:block;font-size:11px;margin-top:2px}
      .subsummary{border:1px solid #bbb;background:#fafafa;padding:6px 8px;margin-bottom:10px}
      .section-title{font-size:10px;font-weight:bold;margin:12px 0 5px;padding:4px 6px;background:#eee;border-left:4px solid #F89921}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #999;padding:4px 5px;vertical-align:top}
      th{background:#eee;font-size:8px}
      .num{text-align:right;white-space:nowrap}
      .empty-print{text-align:center;color:#777;padding:8px}
      .totals td{font-weight:bold}
      .proof-note{margin-top:4px;color:#555;font-size:8px}
      .signature-place{text-align:right;margin-top:16px;margin-bottom:4px}
      .signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:25px;text-align:center;page-break-inside:avoid}
      .sig-role{font-weight:bold;min-height:30px}
      .sig-space{height:58px}
      .sig-name{font-weight:bold;text-decoration:underline}
      .footer-note{margin-top:14px;font-size:7.5px;color:#666;border-top:1px solid #ccc;padding-top:5px}
      .page-break{page-break-before:always}
      @media print{
        .no-print{display:none!important}
        tr,td,th{page-break-inside:avoid}
      }
    </style>
  </head>
  <body>
    <div class="letterhead">
      <img class="logo" src="${logoUrl}">
      <div class="letterhead-center">
        <h2>YAYASAN AR-RAUDLAH KAPEDI</h2>
        <h1>${escapeHtml((d.institution?.name||"LEMBAGA").toUpperCase())}</h1>
        <p>${escapeHtml(d.institution?.address||"Kapedi, Bluto, Sumenep")}</p>
      </div>
      <div></div>
    </div>

    <div class="doc-title">
      <h2>LAPORAN PERTANGGUNGJAWABAN KEUANGAN (LPJ)</h2>
      <p>Periode ${monthName} ${d.year}</p>
    </div>

    <table class="meta">
      <tr><td>Nama Lembaga</td><td>: <strong>${escapeHtml(d.institution?.name||"-")}</strong></td></tr>
      <tr><td>Periode</td><td>: ${monthName} ${d.year}</td></tr>
      <tr><td>Status Periode</td><td>: ${escapeHtml(closureText)}</td></tr>
      <tr><td>Tanggal Cetak</td><td>: ${escapeHtml(signDate)}</td></tr>
    </table>

    <div class="summary">
      <div class="sum"><span>Saldo Awal</span><strong>${rupiah(d.openingTotal)}</strong></div>
      <div class="sum"><span>Pemasukan</span><strong>${rupiah(d.incomeTotal)}</strong></div>
      <div class="sum"><span>Pengeluaran</span><strong>${rupiah(d.expenseTotal)}</strong></div>
      <div class="sum"><span>Saldo Akhir</span><strong>${rupiah(d.closingTotal)}</strong></div>
    </div>
    <div class="subsummary">
      Saldo Awal: Cash ${rupiah(d.openingCash)} • Rekening ${rupiah(d.openingBank)} &nbsp; | &nbsp;
      Saldo Akhir: Cash ${rupiah(d.closingCash)} • Rekening ${rupiah(d.closingBank)} &nbsp; | &nbsp;
      Transfer Masuk ${rupiah(d.transferIn)} • Transfer Keluar ${rupiah(d.transferOut)}
    </div>

    <div class="section-title">A. POSISI SALDO PER AKUN</div>
    <table>
      <thead><tr><th>Akun</th><th>Jenis</th><th>Saldo Awal</th><th>Mutasi</th><th>Saldo Akhir</th></tr></thead>
      <tbody>${accountRows||`<tr><td colspan="5" class="empty-print">Belum ada akun.</td></tr>`}</tbody>
      <tfoot><tr class="totals"><td colspan="2">TOTAL</td><td class="num">${rupiah(d.openingTotal)}</td><td class="num">${rupiah(d.closingTotal-d.openingTotal)}</td><td class="num">${rupiah(d.closingTotal)}</td></tr></tfoot>
    </table>

    <div class="section-title">B. RINCIAN PEMASUKAN</div>
    <table>
      <thead><tr><th>Tanggal</th><th>No. Transaksi</th><th>Sumber Dana</th><th>Penyimpanan</th><th>Keterangan</th><th>Nominal</th></tr></thead>
      <tbody>${lpjPrintTableRows(d.incomeRows,"income")}</tbody>
      <tfoot><tr class="totals"><td colspan="5">TOTAL PEMASUKAN</td><td class="num">${rupiah(d.incomeTotal)}</td></tr></tfoot>
    </table>

    <div class="section-title">C. RINCIAN PENGELUARAN</div>
    <table>
      <thead><tr><th>Tanggal</th><th>No. Transaksi</th><th>Kategori</th><th>Akun</th><th>Keterangan</th><th>Nominal</th><th>Bukti</th></tr></thead>
      <tbody>${lpjPrintTableRows(d.expenseRows,"expense")}</tbody>
      <tfoot><tr class="totals"><td colspan="5">TOTAL PENGELUARAN</td><td class="num">${rupiah(d.expenseTotal)}</td><td>${d.proofComplete}/${d.expenseRows.length}</td></tr></tfoot>
    </table>

    <div class="section-title">D. TRANSFER INTERNAL</div>
    <table>
      <thead><tr><th>Tanggal</th><th>No. Transaksi</th><th>Dari</th><th>Ke</th><th>Klasifikasi</th><th>Nominal</th></tr></thead>
      <tbody>${lpjPrintTableRows(d.transferRows,"transfer")}</tbody>
    </table>

    <div class="section-title">E. ANGGARAN & REALISASI s.d. ${monthName.toUpperCase()} ${d.year}</div>
    <table>
      <thead><tr><th>Kategori</th><th>Anggaran Tahunan</th><th>Realisasi YTD</th><th>Sisa</th><th>Serapan</th></tr></thead>
      <tbody>${budgetRows}</tbody>
    </table>

    <div class="section-title">F. DAFTAR LAMPIRAN BUKTI TRANSAKSI</div>
    <table>
      <thead><tr><th>No</th><th>Tanggal</th><th>No. Transaksi</th><th>Nama File Bukti</th></tr></thead>
      <tbody>${proofRows}</tbody>
    </table>
    <div class="proof-note">Kelengkapan bukti pengeluaran: ${d.proofComplete} dari ${d.expenseRows.length} transaksi pengeluaran.</div>

    <div class="signature-place">${escapeHtml(city)}, ${escapeHtml(signDate)}</div>
    <div class="signatures">
      <div>
        <div class="sig-role">${d.institution?.institution_type==="FOUNDATION"?"Bendahara Yayasan":"Bendahara / Penyusun"}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${escapeHtml(treasurer)}</div>
      </div>
      <div>
        <div class="sig-role">${d.institution?.institution_type==="FOUNDATION"?"Sekretaris Yayasan":"Kepala Lembaga"}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${escapeHtml(head)}</div>
      </div>
      <div>
        <div class="sig-role">Ketua Yayasan</div>
        <div class="sig-space"></div>
        <div class="sig-name">${escapeHtml(chair)}</div>
      </div>
    </div>

    <div class="footer-note">
      Dokumen ini dihasilkan dari SIMKEU Yayasan Ar-Raudlah Kapedi. Transaksi yang dihitung dalam LPJ adalah transaksi berstatus APPROVED; transaksi VOID tidak memengaruhi saldo.
    </div>
    <script>
      window.onload=()=>setTimeout(()=>window.print(),350);
    <\/script>
  </body>
  </html>`);

  w.document.close();
}


/* =========================================================
   ANALITIK
   ========================================================= */

async function loadAnalyticsModule(){
  try{
    if(!$("analyticsYear").options.length){
      const now=new Date().getFullYear();
      const years=[];
      for(let y=now-4;y<=now+1;y++) years.push(y);
      $("analyticsYear").innerHTML=years.reverse().map(y=>`<option value="${y}">${y}</option>`).join("");
      $("analyticsYear").value=String(now);
    }

    if(!analyticsInstitutions.length){
      const {data,error}=await sb.from("institutions")
        .select("id,code,name,institution_type")
        .eq("is_active",true)
        .order("name");
      if(error) throw error;
      analyticsInstitutions=data||[];
      if(isCentralUser()){
        $("analyticsInstitution").innerHTML=`<option value="ALL">Semua Lembaga</option>`+
          analyticsInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
        $("analyticsInstitution").disabled=false;
      }else{
        restrictInstitutionSelector("analyticsInstitution",analyticsInstitutions);
      }
    }

    await fetchAnalyticsData();
  }catch(err){
    console.error(err);
    toast("Gagal memuat analitik: "+(err.message||"error"));
  }
}

async function fetchAnalyticsData(){
  const year=Number($("analyticsYear").value);
  const start=`${year}-01-01`;
  const next=`${year+1}-01-01`;

  const {data,error}=await sb.from("transactions")
    .select(`
      id,
      transaction_date,
      transaction_type,
      institution_id,
      amount,
      status,
      institutions:institution_id(name),
      fund_sources:fund_source_id(name),
      expense_categories:expense_category_id(name),
      source_account:source_account_id(institution_id),
      destination_account:destination_account_id(institution_id)
    `)
    .eq("status","APPROVED")
    .gte("transaction_date",start)
    .lt("transaction_date",next)
    .order("transaction_date",{ascending:true})
    .limit(5000);

  if(error) throw error;
  analyticsRowsCache=data||[];
  renderAnalytics();
}

function getFilteredAnalyticsRows(){
  const institution=$("analyticsInstitution").value;
  if(institution==="ALL") return analyticsRowsCache;

  return analyticsRowsCache.filter(r=>
    r.institution_id===institution ||
    r.source_account?.institution_id===institution ||
    r.destination_account?.institution_id===institution
  );
}

function renderAnalytics(){
  const rows=getFilteredAnalyticsRows();
  const externalRows=rows.filter(r=>r.transaction_type!=="TRANSFER");
  const incomeRows=externalRows.filter(r=>r.transaction_type==="INCOME");
  const expenseRows=externalRows.filter(r=>r.transaction_type==="EXPENSE");

  const income=incomeRows.reduce((s,r)=>s+Number(r.amount||0),0);
  const expense=expenseRows.reduce((s,r)=>s+Number(r.amount||0),0);
  const ratio=income>0 ? (expense/income*100) : 0;

  $("analyticsIncomeTotal").textContent=rupiah(income);
  $("analyticsExpenseTotal").textContent=rupiah(expense);
  $("analyticsNetTotal").textContent=rupiah(income-expense);
  $("analyticsExpenseRatio").textContent=(Math.round(ratio*10)/10).toLocaleString("id-ID")+"%";

  renderAnalyticsCashflow(rows);
  renderAnalyticsExpense(rows);
  renderAnalyticsIncomeSources(rows);
  renderAnalyticsInstitutions(rows);
}

function renderAnalyticsCashflow(rows){
  const inc=Array(12).fill(0), exp=Array(12).fill(0);
  rows.forEach(r=>{
    const m=new Date(r.transaction_date+"T00:00:00").getMonth();
    if(r.transaction_type==="INCOME") inc[m]+=Number(r.amount||0);
    if(r.transaction_type==="EXPENSE") exp[m]+=Number(r.amount||0);
  });

  if(analyticsCashflowChart) analyticsCashflowChart.destroy();
  analyticsCashflowChart=new Chart($("analyticsCashflowChart"),{
    type:"bar",
    data:{
      labels:["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"],
      datasets:[
        {label:"Pemasukan",data:inc,backgroundColor:"#F89921",borderRadius:5},
        {label:"Pengeluaran",data:exp,backgroundColor:"#4A4038",borderRadius:5}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:"top",align:"end"},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${rupiah(c.raw)}`}}},
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,ticks:{callback:v=>shortMoney(v)},grid:{color:"#F0ECE7"}}}
    }
  });
}

function renderAnalyticsExpense(rows){
  const map=new Map();
  rows.filter(r=>r.transaction_type==="EXPENSE").forEach(r=>{
    const name=r.expense_categories?.name||"Lainnya";
    map.set(name,(map.get(name)||0)+Number(r.amount||0));
  });

  let labels=[...map.keys()], values=[...map.values()];
  const total=values.reduce((s,v)=>s+v,0);
  const colors=["#F89921","#CD6828","#4A4038","#E9B44C","#8C3F20","#F2C078","#6B5A49","#C97A40","#A69A8B","#DDA15E","#7F5539","#BC6C25"];
  const empty=!values.length;
  if(empty){labels=["Belum ada pengeluaran"];values=[1]}

  if(analyticsExpenseChart) analyticsExpenseChart.destroy();
  analyticsExpenseChart=new Chart($("analyticsExpenseChart"),{
    type:"doughnut",
    data:{labels,datasets:[{data:values,backgroundColor:empty?["#E7E3DE"]:colors.slice(0,values.length),borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>empty?"Belum ada data":`${c.label}: ${rupiah(c.raw)}`}}}}
  });

  if(empty){
    $("analyticsExpensePercentList").innerHTML=`<div class="empty">Belum ada pengeluaran.</div>`;
  }else{
    $("analyticsExpensePercentList").innerHTML=labels.map((name,i)=>{
      const pct=total>0 ? values[i]/total*100 : 0;
      return `<div class="percentage-row">
        <div class="left"><i class="percentage-dot" style="background:${colors[i%colors.length]}"></i><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong></div>
        <span>${pct.toFixed(1).replace(".",",")}%</span>
      </div>`;
    }).join("");
  }
}

function renderAnalyticsIncomeSources(rows){
  const map=new Map();
  rows.filter(r=>r.transaction_type==="INCOME").forEach(r=>{
    const name=r.fund_sources?.name||"Sumber Lainnya";
    map.set(name,(map.get(name)||0)+Number(r.amount||0));
  });

  let labels=[...map.keys()], values=[...map.values()];
  const empty=!values.length;
  if(empty){labels=["Belum ada pemasukan"];values=[1]}

  if(analyticsIncomeSourceChart) analyticsIncomeSourceChart.destroy();
  analyticsIncomeSourceChart=new Chart($("analyticsIncomeSourceChart"),{
    type:"doughnut",
    data:{labels,datasets:[{data:values,backgroundColor:empty?["#E7E3DE"]:["#F89921","#2F855A","#D6A84B","#3B82F6","#8B5CF6","#14B8A6","#64748B","#C97A40"],borderWidth:0}]},
    options:{
      responsive:true,maintainAspectRatio:false,cutout:"68%",
      plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:7,font:{size:9}}},tooltip:{callbacks:{label:c=>empty?"Belum ada data":`${c.label}: ${rupiah(c.raw)}`}}}
    }
  });
}

function renderAnalyticsInstitutions(rows){
  const map=new Map();
  analyticsInstitutions.forEach(i=>map.set(i.id,{name:i.name,income:0,expense:0}));

  rows.forEach(r=>{
    if(r.transaction_type==="INCOME"){
      const x=map.get(r.institution_id);
      if(x)x.income+=Number(r.amount||0);
    }
    if(r.transaction_type==="EXPENSE"){
      const x=map.get(r.institution_id);
      if(x)x.expense+=Number(r.amount||0);
    }
  });

  const relevant=[...map.values()].filter(x=>x.income>0||x.expense>0);
  const dataRows=relevant.length?relevant:[{name:"Belum ada data",income:0,expense:0}];

  if(analyticsInstitutionChart) analyticsInstitutionChart.destroy();
  analyticsInstitutionChart=new Chart($("analyticsInstitutionChart"),{
    type:"bar",
    data:{
      labels:dataRows.map(x=>x.name),
      datasets:[
        {label:"Pemasukan",data:dataRows.map(x=>x.income),backgroundColor:"#F89921",borderRadius:5},
        {label:"Pengeluaran",data:dataRows.map(x=>x.expense),backgroundColor:"#4A4038",borderRadius:5}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:"top",align:"end"},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${rupiah(c.raw)}`}}},
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,ticks:{callback:v=>shortMoney(v)},grid:{color:"#F0ECE7"}}}
    }
  });
}


/* =========================================================
   MASTER LEMBAGA
   ========================================================= */

async function loadInstitutionsModule(){
  try{
    const {data,error}=await sb.from("institutions")
      .select("id,code,name,institution_type,address,phone,is_active,created_at")
      .order("institution_type")
      .order("name");
    if(error) throw error;

    masterInstitutions=data||[];

    $("institutionCards").innerHTML=masterInstitutions.length
      ? masterInstitutions.map(i=>`
        <article class="institution-master-card">
          <div class="institution-master-head">
            <div class="institution-master-icon">${escapeHtml(i.code||i.name.slice(0,3).toUpperCase())}</div>
            <span class="${i.is_active?'active-chip':'inactive-chip'}">${i.is_active?'AKTIF':'NONAKTIF'}</span>
          </div>
          <h3>${escapeHtml(i.name)}</h3>
          <p>${escapeHtml(i.address||'Alamat belum diisi')}</p>
          <div class="institution-meta">
            <div><span>Tipe</span><strong>${escapeHtml(i.institution_type)}</strong></div>
            <div><span>Telepon</span><strong>${escapeHtml(i.phone||'-')}</strong></div>
          </div>
        </article>`).join("")
      : `<div class="empty">Belum ada lembaga.</div>`;
  }catch(err){
    console.error(err);
    toast("Gagal memuat lembaga: "+(err.message||"error"));
  }
}


/* =========================================================
   MANAJEMEN PENGGUNA / SUB LOGIN
   ========================================================= */

async function loadUsersModule(){
  try{
    if(currentProfile?.role!=="SUPER_ADMIN"){
      $("userProfileFormCard").classList.add("hidden");
      $("newUserProfileBtn").classList.add("hidden");
    }else{
      $("userProfileFormCard").classList.remove("hidden");
      $("newUserProfileBtn").classList.remove("hidden");
    }

    if(!masterInstitutions.length){
      const {data,error}=await sb.from("institutions")
        .select("id,code,name,institution_type,is_active")
        .eq("is_active",true)
        .order("name");
      if(error) throw error;
      masterInstitutions=data||[];
    }

    $("profileInstitution").innerHTML=`<option value="">Pilih lembaga</option>`+
      masterInstitutions.filter(i=>i.is_active!==false)
        .map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

    const {data,error}=await sb.from("profiles")
      .select(`
        id,
        full_name,
        role,
        institution_id,
        phone,
        is_active,
        created_at,
        institutions:institution_id(name,code)
      `)
      .order("full_name");
    if(error) throw error;

    usersRowsCache=data||[];
    renderUsersTable();
  }catch(err){
    console.error(err);
    toast("Gagal memuat pengguna: "+(err.message||"error"));
  }
}

function renderUsersTable(){
  $("usersTableBody").innerHTML=usersRowsCache.length
    ? usersRowsCache.map(u=>{
      const isSelf=u.id===currentSession?.user?.id;
      return `
      <tr>
        <td>
          <strong>${escapeHtml(u.full_name||'-')}</strong>
          ${isSelf?` <span class="user-self-chip">AKUN SAYA</span>`:""}
        </td>
        <td><span class="role-chip">${escapeHtml(roleLabel(u.role))}</span></td>
        <td>${escapeHtml(u.institutions?.name||'-')}</td>
        <td>${escapeHtml(u.phone||'-')}</td>
        <td><span class="${u.is_active?'active-chip':'inactive-chip'}">${u.is_active?'AKTIF':'NONAKTIF'}</span></td>
        <td><div class="uid-cell" title="${escapeHtml(u.id)}">${escapeHtml(u.id)}</div></td>
        <td>
          ${currentProfile?.role==="SUPER_ADMIN"
            ? `<div class="user-action-wrap">
                <button class="user-edit-btn" data-user-action="edit" data-id="${u.id}" type="button">Edit</button>
               </div>`
            : "-"}
        </td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="7" class="empty">Belum ada pengguna.</td></tr>`;
}

function setUserProfileEditMode(active,user=null){
  const isOwnSuperAdmin=active &&
    user?.id===currentSession?.user?.id &&
    user?.role==="SUPER_ADMIN";

  $("userProfileFormCard").classList.toggle("user-form-editing",active);
  $("userProfileFormTitle").textContent=active?"Edit Profil Pengguna":"Hubungkan Akun Login";
  $("userProfileFormSubtitle").textContent=active
    ? "Perbarui nama, nomor HP, role, lembaga, atau status akun."
    : "Hanya Super Admin yang dapat menambah atau mengubah profil pengguna.";

  $("profileUserId").disabled=active;
  $("cancelUserEditBtn").classList.toggle("hidden",!active);
  $("saveUserProfileBtn").textContent=active?"Simpan Perubahan":"Simpan Pengguna";

  // Perlindungan akun Super Admin sendiri.
  $("profileRole").disabled=isOwnSuperAdmin;
  $("profileInstitution").disabled=isOwnSuperAdmin;
  $("profileActiveStatus").disabled=isOwnSuperAdmin;

  let note=document.getElementById("userEditProtectionNote");
  if(note) note.remove();

  if(isOwnSuperAdmin){
    note=document.createElement("small");
    note.id="userEditProtectionNote";
    note.className="user-edit-note";
    note.textContent="Untuk keamanan, akun Super Admin sendiri hanya dapat mengubah Nama Lengkap dan Nomor HP. Role, lembaga, dan status aktif dikunci.";
    $("profileActiveStatus").closest(".form-field").appendChild(note);
  }
}

function resetUserProfileForm(){
  editingUserProfileId=null;
  $("userProfileForm").reset();
  $("profileActiveStatus").value="true";
  setUserProfileEditMode(false);
}

function startEditUserProfile(id){
  if(currentProfile?.role!=="SUPER_ADMIN"){
    throw new Error("Hanya Super Admin yang dapat mengedit pengguna.");
  }

  const user=usersRowsCache.find(u=>u.id===id);
  if(!user) throw new Error("Profil pengguna tidak ditemukan.");

  editingUserProfileId=user.id;
  $("profileUserId").value=user.id;
  $("profileFullName").value=user.full_name||"";
  $("profileRole").value=user.role||"";
  $("profileInstitution").value=user.institution_id||"";
  $("profilePhone").value=user.phone||"";
  $("profileActiveStatus").value=user.is_active===false?"false":"true";

  setUserProfileEditMode(true,user);
  $("userProfileFormCard").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("profileFullName").focus(),300);
}

async function refreshCurrentProfileIdentity(){
  if(!currentSession?.user?.id) return;

  currentProfile=await getProfile(currentSession.user.id);
  const p=currentProfile;
  const first=(p.full_name||"Pengguna").trim().split(/\s+/)[0];

  $("userName").textContent=p.full_name||"Pengguna";
  $("userRole").textContent=roleLabel(p.role);
  $("avatar").textContent=first.charAt(0).toUpperCase();
  $("welcomeName").textContent=first;
  $("welcomeInstitution").textContent=
    isCentralUser()
      ? "Dashboard konsolidasi Yayasan dan seluruh lembaga"
      : "Lembaga: "+(p.institutions?.name||"-");

  applyRoleBasedUI();
}

async function saveUserProfile(){
  if(currentProfile?.role!=="SUPER_ADMIN"){
    throw new Error("Hanya Super Admin yang dapat menambah atau mengedit pengguna.");
  }

  const id=$("profileUserId").value.trim();
  const full_name=$("profileFullName").value.trim();
  const role=$("profileRole").value;
  const institution_id=$("profileInstitution").value;
  const phone=$("profilePhone").value.trim();
  const is_active=$("profileActiveStatus").value==="true";

  const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!uuidPattern.test(id)) throw new Error("UID tidak valid. Copy UID lengkap dari Supabase Authentication.");
  if(!full_name||!role||!institution_id) throw new Error("Nama, role, dan lembaga wajib diisi.");

  // MODE EDIT
  if(editingUserProfileId){
    const target=usersRowsCache.find(u=>u.id===editingUserProfileId);
    if(!target) throw new Error("Profil yang akan diedit tidak ditemukan.");

    const isOwnSuperAdmin=
      target.id===currentSession?.user?.id &&
      target.role==="SUPER_ADMIN";

    const effectiveRole=isOwnSuperAdmin?target.role:role;
    const effectiveInstitution=isOwnSuperAdmin?target.institution_id:institution_id;
    const effectiveActive=isOwnSuperAdmin?true:is_active;

    if(!isOwnSuperAdmin && effectiveRole==="SUPER_ADMIN"){
      throw new Error("Role SUPER_ADMIN tidak dapat diberikan ke akun lain dari menu ini.");
    }

    const {error}=await sb.rpc("update_simkeu_user_profile",{
      p_user_id:editingUserProfileId,
      p_full_name:full_name,
      p_phone:phone||null,
      p_role:effectiveRole,
      p_institution_id:effectiveInstitution,
      p_is_active:effectiveActive
    });
    if(error) throw error;

    const editedSelf=editingUserProfileId===currentSession?.user?.id;
    resetUserProfileForm();
    await loadUsersModule();

    if(editedSelf){
      await refreshCurrentProfileIdentity();
    }

    toast("Profil pengguna berhasil diperbarui.");
    return;
  }

  // MODE TAMBAH BARU
  if(role==="SUPER_ADMIN"){
    throw new Error("Penambahan SUPER_ADMIN kedua tidak diizinkan dari form ini.");
  }

  const payload={
    id,
    full_name,
    role,
    institution_id,
    phone:phone||null,
    is_active
  };

  const {error}=await sb.from("profiles").insert(payload);
  if(error){
    if(error.code==="23503"){
      throw new Error("UID tidak ditemukan di Supabase Authentication. Buat user terlebih dahulu di Authentication → Users.");
    }
    if(error.code==="23505"){
      throw new Error("UID tersebut sudah terhubung ke profil SIMKEU.");
    }
    throw error;
  }

  resetUserProfileForm();
  await loadUsersModule();
  toast("Pengguna berhasil dihubungkan ke SIMKEU.");
}


/* =========================================================
   ROLE-BASED UI / DASHBOARD KHUSUS LEMBAGA v6.2
   ========================================================= */
function institutionDisplayName(){
  return currentProfile?.institutions?.name || "Lembaga";
}

function applyRoleBasedUI(){
  const central=isCentralUser();
  const institutionName=institutionDisplayName();

  document.body.classList.toggle("institution-mode",!central);

  // Menu khusus pusat.
  ["navInstitutions","navUsers","navAudit","navClosing","navExecutive"].forEach(id=>{
    const el=$(id);
    if(el) el.classList.toggle("role-hidden",!central);
  });

  // Transfer tetap dapat dilihat lembaga sebagai riwayat transfer masuk/keluar,
  // tetapi lembaga tidak dapat membuat transfer baru (sudah dibatasi di modul transfer).
  if($("navTransfer")){
    $("navTransfer").textContent=central ? "⇄ Transfer Internal" : "⇄ Transfer Masuk/Keluar";
  }

  // Branding dashboard.
  if(central){
    $("dashboardBrandKicker").textContent="SISTEM INFORMASI MANAJEMEN KEUANGAN";
    $("dashboardBrandTitle").textContent="SIMKEU YAYASAN AR-RAUDLAH KAPEDI";
    $("dashboardBrandSubtitle").textContent="Keuangan Yayasan dan seluruh lembaga dalam satu sistem terintegrasi";
  }else{
    $("dashboardBrandKicker").textContent="SISTEM INFORMASI KEUANGAN LEMBAGA";
    $("dashboardBrandTitle").textContent=`SIMKEU ${institutionName.toUpperCase()} AR-RAUDLAH KAPEDI`;
    $("dashboardBrandSubtitle").textContent=`Pengelolaan keuangan ${institutionName} yang terintegrasi dengan Yayasan Ar-Raudlah Kapedi`;
  }
}

function restrictInstitutionSelector(selectId, institutions){
  const select=$(selectId);
  if(!select || isCentralUser()) return institutions;

  const ownId=currentProfile?.institution_id;
  const own=institutions.filter(i=>i.id===ownId);

  if(own.length){
    select.innerHTML=own.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
    select.value=ownId;
    select.disabled=true;
  }
  return own;
}


/* =========================================================
   PUSAT BUKTI TRANSAKSI + APPROVAL CENTER v6.3
   ========================================================= */

async function loadEvidenceModule(){
  try{
    if(!$("evidenceDateFrom").value) $("evidenceDateFrom").value=firstDayOfCurrentMonth();
    if(!$("evidenceDateTo").value) $("evidenceDateTo").value=todayISO();

    if(!evidenceInstitutions.length){
      const {data,error}=await sb.from("institutions")
        .select("id,code,name,institution_type,is_active")
        .eq("is_active",true)
        .order("name");
      if(error) throw error;
      evidenceInstitutions=data||[];
    }

    if(isCentralUser()){
      $("evidenceInstitution").innerHTML=`<option value="ALL">Semua Lembaga</option>`+
        evidenceInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
      $("evidenceInstitution").disabled=false;
      $("evidenceApprovalNotice").classList.remove("hidden");
      $("evidenceHeroText").textContent="Galeri bukti sekaligus pusat pemeriksaan dan approval pengeluaran seluruh lembaga.";
    }else{
      restrictInstitutionSelector("evidenceInstitution",evidenceInstitutions);
      $("evidenceApprovalNotice").classList.add("hidden");
      $("evidenceHeroText").textContent=`Galeri nota, kuitansi, invoice, dan dokumen pengeluaran ${institutionDisplayName()}.`;
    }

    await fetchEvidenceTransactions();
  }catch(err){
    console.error(err);
    toast("Gagal memuat bukti transaksi: "+(err.message||"error"));
  }
}

async function fetchEvidenceTransactions(){
  const from=$("evidenceDateFrom").value;
  const to=$("evidenceDateTo").value;

  if(!from||!to) throw new Error("Tanggal awal dan akhir wajib diisi.");
  if(from>to) throw new Error("Tanggal awal tidak boleh melewati tanggal akhir.");

  $("evidenceGallery").innerHTML=`<div class="empty">Memuat bukti transaksi...</div>`;

  const {data,error}=await sb.from("transactions")
    .select(`
      id,
      transaction_number,
      transaction_date,
      transaction_type,
      institution_id,
      expense_category_id,
      source_account_id,
      amount,
      description,
      status,
      created_at,
      institutions:institution_id(name,code),
      expense_categories:expense_category_id(name),
      accounts:source_account_id(account_name),
      transaction_attachments(id,file_name,file_path,file_type,uploaded_at)
    `)
    .eq("transaction_type","EXPENSE")
    .gte("transaction_date",from)
    .lte("transaction_date",to)
    .order("transaction_date",{ascending:false})
    .order("created_at",{ascending:false})
    .limit(500);

  if(error) throw error;
  evidenceRowsCache=data||[];

  updateEvidenceStats();
  renderEvidenceGallery();
}

function getFilteredEvidenceRows(){
  const institution=$("evidenceInstitution").value;
  const status=$("evidenceStatus").value;
  const proofStatus=$("evidenceProofStatus").value;
  const search=($("evidenceSearch").value||"").trim().toLowerCase();

  return evidenceRowsCache.filter(r=>{
    const proofs=r.transaction_attachments||[];
    const hay=[
      r.transaction_number,
      r.description,
      r.institutions?.name,
      r.expense_categories?.name,
      r.accounts?.account_name,
      ...proofs.map(p=>p.file_name)
    ].filter(Boolean).join(" ").toLowerCase();

    return (institution==="ALL" || r.institution_id===institution) &&
      (status==="ALL" || r.status===status) &&
      (proofStatus==="ALL" || (proofStatus==="WITH_PROOF" ? proofs.length>0 : proofs.length===0)) &&
      (!search || hay.includes(search));
  });
}

function updateEvidenceStats(){
  const rows=getFilteredEvidenceRows();
  const files=rows.reduce((sum,r)=>sum+(r.transaction_attachments?.length||0),0);

  $("evidenceFilesCount").textContent=files;
  $("evidenceSubmittedCount").textContent=rows.filter(r=>r.status==="SUBMITTED").length;
  $("evidenceApprovedCount").textContent=rows.filter(r=>r.status==="APPROVED").length;
  $("evidenceMissingCount").textContent=rows.filter(r=>(r.transaction_attachments||[]).length===0).length;
}

function renderEvidenceGallery(){
  const rows=getFilteredEvidenceRows();
  updateEvidenceStats();
  const generation=++evidenceThumbGeneration;

  if(!rows.length){
    $("evidenceGallery").innerHTML=`<div class="empty">Tidak ada bukti/transaksi sesuai filter.</div>`;
    return;
  }

  $("evidenceGallery").innerHTML=rows.map(r=>{
    const proofs=r.transaction_attachments||[];
    const first=proofs[0];
    const isImage=first?.file_type?.startsWith("image/");
    const hasProof=proofs.length>0;
    const canApprove=isCentralUser() && r.status==="SUBMITTED" && hasProof;
    const canReject=isCentralUser() && r.status==="SUBMITTED";

    let preview;
    if(!hasProof){
      preview=`
        <div class="evidence-file-placeholder">
          <strong>!</strong>
          <span>Belum ada bukti transaksi</span>
        </div>`;
    }else if(isImage){
      preview=`
        <div class="evidence-file-placeholder evidence-thumb-loading" data-thumb-placeholder="${r.id}">
          <strong>⌛</strong>
          <span>Memuat pratinjau...</span>
        </div>
        <img class="hidden" data-evidence-thumb="${r.id}" alt="Bukti ${escapeHtml(r.transaction_number||"")}">`;
    }else{
      preview=`
        <div class="evidence-file-placeholder">
          <strong>PDF</strong>
          <span>${escapeHtml(first.file_name)}</span>
        </div>`;
    }

    const actions=[];
    if(hasProof){
      actions.push(`<button class="secondary-btn evidence-action-btn" data-evidence-action="preview" data-id="${r.id}" type="button">Lihat Bukti</button>`);
    }
    if(canApprove){
      actions.push(`<button class="brand-btn evidence-action-btn" data-evidence-action="approve" data-id="${r.id}" type="button">Setujui</button>`);
    }
    if(canReject){
      actions.push(`<button class="table-action reject evidence-reject-btn" data-evidence-action="reject" data-id="${r.id}" type="button">Tolak</button>`);
    }

    return `
      <article class="evidence-card ${hasProof?"":"evidence-missing"}">
        <div class="evidence-preview">
          <span class="pill ${statusClass(r.status)} evidence-status-top">${escapeHtml(r.status)}</span>
          ${hasProof?`<span class="evidence-count-chip">${proofs.length} file</span>`:""}
          ${preview}
        </div>
        <div class="evidence-card-body">
          <div class="evidence-card-number">
            <strong>${escapeHtml(r.transaction_number||"-")}</strong>
            <span>${formatDate(r.transaction_date)}</span>
          </div>
          <h3 class="evidence-card-title">${escapeHtml(r.expense_categories?.name||"Pengeluaran")}</h3>
          <p class="evidence-card-desc">${escapeHtml(r.description||"Tanpa keterangan")}</p>

          <div class="evidence-card-meta">
            <div><span>Lembaga</span><strong>${escapeHtml(r.institutions?.name||"-")}</strong></div>
            <div><span>Akun Sumber</span><strong>${escapeHtml(r.accounts?.account_name||"-")}</strong></div>
            <div><span>Nominal</span><strong class="evidence-amount">${rupiah(r.amount)}</strong></div>
            <div><span>Dokumen</span><strong>${hasProof?`${proofs.length} file`:"Belum ada"}</strong></div>
          </div>

          ${!hasProof?`<div class="evidence-missing-warning">Transaksi ini belum memiliki nota/kuitansi.</div>`:""}

          <div class="evidence-card-actions">
            ${actions.join("") || `<span class="account-sub">Tidak ada aksi tersedia.</span>`}
          </div>
        </div>
      </article>`;
  }).join("");

  hydrateEvidenceThumbnails(rows,generation);
}

async function hydrateEvidenceThumbnails(rows,generation){
  const jobs=rows.slice(0,60).map(async r=>{
    const first=(r.transaction_attachments||[])[0];
    if(!first || !first.file_type?.startsWith("image/")) return;

    try{
      const {data,error}=await sb.storage
        .from("transaction-proofs")
        .createSignedUrl(first.file_path,300);
      if(error) throw error;
      if(generation!==evidenceThumbGeneration) return;

      const img=document.querySelector(`[data-evidence-thumb="${r.id}"]`);
      const placeholder=document.querySelector(`[data-thumb-placeholder="${r.id}"]`);
      if(img){
        img.src=data.signedUrl;
        img.classList.remove("hidden");
        img.onerror=()=>{
          img.classList.add("hidden");
          if(placeholder) placeholder.classList.remove("hidden");
        };
        img.onload=()=>{
          if(placeholder) placeholder.classList.add("hidden");
        };
      }
    }catch(err){
      console.warn("Thumbnail gagal",r.id,err);
    }
  });
  await Promise.allSettled(jobs);
}

async function createEvidenceSignedUrl(proof,seconds=300){
  const {data,error}=await sb.storage
    .from("transaction-proofs")
    .createSignedUrl(proof.file_path,seconds);
  if(error) throw error;
  return data.signedUrl;
}

async function previewEvidence(transactionId){
  const row=evidenceRowsCache.find(r=>r.id===transactionId);
  const proofs=row?.transaction_attachments||[];
  if(!row || !proofs.length) throw new Error("Bukti transaksi tidak ditemukan.");

  let proof=proofs[0];
  if(proofs.length>1){
    const list=proofs.map((p,i)=>`${i+1}. ${p.file_name}`).join("\n");
    const choice=prompt(`Transaksi memiliki ${proofs.length} file.\nPilih nomor file:\n\n${list}`,"1");
    if(choice===null) return;
    const idx=Number(choice)-1;
    if(!Number.isInteger(idx)||idx<0||idx>=proofs.length) throw new Error("Nomor file tidak valid.");
    proof=proofs[idx];
  }

  $("evidenceModalTitle").textContent=proof.file_name||"Bukti Transaksi";
  $("evidenceModalMeta").textContent=`${row.transaction_number} • ${row.institutions?.name||"-"} • ${rupiah(row.amount)}`;
  $("evidenceModalViewer").innerHTML=`<div class="evidence-loading">Memuat dokumen...</div>`;
  $("evidencePreviewModal").classList.remove("hidden");
  $("evidencePreviewModal").setAttribute("aria-hidden","false");

  const url=await createEvidenceSignedUrl(proof,600);
  currentEvidenceExternalUrl=url;

  if(proof.file_type?.startsWith("image/")){
    $("evidenceModalViewer").innerHTML=`<img src="${url}" alt="${escapeHtml(proof.file_name||"Bukti transaksi")}">`;
  }else if(proof.file_type==="application/pdf" || proof.file_name?.toLowerCase().endsWith(".pdf")){
    $("evidenceModalViewer").innerHTML=`<iframe src="${url}" title="${escapeHtml(proof.file_name||"PDF bukti")}"></iframe>`;
  }else{
    $("evidenceModalViewer").innerHTML=`
      <div class="evidence-file-placeholder" style="color:#fff">
        <strong>FILE</strong>
        <span>${escapeHtml(proof.file_name||"Dokumen")}</span>
      </div>`;
  }
}

function closeEvidencePreview(){
  $("evidencePreviewModal").classList.add("hidden");
  $("evidencePreviewModal").setAttribute("aria-hidden","true");
  $("evidenceModalViewer").innerHTML="";
  currentEvidenceExternalUrl=null;
}

async function approveFromEvidence(transactionId){
  if(!isCentralUser()) throw new Error("Approval hanya dapat dilakukan oleh akun Yayasan.");

  const row=evidenceRowsCache.find(r=>r.id===transactionId);
  if(!row) throw new Error("Transaksi tidak ditemukan.");
  if(row.status!=="SUBMITTED") throw new Error("Hanya transaksi SUBMITTED yang dapat disetujui.");
  if(!(row.transaction_attachments||[]).length) throw new Error("Transaksi belum memiliki bukti.");

  if(!confirm(`Setujui ${row.transaction_number} sebesar ${rupiah(row.amount)}?`)) return;

  const {error}=await sb.rpc("approve_transaction",{
    p_transaction_id:transactionId,
    p_note:"Disetujui melalui Pusat Bukti Transaksi"
  });
  if(error) throw error;

  await Promise.all([fetchEvidenceTransactions(),loadDashboard()]);
  toast("Transaksi disetujui. Saldo telah diperbarui.");
}

async function rejectFromEvidence(transactionId){
  if(!isCentralUser()) throw new Error("Penolakan hanya dapat dilakukan oleh akun Yayasan.");

  const row=evidenceRowsCache.find(r=>r.id===transactionId);
  if(!row) throw new Error("Transaksi tidak ditemukan.");

  const note=prompt(`Alasan penolakan ${row.transaction_number}:`);
  if(note===null) return;
  if(!note.trim()) throw new Error("Alasan penolakan wajib diisi.");

  const {error}=await sb.rpc("reject_transaction",{
    p_transaction_id:transactionId,
    p_note:note.trim()
  });
  if(error) throw error;

  await Promise.all([fetchEvidenceTransactions(),loadDashboard()]);
  toast("Transaksi ditolak.");
}


/* =========================================================
   AUDIT TRAIL + AKTIVITAS SISTEM v6.4
   ========================================================= */

const AUDIT_ACTION_LABELS={
  TRANSACTION_CREATED:"Transaksi dibuat",
  TRANSACTION_UPDATED:"Transaksi diperbarui",
  TRANSACTION_SUBMITTED:"Transaksi diajukan",
  TRANSACTION_APPROVED:"Transaksi disetujui",
  TRANSACTION_REJECTED:"Transaksi ditolak",
  TRANSACTION_VOIDED:"Transaksi di-VOID",
  TRANSACTION_WITHDRAWN:"Pengajuan ditarik",
  TRANSACTION_REOPENED:"Transaksi dibuka untuk perbaikan",
  TRANSACTION_DELETED:"Transaksi dihapus",
  PROOF_UPLOADED:"Bukti diunggah",
  PROOF_DELETED:"Bukti dihapus",
  USER_PROFILE_CREATED:"Profil pengguna dibuat",
  USER_PROFILE_UPDATED:"Profil pengguna diubah",
  ACCOUNT_CREATED:"Akun keuangan dibuat",
  ACCOUNT_UPDATED:"Akun keuangan diubah",
  APPROVAL_RECORDED:"Approval dicatat",
  BUDGET_CREATED:"Anggaran dibuat",
  BUDGET_UPDATED:"Anggaran diperbarui",
  PERIOD_CLOSED:"Periode ditutup",
  PERIOD_REOPENED:"Periode dibuka kembali",
  ASSET_CREATED:"Aset dicatat",
  ASSET_UPDATED:"Aset diperbarui",
  ASSET_MOVEMENT:"Mutasi aset dicatat"
};

function auditActionLabel(action){
  return AUDIT_ACTION_LABELS[action]||String(action||"Aktivitas").replaceAll("_"," ");
}

function auditCategory(action){
  const a=String(action||"");
  if(a.startsWith("PROOF_")) return "PROOF";
  if(a.startsWith("USER_")) return "USER";
  if(a.startsWith("ACCOUNT_")) return "ACCOUNT";
  if(a.startsWith("BUDGET_")) return "BUDGET";
  if(a.startsWith("PERIOD_")) return "PERIOD";
  if(a.startsWith("ASSET_")) return "ASSET";
  if(a.includes("SUBMITTED")||a.includes("APPROVED")||a.includes("REJECTED")||a.includes("VOIDED")||a.startsWith("APPROVAL_")) return "APPROVAL";
  if(a.startsWith("TRANSACTION_")) return "TRANSACTION";
  return "TRANSACTION";
}

function auditVisual(action){
  const a=String(action||"");
  if(a.includes("APPROVED")) return {icon:"✓",cls:"approval"};
  if(a.includes("REJECTED")||a.includes("DELETED")||a.includes("VOIDED")) return {icon:"!",cls:"reject"};
  if(a.startsWith("PROOF_")) return {icon:"▤",cls:"proof"};
  if(a.startsWith("USER_")) return {icon:"♙",cls:"user"};
  if(a.startsWith("ACCOUNT_")) return {icon:"▣",cls:"account"};
  if(a.startsWith("BUDGET_")) return {icon:"▧",cls:"account"};
  if(a==="PERIOD_CLOSED") return {icon:"🔒",cls:"approval"};
  if(a==="PERIOD_REOPENED") return {icon:"↺",cls:"account"};
  if(a.startsWith("ASSET_")) return {icon:"▦",cls:"account"};
  if(a.includes("SUBMITTED")) return {icon:"→",cls:"approval"};
  return {icon:"◷",cls:""};
}

function auditProfileName(userId){
  if(!userId) return "Sistem";
  return auditProfiles.find(p=>p.id===userId)?.full_name||"Pengguna";
}

function auditInstitutionName(id){
  if(!id) return "—";
  return auditInstitutions.find(i=>i.id===id)?.name||"Lembaga";
}

function auditTargetTitle(row){
  const d=row.details||{};
  if(row.table_name==="transactions"){
    return d.transaction_number || `Transaksi ${String(row.record_id||"").slice(0,8)}`;
  }
  if(row.table_name==="transaction_attachments"){
    return d.file_name || "Bukti transaksi";
  }
  if(row.table_name==="profiles"){
    return d.full_name || "Profil pengguna";
  }
  if(row.table_name==="accounts"){
    return d.account_name || "Akun keuangan";
  }
  if(row.table_name==="budgets"){
    return `Anggaran ${d.fiscal_year||""}`.trim();
  }
  if(row.table_name==="period_closures"){
    const month=Number(d.period_month||0);
    const name=month>=1&&month<=12 ? MONTH_NAMES[month-1] : `Bulan ${month}`;
    return `${name} ${d.fiscal_year||""}`.trim();
  }
  return `${row.table_name||"Data"} ${String(row.record_id||"").slice(0,8)}`;
}

function auditDescription(row){
  const d=row.details||{};
  const action=row.action;

  if(action==="TRANSACTION_CREATED"){
    return `${typeLabel(d.transaction_type||"")} ${rupiah(Number(d.amount||0))}${d.description?` • ${d.description}`:""}`;
  }
  if(action==="TRANSACTION_SUBMITTED"){
    return `${d.transaction_number||"Transaksi"} diajukan untuk pemeriksaan Yayasan.`;
  }
  if(action==="TRANSACTION_APPROVED"){
    return `${d.transaction_number||"Transaksi"} disetujui${d.amount?` sebesar ${rupiah(Number(d.amount))}`:""}.`;
  }
  if(action==="TRANSACTION_REJECTED"){
    return `${d.transaction_number||"Transaksi"} ditolak${d.rejection_note?` • ${d.rejection_note}`:""}.`;
  }
  if(action==="TRANSACTION_VOIDED"){
    return `${d.transaction_number||"Transaksi"} di-VOID${d.void_reason?` • ${d.void_reason}`:""}.`;
  }
  if(action==="TRANSACTION_WITHDRAWN"){
    return `${d.transaction_number||"Transaksi"} ditarik kembali ke DRAFT${d.correction_note?` • ${d.correction_note}`:""}.`;
  }
  if(action==="TRANSACTION_REOPENED"){
    return `${d.transaction_number||"Transaksi"} dibuka kembali untuk diperbaiki${d.correction_note?` • ${d.correction_note}`:""}.`;
  }
  if(action==="TRANSACTION_UPDATED"){
    const changes=[];
    if(d.old_amount!=null && d.new_amount!=null && Number(d.old_amount)!==Number(d.new_amount)){
      changes.push(`nominal ${rupiah(Number(d.old_amount))} → ${rupiah(Number(d.new_amount))}`);
    }
    if(d.old_description!==d.new_description && (d.old_description!=null||d.new_description!=null)){
      changes.push("keterangan diperbarui");
    }
    return changes.length?changes.join(" • "):"Data transaksi diperbarui.";
  }
  if(action==="PROOF_UPLOADED"){
    return `${d.file_name||"Dokumen"} ditambahkan sebagai bukti transaksi${d.transaction_number?` ${d.transaction_number}`:""}.`;
  }
  if(action==="PROOF_DELETED"){
    return `${d.file_name||"Dokumen"} dihapus dari bukti transaksi.`;
  }
  if(action==="USER_PROFILE_CREATED"){
    return `${d.full_name||"Pengguna"} dihubungkan sebagai ${roleLabel(d.role||"")}${d.institution_name?` • ${d.institution_name}`:""}.`;
  }
  if(action==="USER_PROFILE_UPDATED"){
    const x=[];
    if(d.old_role!==d.new_role) x.push(`role ${roleLabel(d.old_role||"")} → ${roleLabel(d.new_role||"")}`);
    if(d.old_institution_id!==d.new_institution_id) x.push("lembaga diubah");
    if(d.old_is_active!==d.new_is_active) x.push(`status ${d.new_is_active?"aktif":"nonaktif"}`);
    return x.length?x.join(" • "):"Profil pengguna diperbarui.";
  }
  if(action==="ACCOUNT_CREATED"){
    return `${d.account_name||"Akun"} dibuat${d.account_type?` • ${d.account_type}`:""}.`;
  }
  if(action==="ACCOUNT_UPDATED"){
    return `${d.account_name||"Akun"} diperbarui.`;
  }
  if(action==="APPROVAL_RECORDED"){
    return `${d.approval_action||"Approval"}${d.note?` • ${d.note}`:""}`;
  }
  if(action==="BUDGET_CREATED"){
    return `Anggaran ${d.fiscal_year||""} ditetapkan sebesar ${rupiah(Number(d.budget_amount||0))}.`;
  }
  if(action==="BUDGET_UPDATED"){
    return `Anggaran diperbarui dari ${rupiah(Number(d.old_budget_amount||0))} menjadi ${rupiah(Number(d.new_budget_amount||0))}.`;
  }
  if(action==="PERIOD_CLOSED"){
    const m=Number(d.period_month||0);
    return `Periode ${m>=1&&m<=12?MONTH_NAMES[m-1]:m} ${d.fiscal_year||""} ditutup.${d.note?` • ${d.note}`:""}`;
  }
  if(action==="PERIOD_REOPENED"){
    const m=Number(d.period_month||0);
    return `Periode ${m>=1&&m<=12?MONTH_NAMES[m-1]:m} ${d.fiscal_year||""} dibuka kembali.${d.reason?` • ${d.reason}`:""}`;
  }
  if(action==="ASSET_CREATED"){
    return `${d.asset_code||"Aset"} • ${d.asset_name||""} dicatat dengan nilai ${rupiah(Number(d.acquisition_value||0))}.`;
  }
  if(action==="ASSET_UPDATED"){
    return `${d.asset_code||"Aset"} • data aset diperbarui.`;
  }
  if(action==="ASSET_MOVEMENT"){
    return `${d.asset_code||"Aset"} • mutasi aset dicatat${d.note?` • ${d.note}`:""}.`;
  }
  return "Aktivitas sistem tercatat.";
}

function auditLocalDateTime(value){
  if(!value) return "—";
  return new Intl.DateTimeFormat("id-ID",{
    day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"
  }).format(new Date(value));
}

function auditTimeOnly(value){
  if(!value) return "—";
  return new Intl.DateTimeFormat("id-ID",{hour:"2-digit",minute:"2-digit"}).format(new Date(value));
}

async function loadAuditModule(){
  if(!isCentralUser()){
    toast("Audit Trail hanya tersedia untuk akun Yayasan.");
    await switchView("dashboard");
    return;
  }

  try{
    if(!$("auditDateFrom").value) $("auditDateFrom").value=firstDayOfCurrentMonth();
    if(!$("auditDateTo").value) $("auditDateTo").value=todayISO();

    if(!auditInstitutions.length || !auditProfiles.length){
      const [instRes,profileRes]=await Promise.all([
        sb.from("institutions").select("id,name,code").order("name"),
        sb.from("profiles").select("id,full_name,role,institution_id,is_active").order("full_name")
      ]);
      if(instRes.error) throw instRes.error;
      if(profileRes.error) throw profileRes.error;

      auditInstitutions=instRes.data||[];
      auditProfiles=profileRes.data||[];

      $("auditInstitution").innerHTML=`<option value="ALL">Semua Lembaga</option>`+
        auditInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

      $("auditActor").innerHTML=`<option value="ALL">Semua Pengguna</option>`+
        auditProfiles.map(p=>`<option value="${p.id}">${escapeHtml(p.full_name||"Pengguna")}</option>`).join("");
    }

    await fetchAuditLogs();
  }catch(err){
    console.error(err);
    toast("Gagal memuat Audit Trail: "+(err.message||"error"));
  }
}

async function fetchAuditLogs(){
  const from=$("auditDateFrom").value;
  const to=$("auditDateTo").value;
  if(!from||!to) throw new Error("Tanggal awal dan akhir wajib diisi.");
  if(from>to) throw new Error("Tanggal awal tidak boleh melewati tanggal akhir.");

  $("auditTimeline").innerHTML=`<div class="empty">Memuat audit trail...</div>`;

  const startDate=new Date(`${from}T00:00:00`);
  const start=startDate.toISOString();
  const endDate=new Date(`${to}T00:00:00`);
  endDate.setDate(endDate.getDate()+1);
  const end=endDate.toISOString();

  const {data,error}=await sb.from("audit_logs")
    .select("id,user_id,institution_id,action,table_name,record_id,details,created_at")
    .gte("created_at",start)
    .lt("created_at",end)
    .order("created_at",{ascending:false})
    .limit(1000);

  if(error) throw error;
  auditRowsCache=data||[];
  renderAuditTrail();
}

function getFilteredAuditRows(){
  const institution=$("auditInstitution").value;
  const actor=$("auditActor").value;
  const category=$("auditAction").value;
  const q=($("auditSearch").value||"").trim().toLowerCase();

  return auditRowsCache.filter(r=>{
    const target=auditTargetTitle(r);
    const actorName=auditProfileName(r.user_id);
    const instName=auditInstitutionName(r.institution_id);
    const desc=auditDescription(r);
    const hay=[r.action,r.table_name,target,actorName,instName,desc,JSON.stringify(r.details||{})].join(" ").toLowerCase();

    return (institution==="ALL" || r.institution_id===institution) &&
      (actor==="ALL" || r.user_id===actor) &&
      (category==="ALL" || auditCategory(r.action)===category) &&
      (!q || hay.includes(q));
  });
}

function renderAuditTrail(){
  const rows=getFilteredAuditRows();
  const today=todayISO();
  const localDateKey=value=>{
    const d=new Date(value);
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,"0");
    const day=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  };
  const todayRows=auditRowsCache.filter(r=>r.created_at && localDateKey(r.created_at)===today);

  $("auditTodayCount").textContent=todayRows.length;
  $("auditApprovalCount").textContent=todayRows.filter(r=>r.action==="TRANSACTION_APPROVED").length;
  $("auditProofCount").textContent=rows.filter(r=>r.action==="PROOF_UPLOADED").length;
  $("auditActorCount").textContent=new Set(rows.map(r=>r.user_id).filter(Boolean)).size;
  $("auditResultInfo").textContent=`${rows.length} aktivitas • ${formatDate($("auditDateFrom").value)} s.d. ${formatDate($("auditDateTo").value)}`;

  $("auditTimeline").innerHTML=rows.length?rows.map(r=>{
    const visual=auditVisual(r.action);
    return `
      <div class="audit-event">
        <div class="audit-icon ${visual.cls}">${visual.icon}</div>
        <div class="audit-event-main">
          <div class="audit-event-top">
            <strong>${escapeHtml(auditProfileName(r.user_id))}</strong>
            <span class="audit-action-chip ${visual.cls}">${escapeHtml(auditActionLabel(r.action))}</span>
          </div>
          <div class="audit-event-title">${escapeHtml(auditTargetTitle(r))}</div>
          <div class="audit-event-desc">${escapeHtml(auditDescription(r))}</div>
          <div class="audit-event-meta">
            <span>▣ ${escapeHtml(auditInstitutionName(r.institution_id))}</span>
            <span>▤ ${escapeHtml(r.table_name||"-")}</span>
            <span>${auditLocalDateTime(r.created_at)}</span>
          </div>
        </div>
        <div class="audit-event-right">
          <span class="audit-time">${auditTimeOnly(r.created_at)}</span>
          <button class="audit-detail-btn" data-audit-detail="${r.id}" type="button">Detail</button>
        </div>
      </div>`;
  }).join(""):`<div class="empty">Belum ada aktivitas pada filter ini.</div>`;

  renderAuditSummary(rows);
}

function renderAuditSummary(rows){
  const groups=[
    ["TRANSACTION","Transaksi"],
    ["APPROVAL","Submit / Approval"],
    ["PROOF","Bukti Transaksi"],
    ["USER","Pengguna"],
    ["ACCOUNT","Akun Keuangan"],
    ["BUDGET","Anggaran"],
    ["PERIOD","Tutup Buku"],
    ["ASSET","Aset & Inventaris"]
  ];
  const total=rows.length||1;

  $("auditSummaryList").innerHTML=groups.map(([key,label])=>{
    const count=rows.filter(r=>auditCategory(r.action)===key).length;
    const pct=Math.round(count/total*100);
    return `<div class="audit-summary-item">
      <div class="audit-summary-top"><strong>${label}</strong><span>${count}</span></div>
      <div class="audit-progress"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join("");
}

function showAuditDetail(id){
  const row=auditRowsCache.find(r=>String(r.id)===String(id));
  if(!row) return;

  $("auditModalTitle").textContent=auditActionLabel(row.action);
  $("auditModalMeta").textContent=auditLocalDateTime(row.created_at);

  const d=row.details||{};
  const detailPairs=[
    ["Pelaku",auditProfileName(row.user_id)],
    ["Lembaga",auditInstitutionName(row.institution_id)],
    ["Target",auditTargetTitle(row)],
    ["Tabel",row.table_name||"—"],
    ["Record ID",row.record_id||"—"],
    ["Aksi",row.action||"—"]
  ];

  const changes=[];
  const readableKeys=[
    ["transaction_number","Nomor transaksi"],
    ["transaction_type","Jenis transaksi"],
    ["amount","Nominal"],
    ["old_status","Status sebelumnya"],
    ["new_status","Status baru"],
    ["file_name","Nama file"],
    ["full_name","Nama pengguna"],
    ["role","Role"],
    ["old_role","Role sebelumnya"],
    ["new_role","Role baru"],
    ["account_name","Nama akun"],
    ["note","Catatan"],
    ["rejection_note","Alasan penolakan"],
    ["correction_note","Catatan koreksi"],
    ["void_reason","Alasan VOID"],
    ["fiscal_year","Tahun"],
    ["period_month","Bulan"],
    ["budget_amount","Anggaran"],
    ["old_budget_amount","Anggaran sebelumnya"],
    ["new_budget_amount","Anggaran baru"],
    ["reason","Alasan"]
  ];

  readableKeys.forEach(([key,label])=>{
    if(d[key]!==undefined && d[key]!==null && d[key]!==""){
      let val=d[key];
      if(["amount","budget_amount","old_budget_amount","new_budget_amount"].includes(key)) val=rupiah(Number(val||0));
      if(key==="period_month"){
        const m=Number(val);
        val=m>=1&&m<=12?MONTH_NAMES[m-1]:val;
      }
      if(key==="role"||key==="old_role"||key==="new_role") val=roleLabel(val);
      changes.push(`<div class="audit-change-row"><span>${label}</span><strong>${escapeHtml(String(val))}</strong></div>`);
    }
  });

  $("auditModalBody").innerHTML=`
    <div class="audit-detail-grid">
      ${detailPairs.map(([k,v])=>`<div class="audit-detail-box"><span>${k}</span><strong>${escapeHtml(String(v))}</strong></div>`).join("")}
    </div>
    ${changes.length?`<div class="audit-change-list">${changes.join("")}</div>`:""}
    <pre class="audit-json">${escapeHtml(JSON.stringify(d,null,2))}</pre>
  `;

  $("auditDetailModal").classList.remove("hidden");
  $("auditDetailModal").setAttribute("aria-hidden","false");
}

function closeAuditDetail(){
  $("auditDetailModal").classList.add("hidden");
  $("auditDetailModal").setAttribute("aria-hidden","true");
}

function exportAuditCsv(){
  const rows=getFilteredAuditRows();
  if(!rows.length){toast("Tidak ada audit trail untuk diekspor.");return}

  const header=["Waktu","Pengguna","Lembaga","Aksi","Target","Tabel","Record ID","Keterangan"];
  const body=rows.map(r=>[
    auditLocalDateTime(r.created_at),
    auditProfileName(r.user_id),
    auditInstitutionName(r.institution_id),
    auditActionLabel(r.action),
    auditTargetTitle(r),
    r.table_name||"",
    r.record_id||"",
    auditDescription(r)
  ]);

  const csv="\uFEFF"+[header,...body].map(x=>x.map(csvCell).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`Audit_SIMKEU_${$("auditDateFrom").value}_${$("auditDateTo").value}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Audit Trail berhasil diekspor.");
}


/* =========================================================
   ANGGARAN & REALISASI v6.5
   ========================================================= */

function fillYearOptions(selectId,spanBack=3,spanForward=2){
  const select=$(selectId);
  const now=new Date().getFullYear();
  if(select.options.length) return;
  const years=[];
  for(let y=now-spanBack;y<=now+spanForward;y++) years.push(y);
  select.innerHTML=years.reverse().map(y=>`<option value="${y}">${y}</option>`).join("");
  select.value=String(now);
}

async function loadBudgetModule(){
  try{
    fillYearOptions("budgetYear");
    fillYearOptions("budgetFormYear");

    if(!budgetInstitutions.length || !budgetCategories.length){
      const [instRes,catRes]=await Promise.all([
        sb.from("institutions").select("id,name,code,institution_type,is_active").eq("is_active",true).order("name"),
        sb.from("expense_categories").select("id,name,code,is_active").eq("is_active",true).order("name")
      ]);
      if(instRes.error) throw instRes.error;
      if(catRes.error) throw catRes.error;
      budgetInstitutions=instRes.data||[];
      budgetCategories=catRes.data||[];
    }

    if(isCentralUser()){
      $("budgetInstitution").innerHTML=`<option value="ALL">Semua Lembaga</option>`+
        budgetInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
      $("budgetInstitution").disabled=false;
      $("budgetFormInstitution").innerHTML=`<option value="">Pilih lembaga</option>`+
        budgetInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
      $("newBudgetBtn").classList.remove("hidden");
      $("budgetFormCard").classList.remove("hidden");
      $("budgetHeroText").textContent="Tetapkan plafon dan pantau serapan anggaran seluruh lembaga.";
    }else{
      restrictInstitutionSelector("budgetInstitution",budgetInstitutions);
      $("newBudgetBtn").classList.add("hidden");
      $("budgetFormCard").classList.add("hidden");
      $("budgetHeroText").textContent=`Pantau anggaran dan realisasi ${institutionDisplayName()}.`;
    }

    $("budgetFormCategory").innerHTML=`<option value="">Pilih kategori</option>`+
      budgetCategories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

    await fetchBudgetRealization();
  }catch(err){
    console.error(err);
    toast("Gagal memuat Anggaran: "+(err.message||"error"));
  }
}

async function fetchBudgetRealization(){
  const year=Number($("budgetYear").value);
  const institution=$("budgetInstitution").value;

  let query=sb.from("v_budget_realization")
    .select("budget_id,fiscal_year,institution_id,institution_name,expense_category_id,category_name,budget_amount,realization_amount,remaining_amount,absorption_percent,note")
    .eq("fiscal_year",year)
    .order("institution_name")
    .order("category_name");

  if(institution && institution!=="ALL") query=query.eq("institution_id",institution);

  const {data,error}=await query;
  if(error) throw error;
  budgetRowsCache=data||[];
  renderBudgetRealization();
}

function budgetStatus(row){
  const budget=Number(row.budget_amount||0);
  const real=Number(row.realization_amount||0);
  const pct=budget>0?real/budget*100:(real>0?999:0);

  if(real>budget && budget>=0) return {label:"MELEBIHI",cls:"over",pct};
  if(pct>=80) return {label:"WASPADA",cls:"warning",pct};
  return {label:"AMAN",cls:"safe",pct};
}

function renderBudgetRealization(){
  const rows=budgetRowsCache;
  const totalBudget=rows.reduce((s,r)=>s+Number(r.budget_amount||0),0);
  const totalReal=rows.reduce((s,r)=>s+Number(r.realization_amount||0),0);
  const remaining=totalBudget-totalReal;
  const absorption=totalBudget>0?totalReal/totalBudget*100:0;

  $("budgetTotalAmount").textContent=rupiah(totalBudget);
  $("budgetRealizationAmount").textContent=rupiah(totalReal);
  $("budgetRemainingAmount").textContent=rupiah(remaining);
  $("budgetRemainingAmount").classList.toggle("budget-negative",remaining<0);
  $("budgetRemainingAmount").classList.toggle("budget-positive",remaining>=0);
  $("budgetAbsorptionPercent").textContent=(Math.round(absorption*10)/10).toLocaleString("id-ID")+"%";

  const overRows=rows.filter(r=>Number(r.realization_amount||0)>Number(r.budget_amount||0));
  if(overRows.length){
    $("budgetAlert").classList.remove("hidden");
    $("budgetAlert").textContent=`⚠ ${overRows.length} kategori telah melebihi anggaran. Periksa realisasi sebelum approval pengeluaran berikutnya.`;
  }else{
    $("budgetAlert").classList.add("hidden");
  }

  $("budgetTableBody").innerHTML=rows.length?rows.map(r=>{
    const status=budgetStatus(r);
    const remaining=Number(r.remaining_amount||0);
    const displayPct=Math.max(0,Math.min(status.pct,100));
    return `<tr>
      <td>${escapeHtml(r.institution_name||"-")}</td>
      <td><strong>${escapeHtml(r.category_name||"-")}</strong></td>
      <td>${rupiah(r.budget_amount)}</td>
      <td><strong>${rupiah(r.realization_amount)}</strong></td>
      <td class="${remaining<0?'budget-negative':'budget-positive'}">${rupiah(remaining)}</td>
      <td>
        <div class="budget-progress-wrap">
          <div class="budget-progress-label">
            <span>${status.pct>=999?">999":(Math.round(status.pct*10)/10).toLocaleString("id-ID")}%</span>
            <span>${rupiah(r.realization_amount)}</span>
          </div>
          <div class="budget-progress ${status.cls}"><i style="width:${displayPct}%"></i></div>
        </div>
      </td>
      <td><span class="budget-status ${status.cls}">${status.label}</span></td>
    </tr>`;
  }).join(""):`<tr><td colspan="7" class="empty">Belum ada anggaran pada filter ini.</td></tr>`;
}

async function saveBudget(){
  if(!isCentralUser()) throw new Error("Hanya akun Yayasan yang dapat menetapkan anggaran.");

  const fiscal_year=Number($("budgetFormYear").value);
  const institution_id=$("budgetFormInstitution").value;
  const expense_category_id=$("budgetFormCategory").value;
  const budget_amount=Number($("budgetFormAmount").value);
  const note=($("budgetFormNote").value||"").trim();

  if(!fiscal_year||!institution_id||!expense_category_id||budget_amount<0){
    throw new Error("Lengkapi tahun, lembaga, kategori, dan nilai anggaran.");
  }

  const {error}=await sb.from("budgets").upsert({
    fiscal_year,
    institution_id,
    expense_category_id,
    budget_amount,
    note:note||null,
    created_by:currentSession.user.id,
    updated_by:currentSession.user.id
  },{
    onConflict:"fiscal_year,institution_id,expense_category_id"
  });
  if(error) throw error;

  $("budgetForm").reset();
  $("budgetFormYear").value=String(new Date().getFullYear());
  $("budgetFormAmountPreview").textContent="Rp0";
  $("budgetYear").value=String(fiscal_year);
  $("budgetInstitution").value=institution_id;
  await fetchBudgetRealization();
  toast("Anggaran berhasil disimpan.");
}


/* =========================================================
   TUTUP BUKU BULANAN v6.5
   ========================================================= */

const MONTH_NAMES=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

async function loadClosingModule(){
  if(!isCentralUser()){
    toast("Tutup Buku hanya tersedia untuk akun Yayasan.");
    await switchView("dashboard");
    return;
  }

  try{
    fillYearOptions("closingYear");

    if(!closingInstitutions.length){
      const {data,error}=await sb.from("institutions")
        .select("id,name,code,institution_type,is_active")
        .eq("is_active",true)
        .order("name");
      if(error) throw error;
      closingInstitutions=data||[];
      $("closingInstitution").innerHTML=`<option value="">Pilih lembaga</option>`+
        closingInstitutions.map(i=>`<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");
    }

    if($("closingInstitution").value){
      await fetchClosingData();
    }else{
      $("closingMonthsGrid").innerHTML=`<div class="empty">Pilih lembaga untuk melihat periode.</div>`;
    }
  }catch(err){
    console.error(err);
    toast("Gagal memuat Tutup Buku: "+(err.message||"error"));
  }
}

async function fetchClosingData(){
  const year=Number($("closingYear").value);
  const institutionId=$("closingInstitution").value;
  if(!institutionId){
    $("closingMonthsGrid").innerHTML=`<div class="empty">Pilih lembaga untuk melihat periode.</div>`;
    return;
  }

  const start=`${year}-01-01`;
  const next=`${year+1}-01-01`;

  const [closeRes,pendingRes]=await Promise.all([
    sb.from("period_closures")
      .select("id,institution_id,fiscal_year,period_month,closed_by,closed_at,note,status")
      .eq("institution_id",institutionId)
      .eq("fiscal_year",year)
      .eq("status","CLOSED")
      .order("period_month"),
    sb.from("transactions")
      .select("id,transaction_date,status,institution_id,source_account_id,destination_account_id,source_account:source_account_id(institution_id),destination_account:destination_account_id(institution_id)")
      .gte("transaction_date",start)
      .lt("transaction_date",next)
      .in("status",["DRAFT","SUBMITTED"])
  ]);

  if(closeRes.error) throw closeRes.error;
  if(pendingRes.error) throw pendingRes.error;

  closingRowsCache=closeRes.data||[];
  closingPendingRows=(pendingRes.data||[]).filter(r=>
    r.institution_id===institutionId ||
    r.source_account?.institution_id===institutionId ||
    r.destination_account?.institution_id===institutionId
  );

  renderClosingMonths();
}

function renderClosingMonths(){
  const year=Number($("closingYear").value);
  const closedMap=new Map(closingRowsCache.map(r=>[Number(r.period_month),r]));
  const pendingByMonth=Array(12).fill(0);
  closingPendingRows.forEach(r=>{
    const month=new Date(r.transaction_date+"T00:00:00").getMonth();
    pendingByMonth[month]++;
  });

  const closedCount=closingRowsCache.length;
  $("closedMonthsCount").textContent=closedCount;
  $("openMonthsCount").textContent=12-closedCount;
  $("closingPendingCount").textContent=closingPendingRows.length;

  const last=closingRowsCache.slice().sort((a,b)=>Number(b.period_month)-Number(a.period_month))[0];
  $("lastClosedPeriod").textContent=last?`${MONTH_NAMES[Number(last.period_month)-1]} ${year}`:"—";

  $("closingMonthsGrid").innerHTML=MONTH_NAMES.map((name,index)=>{
    const month=index+1;
    const closure=closedMap.get(month);
    const pending=pendingByMonth[index];
    const isClosed=!!closure;

    return `<article class="closing-month-card ${isClosed?'closed':''}">
      <div class="closing-month-head">
        <div>
          <h3>${name}</h3>
          <small>${name} ${year}</small>
        </div>
        <span class="period-chip ${isClosed?'closed':'open'}">${isClosed?'CLOSED':'OPEN'}</span>
      </div>

      <div class="closing-month-stats">
        <div><span>Pending</span><strong>${pending}</strong></div>
        <div><span>Status</span><strong>${isClosed?'Final':'Aktif'}</strong></div>
      </div>

      <div class="closing-month-actions">
        ${isClosed
          ? `<button class="reopen-period-btn" data-closing-action="reopen" data-month="${month}" type="button">Buka Kembali</button>`
          : `<button class="close-period-btn" data-closing-action="close" data-month="${month}" type="button" ${pending>0?'disabled':''}>Tutup Bulan</button>`
        }
      </div>

      ${isClosed
        ? `<div class="closed-meta">Ditutup ${auditLocalDateTime(closure.closed_at)}${closure.note?` • ${escapeHtml(closure.note)}`:""}</div>`
        : pending>0
          ? `<div class="closed-meta" style="color:#A35B16">Selesaikan ${pending} transaksi pending sebelum ditutup.</div>`
          : `<div class="closed-meta">Tidak ada transaksi pending.</div>`
      }
    </article>`;
  }).join("");
}

async function closePeriod(month){
  const year=Number($("closingYear").value);
  const institutionId=$("closingInstitution").value;
  const inst=closingInstitutions.find(i=>i.id===institutionId);
  if(!institutionId) throw new Error("Pilih lembaga.");

  const note=prompt(`Catatan Tutup Buku ${MONTH_NAMES[month-1]} ${year} — ${inst?.name||"Lembaga"} (opsional):`,"");
  if(note===null) return;

  if(!confirm(`Tutup periode ${MONTH_NAMES[month-1]} ${year} untuk ${inst?.name||"lembaga"}?\n\nSetelah ditutup, transaksi pada bulan ini akan dikunci.`)) return;

  const {error}=await sb.rpc("close_financial_period",{
    p_institution_id:institutionId,
    p_fiscal_year:year,
    p_period_month:month,
    p_note:note.trim()||null
  });
  if(error) throw error;

  await fetchClosingData();
  toast(`Periode ${MONTH_NAMES[month-1]} ${year} berhasil ditutup.`);
}

async function reopenPeriod(month){
  const year=Number($("closingYear").value);
  const institutionId=$("closingInstitution").value;
  const inst=closingInstitutions.find(i=>i.id===institutionId);

  const reason=prompt(`Alasan membuka kembali ${MONTH_NAMES[month-1]} ${year}:`);
  if(reason===null) return;
  if(!reason.trim()) throw new Error("Alasan membuka kembali periode wajib diisi.");

  if(!confirm(`Buka kembali periode ${MONTH_NAMES[month-1]} ${year} untuk ${inst?.name||"lembaga"}?`)) return;

  const {error}=await sb.rpc("reopen_financial_period",{
    p_institution_id:institutionId,
    p_fiscal_year:year,
    p_period_month:month,
    p_note:reason.trim()
  });
  if(error) throw error;

  await fetchClosingData();
  toast(`Periode ${MONTH_NAMES[month-1]} ${year} dibuka kembali.`);
}


/* =========================================================
   DASHBOARD EKSEKUTIF YAYASAN v6.6
   ========================================================= */

function executiveMonthLabel(monthIndex){
  return ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][monthIndex]||"-";
}

function daysOld(createdAt){
  if(!createdAt) return 0;
  return Math.max(0,Math.floor((Date.now()-new Date(createdAt).getTime())/86400000));
}

async function loadExecutiveDashboard(){
  if(!isCentralUser()){
    toast("Dashboard Eksekutif hanya tersedia untuk akun Yayasan.");
    await switchView("dashboard");
    return;
  }

  try{
    fillYearOptions("executiveYear",4,1);
    await fetchExecutiveData();
  }catch(err){
    console.error(err);
    toast("Gagal memuat Dashboard Eksekutif: "+(err.message||"error"));
  }
}

async function fetchExecutiveData(){
  const year=Number($("executiveYear").value);
  const start=`${year}-01-01`;
  const next=`${year+1}-01-01`;

  const [
    instRes,
    balancesRes,
    trxRes,
    budgetRes,
    closingRes
  ]=await Promise.all([
    sb.from("institutions")
      .select("id,name,code,institution_type,is_active")
      .eq("is_active",true)
      .order("name"),

    sb.from("v_account_balances")
      .select("account_id,institution_id,institution_name,account_name,current_balance"),

    sb.from("transactions")
      .select(`
        id,transaction_number,transaction_date,transaction_type,institution_id,
        amount,status,created_at,expense_category_id,
        institutions:institution_id(name),
        expense_categories:expense_category_id(name)
      `)
      .gte("transaction_date",start)
      .lt("transaction_date",next)
      .order("created_at",{ascending:false})
      .limit(5000),

    sb.from("v_budget_realization")
      .select("budget_id,fiscal_year,institution_id,institution_name,expense_category_id,category_name,budget_amount,realization_amount,remaining_amount,absorption_percent")
      .eq("fiscal_year",year),

    sb.from("period_closures")
      .select("institution_id,fiscal_year,period_month,status,closed_at")
      .eq("fiscal_year",year)
      .eq("status","CLOSED")
  ]);

  [instRes,balancesRes,trxRes,budgetRes,closingRes].forEach(r=>{if(r.error)throw r.error});

  executiveInstitutions=instRes.data||[];
  executiveDataCache={
    year,
    balances:balancesRes.data||[],
    transactions:trxRes.data||[],
    budgets:budgetRes.data||[],
    closures:closingRes.data||[]
  };

  renderExecutiveDashboard();
}

function buildExecutiveInstitutionStats(){
  const {transactions,balances,budgets}=executiveDataCache;
  const result=new Map();

  executiveInstitutions.forEach(i=>{
    result.set(i.id,{
      id:i.id,
      name:i.name,
      code:i.code,
      type:i.institution_type,
      balance:0,
      income:0,
      expense:0,
      pending:0,
      budget:0,
      realization:0
    });
  });

  balances.forEach(b=>{
    const x=result.get(b.institution_id);
    if(x)x.balance+=Number(b.current_balance||0);
  });

  transactions.forEach(t=>{
    const x=result.get(t.institution_id);
    if(!x)return;
    if(t.status==="APPROVED" && t.transaction_type==="INCOME") x.income+=Number(t.amount||0);
    if(t.status==="APPROVED" && t.transaction_type==="EXPENSE") x.expense+=Number(t.amount||0);
    if(t.status==="SUBMITTED") x.pending++;
  });

  budgets.forEach(b=>{
    const x=result.get(b.institution_id);
    if(!x)return;
    x.budget+=Number(b.budget_amount||0);
    x.realization+=Number(b.realization_amount||0);
  });

  return [...result.values()];
}

function executiveHealth(inst){
  const absorption=inst.budget>0 ? inst.realization/inst.budget*100 : 0;
  const net=inst.income-inst.expense;

  if(inst.balance<0 || absorption>100 || inst.pending>=5){
    return {label:"PERLU PERHATIAN",cls:"critical"};
  }
  if(absorption>=80 || inst.pending>0 || net<0){
    return {label:"WASPADA",cls:"warning"};
  }
  return {label:"SEHAT",cls:"healthy"};
}

function renderExecutiveDashboard(){
  if(!executiveDataCache)return;
  const {year,transactions,balances,budgets,closures}=executiveDataCache;
  const stats=buildExecutiveInstitutionStats();

  const totalBalance=balances.reduce((s,x)=>s+Number(x.current_balance||0),0);
  const approved=transactions.filter(t=>t.status==="APPROVED");
  const totalIncome=approved.filter(t=>t.transaction_type==="INCOME").reduce((s,t)=>s+Number(t.amount||0),0);
  const totalExpense=approved.filter(t=>t.transaction_type==="EXPENSE").reduce((s,t)=>s+Number(t.amount||0),0);
  const pending=transactions.filter(t=>t.status==="SUBMITTED");

  const budgetTotal=budgets.reduce((s,b)=>s+Number(b.budget_amount||0),0);
  const realizationTotal=budgets.reduce((s,b)=>s+Number(b.realization_amount||0),0);
  const budgetPct=budgetTotal>0?realizationTotal/budgetTotal*100:0;

  $("execTotalBalance").textContent=rupiah(totalBalance);
  $("execNetCashflow").textContent=rupiah(totalIncome-totalExpense);
  $("execNetCashflow").classList.toggle("budget-negative",totalIncome-totalExpense<0);
  $("execNetCashflowMeta").textContent=`Pemasukan ${rupiah(totalIncome)} • Pengeluaran ${rupiah(totalExpense)}`;
  $("execPendingCount").textContent=pending.length;
  $("execPendingMeta").textContent=pending.length?`${pending.filter(t=>daysOld(t.created_at)>=3).length} transaksi berusia ≥3 hari`:"Tidak ada antrean approval";
  $("execBudgetAbsorption").textContent=(Math.round(budgetPct*10)/10).toLocaleString("id-ID")+"%";
  $("execBudgetMeta").textContent=budgetTotal>0?`${rupiah(realizationTotal)} dari ${rupiah(budgetTotal)}`:"Anggaran belum ditetapkan";

  renderExecutiveInstitutionCards(stats);
  renderExecutiveBalanceChart(stats);
  renderExecutiveFlowChart(stats,year);
  renderExecutiveClosing(stats,closures,year);
  renderExecutiveBudgetAlerts(budgets);
  renderExecutivePending(pending);
  renderExecutiveFocus(stats,budgets,pending,closures,year);
  renderExecutivePriority(stats,budgets,pending,closures,year);
}

function renderExecutiveInstitutionCards(stats){
  $("executiveInstitutionCards").innerHTML=stats.length?stats.map(i=>{
    const h=executiveHealth(i);
    const pct=i.budget>0?i.realization/i.budget*100:null;
    return `<article class="executive-inst-card ${h.cls}">
      <div class="executive-inst-head">
        <div>
          <h4>${escapeHtml(i.name)}</h4>
          <small>${escapeHtml(i.type||"LEMBAGA")}</small>
        </div>
        <span class="health-chip ${h.cls}">${h.label}</span>
      </div>
      <div class="executive-inst-balance">
        <span>Saldo Saat Ini</span>
        <strong>${rupiah(i.balance)}</strong>
      </div>
      <div class="executive-inst-metrics">
        <div><span>Arus Bersih</span><strong>${rupiah(i.income-i.expense)}</strong></div>
        <div><span>Serapan</span><strong>${pct===null?"Belum ada":(Math.round(pct*10)/10).toLocaleString("id-ID")+"%"}</strong></div>
        <div><span>Pending</span><strong>${i.pending}</strong></div>
      </div>
    </article>`;
  }).join(""):`<div class="empty">Belum ada data lembaga.</div>`;
}

function renderExecutiveBalanceChart(stats){
  if(executiveBalanceChart)executiveBalanceChart.destroy();
  executiveBalanceChart=new Chart($("executiveBalanceChart"),{
    type:"bar",
    data:{
      labels:stats.map(x=>x.name),
      datasets:[{
        label:"Saldo",
        data:stats.map(x=>x.balance),
        backgroundColor:"#F89921",
        borderRadius:6
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>rupiah(c.raw)}}},
      scales:{
        x:{grid:{display:false}},
        y:{beginAtZero:true,ticks:{callback:v=>shortMoney(v)},grid:{color:"#F0ECE7"}}
      }
    }
  });
}

function renderExecutiveFlowChart(stats,year){
  $("execFlowSubtitle").textContent=`Pemasukan dan pengeluaran APPROVED tahun ${year}`;

  if(executiveFlowChart)executiveFlowChart.destroy();
  executiveFlowChart=new Chart($("executiveFlowChart"),{
    type:"bar",
    data:{
      labels:stats.map(x=>x.name),
      datasets:[
        {label:"Pemasukan",data:stats.map(x=>x.income),backgroundColor:"#F89921",borderRadius:5},
        {label:"Pengeluaran",data:stats.map(x=>x.expense),backgroundColor:"#4A4038",borderRadius:5}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:"top",align:"end"},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${rupiah(c.raw)}`}}},
      scales:{
        x:{grid:{display:false}},
        y:{beginAtZero:true,ticks:{callback:v=>shortMoney(v)},grid:{color:"#F0ECE7"}}
      }
    }
  });
}

function previousMonthForExecutive(year){
  const now=new Date();
  if(year===now.getFullYear()){
    let month=now.getMonth(); // 0 means January; previous month = December prior year.
    if(month===0) return {year:year-1,month:12};
    return {year,month};
  }
  return {year,month:12};
}

function renderExecutiveClosing(stats,closures,year){
  const target=previousMonthForExecutive(year);
  $("execClosingSubtitle").textContent=`Status ${MONTH_NAMES[target.month-1]} ${target.year}`;

  // If the selected year's previous period crosses into prior year, we don't have that closure in cache.
  if(target.year!==year){
    $("executiveClosingList").innerHTML=`<div class="empty">Pilih tahun ${target.year} untuk melihat status Desember.</div>`;
    return;
  }

  const closedSet=new Set(
    closures
      .filter(c=>Number(c.period_month)===target.month)
      .map(c=>c.institution_id)
  );

  $("executiveClosingList").innerHTML=stats.length?stats.map(i=>`
    <div class="executive-close-row">
      <strong>${escapeHtml(i.name)}</strong>
      <span class="${closedSet.has(i.id)?"closed":"open"}">${closedSet.has(i.id)?"CLOSED":"OPEN"}</span>
    </div>
  `).join(""):`<div class="empty">Belum ada data.</div>`;
}

function renderExecutiveBudgetAlerts(budgets){
  const rows=budgets
    .map(b=>{
      const budget=Number(b.budget_amount||0), real=Number(b.realization_amount||0);
      const pct=budget>0?real/budget*100:(real>0?999:0);
      return {...b,_pct:pct};
    })
    .filter(b=>b._pct>=80)
    .sort((a,b)=>b._pct-a._pct)
    .slice(0,7);

  $("executiveBudgetAlerts").innerHTML=rows.length?rows.map(b=>{
    const over=b._pct>100;
    return `<div class="executive-alert-row ${over?"over":""}">
      <div class="top">
        <strong>${escapeHtml(b.institution_name)} • ${escapeHtml(b.category_name)}</strong>
        <span>${b._pct>=999?">999":(Math.round(b._pct*10)/10).toLocaleString("id-ID")}%</span>
      </div>
      <small>${rupiah(b.realization_amount)} dari ${rupiah(b.budget_amount)}</small>
      <div class="executive-alert-progress"><i style="width:${Math.min(100,b._pct)}%"></i></div>
    </div>`;
  }).join(""):`<div class="empty">Tidak ada anggaran kritis. ✓</div>`;
}

function renderExecutivePending(pending){
  const rows=pending.slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(0,8);

  $("executivePendingBody").innerHTML=rows.length?rows.map(t=>{
    const age=daysOld(t.created_at);
    return `<tr>
      <td><span class="pending-age ${age>=3?"old":""}">${age===0?"Hari ini":age+" hari"}</span></td>
      <td><strong>${escapeHtml(t.transaction_number||"-")}</strong></td>
      <td>${escapeHtml(t.institutions?.name||"-")}</td>
      <td><span class="pill ${typeClass(t.transaction_type)}">${typeLabel(t.transaction_type)}</span></td>
      <td><strong>${rupiah(t.amount)}</strong></td>
      <td>${formatDate(t.transaction_date)}</td>
    </tr>`;
  }).join(""):`<tr><td colspan="6" class="empty">Tidak ada transaksi menunggu persetujuan. ✓</td></tr>`;
}

function renderExecutiveFocus(stats,budgets,pending,closures,year){
  const focuses=[];

  const oldPending=pending.filter(t=>daysOld(t.created_at)>=3);
  if(oldPending.length){
    focuses.push({
      icon:"!",
      title:`${oldPending.length} approval tertunda ≥3 hari`,
      text:"Prioritaskan pemeriksaan bukti dan keputusan approve/reject."
    });
  }

  const overBudget=budgets.filter(b=>Number(b.realization_amount||0)>Number(b.budget_amount||0));
  if(overBudget.length){
    focuses.push({
      icon:"%",
      title:`${overBudget.length} kategori melebihi anggaran`,
      text:"Tinjau penyebab realisasi berlebih sebelum pengeluaran selanjutnya."
    });
  }

  const negative=stats.filter(i=>i.balance<0);
  if(negative.length){
    focuses.push({
      icon:"Rp",
      title:`${negative.length} lembaga memiliki saldo negatif`,
      text:negative.map(x=>x.name).join(", ")
    });
  }

  const target=previousMonthForExecutive(year);
  if(target.year===year){
    const closedSet=new Set(closures.filter(c=>Number(c.period_month)===target.month).map(c=>c.institution_id));
    const notClosed=stats.filter(i=>!closedSet.has(i.id));
    if(notClosed.length){
      focuses.push({
        icon:"🔒",
        title:`${notClosed.length} lembaga belum tutup buku ${MONTH_NAMES[target.month-1]}`,
        text:notClosed.map(x=>x.name).join(", ")
      });
    }
  }

  if(!focuses.length){
    focuses.push({
      icon:"✓",
      title:"Tidak ada prioritas kritis",
      text:"Indikator utama pada tahun dan periode ini berada dalam kondisi terkendali."
    });
  }

  $("executiveFocusList").innerHTML=focuses.slice(0,5).map(f=>`
    <div class="executive-focus-row">
      <div class="executive-focus-icon">${f.icon}</div>
      <div class="executive-focus-text">
        <strong>${escapeHtml(f.title)}</strong>
        <small>${escapeHtml(f.text)}</small>
      </div>
    </div>
  `).join("");
}

function renderExecutivePriority(stats,budgets,pending,closures,year){
  const issues=[];
  const old=pending.filter(t=>daysOld(t.created_at)>=3).length;
  const over=budgets.filter(b=>Number(b.realization_amount||0)>Number(b.budget_amount||0)).length;
  const critical=stats.filter(i=>executiveHealth(i).cls==="critical").length;

  if(old)issues.push(`${old} approval tertunda ≥3 hari`);
  if(over)issues.push(`${over} kategori over-budget`);
  if(critical)issues.push(`${critical} lembaga berstatus perlu perhatian`);

  if(issues.length){
    $("executivePriorityAlert").classList.remove("hidden");
    $("executivePriorityAlert").textContent=`Prioritas pimpinan: ${issues.join(" • ")}.`;
  }else{
    $("executivePriorityAlert").classList.add("hidden");
  }
}

/* =========================================================
   AUTH + NAV
   ========================================================= */

$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("loginError").classList.add("hidden");
  $("loginButton").disabled=true; $("loginButton").textContent="Memproses...";
  const {data,error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  $("loginButton").disabled=false; $("loginButton").textContent="Masuk";
  if(error){$("loginError").textContent=error.message;$("loginError").classList.remove("hidden");return}
  if(data.session)await enterApp(data.session);
});

$("togglePassword").addEventListener("click",()=>{
  const p=$("password");p.type=p.type==="password"?"text":"password";
  $("togglePassword").textContent=p.type==="password"?"Lihat":"Sembunyi";
});

$("logoutBtn").addEventListener("click",async()=>{
  await sb.auth.signOut();
  currentProfile=null; currentSession=null;
  $("appView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  $("loginForm").reset();
});

$("refreshBtn").addEventListener("click",async()=>{
  const incomeVisible=!$("incomeSection").classList.contains("hidden");
  const expenseVisible=!$("expenseSection").classList.contains("hidden");
  const transferVisible=!$("transferSection").classList.contains("hidden");
  const evidenceVisible=!$("evidenceSection").classList.contains("hidden");
  const assetsVisible=!$("assetsSection").classList.contains("hidden");
  const reportVisible=!$("reportSection").classList.contains("hidden");
  const lpjVisible=!$("lpjSection").classList.contains("hidden");
  const analyticsVisible=!$("analyticsSection").classList.contains("hidden");
  const auditVisible=!$("auditSection").classList.contains("hidden");
  const budgetVisible=!$("budgetSection").classList.contains("hidden");
  const closingVisible=!$("closingSection").classList.contains("hidden");
  const executiveVisible=!$("executiveSection").classList.contains("hidden");

  if(incomeVisible) await Promise.all([loadDashboard(),loadIncomeTransactions()]);
  else if(expenseVisible) await Promise.all([loadDashboard(),loadExpenseTransactions()]);
  else if(transferVisible) await Promise.all([loadDashboard(),loadTransferModule()]);
  else if(evidenceVisible) await Promise.all([loadDashboard(),fetchEvidenceTransactions()]);
  else if(assetsVisible) await Promise.all([loadDashboard(),fetchAssets()]);
  else if(reportVisible) await Promise.all([loadDashboard(),fetchReportTransactions()]);
  else if(lpjVisible) await Promise.all([loadDashboard(),fetchLPJData()]);
  else if(analyticsVisible) await Promise.all([loadDashboard(),fetchAnalyticsData()]);
  else if(auditVisible) await Promise.all([loadDashboard(),fetchAuditLogs()]);
  else if(budgetVisible) await Promise.all([loadDashboard(),fetchBudgetRealization()]);
  else if(closingVisible) await Promise.all([loadDashboard(),fetchClosingData()]);
  else if(executiveVisible) await Promise.all([loadDashboard(),fetchExecutiveData()]);
  else await loadDashboard();

  toast("Data diperbarui.");
});

const meta={
  dashboard:["Dashboard","SIMKEU Yayasan Ar-Raudlah Kapedi"],
  pemasukan:["Pemasukan","Catatan seluruh dana masuk"],
  pengeluaran:["Pengeluaran","Catatan dan approval pengeluaran"],
  transfer:["Transfer Internal","Perpindahan dana antar lembaga"],
  bukti:["Bukti Transaksi","Dokumentasi nota, kuitansi, dan invoice"],
  aset:["Aset & Inventaris","Barang milik Yayasan dan lembaga"],
  lembaga:["Lembaga","Kelola unit di bawah Yayasan"],
  laporan:["Laporan","Rekap keuangan dan ekspor"],
  lpj:["LPJ Bulanan","Pertanggungjawaban keuangan per bulan dan lembaga"],
  analitik:["Analitik","Diagram, tren, dan persentase"],
  pengguna:["Pengguna","Kelola akun dan hak akses"],
  audit:["Audit Trail","Riwayat aktivitas dan perubahan sistem"],
  anggaran:["Anggaran","Anggaran, realisasi, dan serapan"],
  tutupbuku:["Tutup Buku","Finalisasi dan penguncian periode bulanan"],
  eksekutif:["Dashboard Eksekutif","Ringkasan kondisi keuangan seluruh lembaga"]
};

async function switchView(v){
  // Halaman pusat tidak boleh dibuka dari akun lembaga meskipun dipanggil manual.
  if(!isCentralUser() && ["lembaga","pengguna","audit","tutupbuku","eksekutif"].includes(v)){
    toast("Menu ini hanya tersedia untuk akun Yayasan.");
    v="dashboard";
  }

  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===v));

  if(v==="transfer" && !isCentralUser()){
    $("pageTitle").textContent="Transfer Masuk/Keluar";
    $("pageSubtitle").textContent="Riwayat perpindahan dana yang berkaitan dengan lembaga";
  }else if(v==="dashboard" && !isCentralUser()){
    $("pageTitle").textContent="Dashboard";
    $("pageSubtitle").textContent=`SIMKEU ${institutionDisplayName()} Ar-Raudlah Kapedi`;
  }else{
    $("pageTitle").textContent=meta[v][0];
    $("pageSubtitle").textContent=meta[v][1];
  }

  $("dashboardSection").classList.toggle("hidden",v!=="dashboard");
  $("incomeSection").classList.toggle("hidden",v!=="pemasukan");
  $("expenseSection").classList.toggle("hidden",v!=="pengeluaran");
  $("transferSection").classList.toggle("hidden",v!=="transfer");
  $("evidenceSection").classList.toggle("hidden",v!=="bukti");
  $("assetsSection").classList.toggle("hidden",v!=="aset");
  $("reportSection").classList.toggle("hidden",v!=="laporan");
  $("lpjSection").classList.toggle("hidden",v!=="lpj");
  $("analyticsSection").classList.toggle("hidden",v!=="analitik");
  $("institutionsSection").classList.toggle("hidden",v!=="lembaga");
  $("usersSection").classList.toggle("hidden",v!=="pengguna");
  $("auditSection").classList.toggle("hidden",v!=="audit");
  $("budgetSection").classList.toggle("hidden",v!=="anggaran");
  $("closingSection").classList.toggle("hidden",v!=="tutupbuku");
  $("executiveSection").classList.toggle("hidden",v!=="eksekutif");
  $("placeholderSection").classList.toggle(
    "hidden",
    ["dashboard","pemasukan","pengeluaran","transfer","bukti","aset","laporan","lpj","analitik","lembaga","pengguna","audit","anggaran","tutupbuku","eksekutif"].includes(v)
  );

  if(v==="pemasukan"){
    await loadIncomeModule();
  }else if(v==="pengeluaran"){
    await loadExpenseModule();
  }else if(v==="transfer"){
    await loadTransferModule();
  }else if(v==="bukti"){
    await loadEvidenceModule();
  }else if(v==="aset"){
    await loadAssetsModule();
  }else if(v==="laporan"){
    await loadReportModule();
  }else if(v==="lpj"){
    await loadLPJModule();
  }else if(v==="analitik"){
    await loadAnalyticsModule();
  }else if(v==="lembaga"){
    await loadInstitutionsModule();
  }else if(v==="pengguna"){
    await loadUsersModule();
  }else if(v==="audit"){
    await loadAuditModule();
  }else if(v==="anggaran"){
    await loadBudgetModule();
  }else if(v==="tutupbuku"){
    await loadClosingModule();
  }else if(v==="eksekutif"){
    await loadExecutiveDashboard();
  }else if(v!=="dashboard"){
    $("placeholderTitle").textContent=meta[v][0];
  }

  closeSidebar();
}

document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$("backDashboard").addEventListener("click",()=>switchView("dashboard"));

function openSidebar(){$("sidebar").classList.add("open");$("backdrop").classList.remove("hidden")}
function closeSidebar(){$("sidebar").classList.remove("open");$("backdrop").classList.add("hidden")}
$("menuBtn").addEventListener("click",openSidebar);
$("closeSidebar").addEventListener("click",closeSidebar);
$("backdrop").addEventListener("click",closeSidebar);


/* Asset events */
["assetCategoryFilter","assetConditionFilter","assetStatusFilter"].forEach(id=>$(id).addEventListener("change",renderAssets));
$("assetInstitutionFilter").addEventListener("change",async()=>{try{await fetchAssets()}catch(e){toast("Gagal memuat aset: "+e.message)}});
$("assetSearch").addEventListener("input",renderAssets);
$("newAssetBtn").addEventListener("click",()=>{resetAssetForm();$("assetFormCard").scrollIntoView({behavior:"smooth",block:"start"})});
$("cancelAssetEditBtn").addEventListener("click",resetAssetForm);
$("assetInstitution").addEventListener("change",refreshAssetExpenseOptions);
$("assetAcquisitionSource").addEventListener("change",toggleAssetSource);
$("assetExpenseTransaction").addEventListener("change",applyAssetExpense);
$("assetAcquisitionValue").addEventListener("input",()=>{$("assetValuePreview").textContent=rupiah(Number($("assetAcquisitionValue").value||0))});
$("assetForm").addEventListener("submit",async e=>{e.preventDefault();$("saveAssetBtn").disabled=true;try{await saveAsset()}catch(x){console.error(x);toast("Gagal menyimpan aset: "+x.message)}finally{$("saveAssetBtn").disabled=false}});
$("assetTableBody").addEventListener("change",e=>{
  const c=e.target.closest("[data-asset-select]");
  if(!c)return;
  if(c.checked)selectedAssetIds.add(c.dataset.assetSelect);
  else selectedAssetIds.delete(c.dataset.assetSelect);
  updateAssetSelectionUI();
});

$("assetTableBody").addEventListener("click",async e=>{
  const b=e.target.closest("[data-aa]");
  if(!b)return;
  try{
    if(b.dataset.aa==="label")openAssetLabelModal([b.dataset.id]);
    if(b.dataset.aa==="detail")await showAssetDetail(b.dataset.id);
    if(b.dataset.aa==="edit")editAsset(b.dataset.id);
    if(b.dataset.aa==="move")openMovement(b.dataset.id);
  }catch(x){toast("Aksi aset gagal: "+x.message)}
});
$("closeAssetDetailBtn").addEventListener("click",()=>$("assetDetailModal").classList.add("hidden"));
document.querySelector("[data-close-asset-detail]").addEventListener("click",()=>$("assetDetailModal").classList.add("hidden"));
$("closeAssetMovementBtn").addEventListener("click",()=>$("assetMovementModal").classList.add("hidden"));
document.querySelector("[data-close-asset-movement]").addEventListener("click",()=>$("assetMovementModal").classList.add("hidden"));
$("assetMovementForm").addEventListener("submit",async e=>{e.preventDefault();try{await saveMovement()}catch(x){toast("Gagal menyimpan mutasi: "+x.message)}});
$("selectFilteredAssetsBtn").addEventListener("click",selectAllFilteredAssets);
$("clearSelectedAssetsBtn").addEventListener("click",clearSelectedAssets);
$("printAssetLabelsBtn").addEventListener("click",()=>openAssetLabelModal());
$("closeAssetLabelBtn").addEventListener("click",closeAssetLabelModal);
document.querySelector("[data-close-asset-label]").addEventListener("click",closeAssetLabelModal);
["assetLabelSize","assetLabelShowLocation","assetLabelShowInstitution"].forEach(id=>$(id).addEventListener("change",refreshAssetLabelPreview));
$("confirmPrintAssetLabelsBtn").addEventListener("click",printSelectedAssetLabels);
$("exportAssetsBtn").addEventListener("click",exportAssetsCsv);

/* Income events */
$("cancelIncomeEditBtn").addEventListener("click",resetIncomeForm);
$("incomeInstitution").addEventListener("change",refreshIncomeAccountOptions);
$("incomeStorageType").addEventListener("change",refreshIncomeAccountOptions);
$("incomeAmount").addEventListener("input",()=>{
  $("incomeAmountPreview").textContent=rupiah(Number($("incomeAmount").value||0));
});
$("incomeSearch").addEventListener("input",renderIncomeRows);
$("incomeStatusFilter").addEventListener("change",renderIncomeRows);
$("incomeStorageFilter").addEventListener("change",renderIncomeRows);
$("refreshIncomeBtn").addEventListener("click",async()=>{
  await loadIncomeTransactions(); toast("Riwayat pemasukan diperbarui.");
});
$("newIncomeBtn").addEventListener("click",()=>{
  resetIncomeForm();
  $("incomeFormCard").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("incomeDate").focus(),300);
});

$("saveIncomeDraftBtn").addEventListener("click",()=>{pendingIncomeSaveAction="draft"});
$("saveIncomeSubmitBtn").addEventListener("click",()=>{pendingIncomeSaveAction="submit"});

$("incomeForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const buttons=[$("saveIncomeDraftBtn"),$("saveIncomeSubmitBtn")];
  buttons.forEach(b=>b.disabled=true);
  try{
    await saveIncome(pendingIncomeSaveAction);
  }catch(err){
    console.error(err);
    toast("Gagal menyimpan pemasukan: "+(err.message||"error"));
  }finally{
    buttons.forEach(b=>b.disabled=false);
  }
});

$("incomeTransactionsBody").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-income-action]");
  if(!btn)return;
  btn.disabled=true;
  try{
    const id=btn.dataset.id;
    const action=btn.dataset.incomeAction;
    if(action==="edit") startEditIncome(id);
    if(action==="submit") await submitExistingIncome(id);
    if(action==="delete") await deleteDraftTransaction(id,"INCOME");
    if(action==="withdraw") await withdrawSubmittedTransaction(id,"INCOME");
    if(action==="reopen") await reopenRejectedTransaction(id,"INCOME");
    if(action==="approve") await approveIncome(id);
    if(action==="reject") await rejectIncome(id);
    if(action==="void") await voidApprovedTransaction(id,"INCOME");
  }catch(err){
    console.error(err);
    toast("Aksi gagal: "+(err.message||"error"));
  }finally{
    btn.disabled=false;
  }
});









/* Executive Dashboard events */
$("executiveYear").addEventListener("change",async()=>{
  try{
    await fetchExecutiveData();
  }catch(err){
    console.error(err);
    toast("Gagal memperbarui Dashboard Eksekutif: "+(err.message||"error"));
  }
});

$("refreshExecutiveBtn").addEventListener("click",async()=>{
  try{
    await fetchExecutiveData();
    toast("Dashboard Eksekutif diperbarui.");
  }catch(err){
    console.error(err);
    toast("Gagal memperbarui Dashboard Eksekutif: "+(err.message||"error"));
  }
});

document.querySelectorAll("[data-exec-nav]").forEach(btn=>{
  btn.addEventListener("click",()=>switchView(btn.dataset.execNav));
});

/* Budget events */
$("budgetYear").addEventListener("change",async()=>{
  try{await fetchBudgetRealization()}catch(err){console.error(err);toast("Gagal memuat anggaran: "+(err.message||"error"))}
});
$("budgetInstitution").addEventListener("change",async()=>{
  try{await fetchBudgetRealization()}catch(err){console.error(err);toast("Gagal memuat anggaran: "+(err.message||"error"))}
});
$("refreshBudgetBtn").addEventListener("click",async()=>{
  try{await fetchBudgetRealization();toast("Anggaran diperbarui.")}catch(err){console.error(err);toast("Gagal memperbarui anggaran: "+(err.message||"error"))}
});
$("newBudgetBtn").addEventListener("click",()=>{
  $("budgetFormCard").scrollIntoView({behavior:"smooth",block:"start"});
});
$("budgetFormAmount").addEventListener("input",()=>{
  $("budgetFormAmountPreview").textContent=rupiah(Number($("budgetFormAmount").value||0));
});
$("budgetForm").addEventListener("submit",async e=>{
  e.preventDefault();
  $("saveBudgetBtn").disabled=true;
  try{await saveBudget()}catch(err){console.error(err);toast("Gagal menyimpan anggaran: "+(err.message||"error"))}
  finally{$("saveBudgetBtn").disabled=false}
});

/* Closing events */
$("closingYear").addEventListener("change",async()=>{
  try{await fetchClosingData()}catch(err){console.error(err);toast("Gagal memuat periode: "+(err.message||"error"))}
});
$("closingInstitution").addEventListener("change",async()=>{
  try{await fetchClosingData()}catch(err){console.error(err);toast("Gagal memuat periode: "+(err.message||"error"))}
});
$("refreshClosingBtn").addEventListener("click",async()=>{
  try{await fetchClosingData();toast("Status Tutup Buku diperbarui.")}catch(err){console.error(err);toast("Gagal memperbarui periode: "+(err.message||"error"))}
});
$("closingMonthsGrid").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-closing-action]");
  if(!btn)return;
  btn.disabled=true;
  try{
    const month=Number(btn.dataset.month);
    if(btn.dataset.closingAction==="close") await closePeriod(month);
    if(btn.dataset.closingAction==="reopen") await reopenPeriod(month);
  }catch(err){
    console.error(err);toast("Aksi Tutup Buku gagal: "+(err.message||"error"));
  }finally{
    btn.disabled=false;
  }
});

/* Audit Trail events */
["auditInstitution","auditActor","auditAction"].forEach(id=>{
  $(id).addEventListener("change",renderAuditTrail);
});
$("auditSearch").addEventListener("input",renderAuditTrail);

$("auditDateFrom").addEventListener("change",async()=>{
  try{await fetchAuditLogs()}catch(err){console.error(err);toast("Gagal memuat Audit Trail: "+(err.message||"error"))}
});
$("auditDateTo").addEventListener("change",async()=>{
  try{await fetchAuditLogs()}catch(err){console.error(err);toast("Gagal memuat Audit Trail: "+(err.message||"error"))}
});

$("refreshAuditBtn").addEventListener("click",async()=>{
  try{
    await fetchAuditLogs();
    toast("Audit Trail diperbarui.");
  }catch(err){
    console.error(err);toast("Gagal memperbarui Audit Trail: "+(err.message||"error"));
  }
});

$("exportAuditCsvBtn").addEventListener("click",exportAuditCsv);

$("auditTimeline").addEventListener("click",e=>{
  const btn=e.target.closest("[data-audit-detail]");
  if(btn) showAuditDetail(btn.dataset.auditDetail);
});

$("closeAuditModal").addEventListener("click",closeAuditDetail);
$("closeAuditModalBtn").addEventListener("click",closeAuditDetail);
document.querySelector(".audit-modal-backdrop").addEventListener("click",closeAuditDetail);

/* Evidence center events */
["evidenceInstitution","evidenceStatus","evidenceProofStatus"].forEach(id=>{
  $(id).addEventListener("change",renderEvidenceGallery);
});
$("evidenceSearch").addEventListener("input",renderEvidenceGallery);

$("evidenceDateFrom").addEventListener("change",async()=>{
  try{await fetchEvidenceTransactions()}catch(err){console.error(err);toast("Gagal memuat bukti: "+(err.message||"error"))}
});
$("evidenceDateTo").addEventListener("change",async()=>{
  try{await fetchEvidenceTransactions()}catch(err){console.error(err);toast("Gagal memuat bukti: "+(err.message||"error"))}
});

$("refreshEvidenceBtn").addEventListener("click",async()=>{
  try{
    await fetchEvidenceTransactions();
    toast("Bukti transaksi diperbarui.");
  }catch(err){
    console.error(err);toast("Gagal memperbarui bukti: "+(err.message||"error"));
  }
});

$("evidenceGallery").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-evidence-action]");
  if(!btn) return;
  btn.disabled=true;
  try{
    const id=btn.dataset.id;
    const action=btn.dataset.evidenceAction;
    if(action==="preview") await previewEvidence(id);
    if(action==="approve") await approveFromEvidence(id);
    if(action==="reject") await rejectFromEvidence(id);
  }catch(err){
    console.error(err);
    toast("Aksi gagal: "+(err.message||"error"));
  }finally{
    btn.disabled=false;
  }
});

$("closeEvidenceModal").addEventListener("click",closeEvidencePreview);
$("closeEvidenceModalBtn").addEventListener("click",closeEvidencePreview);
document.querySelector(".evidence-modal-backdrop").addEventListener("click",closeEvidencePreview);
$("openEvidenceExternalBtn").addEventListener("click",()=>{
  if(currentEvidenceExternalUrl) window.open(currentEvidenceExternalUrl,"_blank","noopener,noreferrer");
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && !$("evidencePreviewModal").classList.contains("hidden")){
    closeEvidencePreview();
  }
});

/* Institution + User events */
$("refreshUsersBtn").addEventListener("click",async()=>{
  await loadUsersModule();
  toast("Daftar pengguna diperbarui.");
});

$("newUserProfileBtn").addEventListener("click",()=>{
  resetUserProfileForm();
  $("userProfileFormCard").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("profileUserId").focus(),300);
});

$("cancelUserEditBtn").addEventListener("click",resetUserProfileForm);

$("usersTableBody").addEventListener("click",e=>{
  const btn=e.target.closest("[data-user-action]");
  if(!btn) return;

  try{
    if(btn.dataset.userAction==="edit"){
      startEditUserProfile(btn.dataset.id);
    }
  }catch(err){
    console.error(err);
    toast("Aksi pengguna gagal: "+(err.message||"error"));
  }
});

$("userProfileForm").addEventListener("submit",async e=>{
  e.preventDefault();
  $("saveUserProfileBtn").disabled=true;
  try{
    await saveUserProfile();
  }catch(err){
    console.error(err);
    toast("Gagal menyimpan pengguna: "+(err.message||"error"));
  }finally{
    $("saveUserProfileBtn").disabled=false;
  }
});

/* Report events */
$("applyReportFilterBtn").addEventListener("click",async()=>{
  try{
    await fetchReportTransactions();
    toast("Filter laporan diterapkan.");
  }catch(err){
    console.error(err);toast("Gagal menerapkan filter: "+(err.message||"error"));
  }
});
$("reportInstitution").addEventListener("change",renderReportRows);
$("reportType").addEventListener("change",renderReportRows);
$("reportStatus").addEventListener("change",renderReportRows);
$("exportReportCsvBtn").addEventListener("click",exportReportCsv);
$("printReportBtn").addEventListener("click",printReport);

/* LPJ events */
$("lpjMonth").addEventListener("change",async()=>{
  try{await fetchLPJData()}catch(err){console.error(err);toast("Gagal memuat LPJ: "+(err.message||"error"))}
});
$("lpjYear").addEventListener("change",async()=>{
  try{await fetchLPJData()}catch(err){console.error(err);toast("Gagal memuat LPJ: "+(err.message||"error"))}
});
$("lpjInstitution").addEventListener("change",async()=>{
  loadLPJSignatures();
  try{await fetchLPJData()}catch(err){console.error(err);toast("Gagal memuat LPJ: "+(err.message||"error"))}
});
$("refreshLPJBtn").addEventListener("click",async()=>{
  try{
    await fetchLPJData();
    toast("LPJ berhasil diperbarui.");
  }catch(err){
    console.error(err);
    toast("Gagal memperbarui LPJ: "+(err.message||"error"));
  }
});
$("printLPJBtn").addEventListener("click",printLPJ);
$("saveLPJSignaturesBtn").addEventListener("click",saveLPJSignatures);

/* Analytics events */
$("analyticsYear").addEventListener("change",async()=>{
  try{await fetchAnalyticsData()}catch(err){console.error(err);toast("Gagal memuat analitik: "+(err.message||"error"))}
});
$("analyticsInstitution").addEventListener("change",renderAnalytics);
$("refreshAnalyticsBtn").addEventListener("click",async()=>{
  try{
    await fetchAnalyticsData();
    toast("Analitik diperbarui.");
  }catch(err){
    console.error(err);toast("Gagal memperbarui analitik: "+(err.message||"error"));
  }
});

/* Transfer events */
$("cancelTransferEditBtn").addEventListener("click",resetTransferForm);
$("transferSourceInstitution").addEventListener("change",refreshTransferSourceAccounts);
$("transferDestinationInstitution").addEventListener("change",refreshTransferDestinationAccounts);
$("transferSourceAccount").addEventListener("change",()=>{
  updateTransferBalanceHint();
  refreshTransferDestinationAccounts();
});
$("transferDestinationAccount").addEventListener("change",validateDifferentTransferAccounts);
$("transferAmount").addEventListener("input",()=>{
  $("transferAmountPreview").textContent=rupiah(Number($("transferAmount").value||0));
  updateTransferBalanceHint();
});
$("transferSearch").addEventListener("input",renderTransferRows);
$("transferStatusFilter").addEventListener("change",renderTransferRows);
$("refreshTransferBtn").addEventListener("click",async()=>{
  await loadTransferModule(); toast("Riwayat transfer diperbarui.");
});
$("newTransferBtn").addEventListener("click",()=>{
  resetTransferForm();
  $("transferFormCard").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("transferDate").focus(),300);
});
$("saveTransferDraftBtn").addEventListener("click",()=>{pendingTransferSaveAction="draft"});
$("saveTransferSubmitBtn").addEventListener("click",()=>{pendingTransferSaveAction="submit"});

$("transferForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const buttons=[$("saveTransferDraftBtn"),$("saveTransferSubmitBtn")];
  buttons.forEach(b=>b.disabled=true);
  try{
    await saveTransfer(pendingTransferSaveAction);
  }catch(err){
    console.error(err);
    toast("Gagal menyimpan transfer: "+(err.message||"error"));
  }finally{
    buttons.forEach(b=>b.disabled=false);
  }
});

$("transferTransactionsBody").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-transfer-action]");
  if(!btn)return;
  btn.disabled=true;
  try{
    const id=btn.dataset.id;
    const action=btn.dataset.transferAction;
    if(action==="edit") startEditTransfer(id);
    if(action==="submit") await submitExistingTransfer(id);
    if(action==="delete") await deleteDraftTransaction(id,"TRANSFER");
    if(action==="withdraw") await withdrawSubmittedTransaction(id,"TRANSFER");
    if(action==="reopen") await reopenRejectedTransaction(id,"TRANSFER");
    if(action==="approve") await approveTransfer(id);
    if(action==="reject") await rejectTransfer(id);
    if(action==="void") await voidApprovedTransaction(id,"TRANSFER");
  }catch(err){
    console.error(err);
    toast("Aksi transfer gagal: "+(err.message||"error"));
  }finally{
    btn.disabled=false;
  }
});

/* Expense events */
$("cancelExpenseEditBtn").addEventListener("click",resetExpenseForm);
$("expenseInstitution").addEventListener("change",refreshExpenseAccountOptions);
$("expenseAmount").addEventListener("input",()=>{
  $("expenseAmountPreview").textContent=rupiah(Number($("expenseAmount").value||0));
});
$("expenseProof").addEventListener("change",()=>{
  const f=$("expenseProof").files?.[0];
  $("expenseProofName").textContent=f ? `${f.name} • ${(f.size/1024/1024).toFixed(2)} MB` : "Belum ada file dipilih";
});
$("expenseSearch").addEventListener("input",renderExpenseRows);
$("expenseStatusFilter").addEventListener("change",renderExpenseRows);
$("refreshExpenseBtn").addEventListener("click",async()=>{
  await loadExpenseTransactions(); toast("Riwayat pengeluaran diperbarui.");
});
$("newExpenseBtn").addEventListener("click",()=>{
  resetExpenseForm();
  $("expenseFormCard").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("expenseDate").focus(),300);
});

$("saveExpenseDraftBtn").addEventListener("click",()=>{pendingExpenseSaveAction="draft"});
$("saveExpenseSubmitBtn").addEventListener("click",()=>{pendingExpenseSaveAction="submit"});

$("expenseForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const buttons=[$("saveExpenseDraftBtn"),$("saveExpenseSubmitBtn")];
  buttons.forEach(b=>b.disabled=true);
  try{
    await saveExpense(pendingExpenseSaveAction);
  }catch(err){
    console.error(err);
    toast("Gagal menyimpan pengeluaran: "+(err.message||"error"));
  }finally{
    buttons.forEach(b=>b.disabled=false);
  }
});

$("expenseTransactionsBody").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-expense-action]");
  if(!btn)return;
  btn.disabled=true;
  try{
    const id=btn.dataset.id;
    const action=btn.dataset.expenseAction;
    if(action==="edit") startEditExpense(id);
    if(action==="submit") await submitExistingExpense(id);
    if(action==="delete"){
      const row=expenseRowsCache.find(x=>x.id===id);
      const paths=(row?.transaction_attachments||[]).map(x=>x.file_path).filter(Boolean);
      await deleteDraftTransaction(id,"EXPENSE",paths);
    }
    if(action==="withdraw") await withdrawSubmittedTransaction(id,"EXPENSE");
    if(action==="reopen") await reopenRejectedTransaction(id,"EXPENSE");
    if(action==="approve") await approveExpense(id);
    if(action==="reject") await rejectExpense(id);
    if(action==="proof") await viewExpenseProof(id);
    if(action==="void") await voidApprovedTransaction(id,"EXPENSE");
  }catch(err){
    console.error(err);
    toast("Aksi gagal: "+(err.message||"error"));
  }finally{
    btn.disabled=false;
  }
});

(async()=>{
  const {data:{session}}=await sb.auth.getSession();
  if(session)await enterApp(session);
})();
