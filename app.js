
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

let expenseInstitutions = [];
let expenseAccounts = [];
let expenseCategories = [];
let expenseRowsCache = [];
let pendingExpenseSaveAction = "draft";

let transferInstitutions = [];
let transferAccounts = [];
let transferBalances = [];
let transferRowsCache = [];
let pendingTransferSaveAction = "draft";

let reportInstitutions = [];
let reportRowsCache = [];

let analyticsInstitutions = [];
let analyticsRowsCache = [];
let analyticsCashflowChart = null;
let analyticsExpenseChart = null;
let analyticsIncomeSourceChart = null;
let analyticsInstitutionChart = null;

let masterInstitutions = [];
let usersRowsCache = [];

let evidenceInstitutions = [];
let evidenceRowsCache = [];
let currentEvidenceExternalUrl = null;
let evidenceThumbGeneration = 0;

let auditInstitutions = [];
let auditProfiles = [];
let auditRowsCache = [];

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
function typeClass(t){return {INCOME:"income",EXPENSE:"expense",TRANSFER:"transfer"}[t]||""}
function statusClass(s){
  return {APPROVED:"approved",SUBMITTED:"submitted",DRAFT:"draft",REJECTED:"rejected",VOID:"draft"}[s]||"draft"
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
    const [balances,monthly,pending,recent,yearly]=await Promise.all([
      sb.from("v_account_balances").select("account_id,institution_id,institution_name,account_name,current_balance"),
      sb.from("transactions").select("id,transaction_type,amount,expense_category_id,status,transaction_date,expense_categories:expense_category_id(name)")
        .eq("status","APPROVED").gte("transaction_date",r.start).lt("transaction_date",r.next),
      sb.from("transactions").select("id",{count:"exact",head:true}).eq("status","SUBMITTED"),
      sb.from("transactions").select("id,transaction_number,transaction_date,transaction_type,amount,status,institutions:institution_id(name)")
        .order("transaction_date",{ascending:false}).order("created_at",{ascending:false}).limit(8),
      sb.from("transactions").select("transaction_date,transaction_type,amount,status").eq("status","APPROVED")
        .gte("transaction_date",`${y}-01-01`).lt("transaction_date",`${y+1}-01-01`)
    ]);
    [balances,monthly,pending,recent,yearly].forEach(x=>{if(x.error)throw x.error});
    const b=balances.data||[], m=monthly.data||[];
    $("totalBalance").textContent=rupiah(b.reduce((s,x)=>s+Number(x.current_balance||0),0));
    $("monthlyIncome").textContent=rupiah(m.filter(x=>x.transaction_type==="INCOME").reduce((s,x)=>s+Number(x.amount||0),0));
    $("monthlyExpense").textContent=rupiah(m.filter(x=>x.transaction_type==="EXPENSE").reduce((s,x)=>s+Number(x.amount||0),0));
    $("pendingCount").textContent=pending.count||0;
    renderInstitutions(b);
    renderRecent(recent.data||[]);
    renderCashflow(yearly.data||[]);
    renderExpense(m);
  }catch(err){
    console.error(err);
    toast("Gagal memuat dashboard: "+(err.message||"error"));
  }finally{$("refreshBtn").disabled=false}
}

function renderInstitutions(rows){
  const map=new Map();
  rows.forEach(r=>{
    const n=r.institution_name||"Lembaga";
    if(!map.has(n))map.set(n,{total:0,count:0});
    map.get(n).total+=Number(r.current_balance||0);
    map.get(n).count++;
  });
  $("institutionBalances").innerHTML=map.size?[...map.entries()].map(([n,v])=>`
    <div class="institution-row">
      <div class="institution-name">
        <div class="badge">${escapeHtml(n.slice(0,3).toUpperCase())}</div>
        <div><strong>${escapeHtml(n)}</strong><span>${v.count} akun kas/bank</span></div>
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
  const accountSelect=$("incomeDestinationAccount");
  const rows=incomeAccounts.filter(a=>a.institution_id===institutionId);

  accountSelect.innerHTML=`<option value="">Pilih akun kas/bank</option>`+
    rows.map(a=>`<option value="${a.id}">${escapeHtml(a.account_name)}${a.bank_name&&a.bank_name!=="Belum Diisi" ? " — "+escapeHtml(a.bank_name) : ""}</option>`).join("");

  accountSelect.disabled=!institutionId || !rows.length;
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
  const approvedMonth=incomeRowsCache
    .filter(x=>x.status==="APPROVED" && x.transaction_date>=r.start && x.transaction_date<r.next)
    .reduce((s,x)=>s+Number(x.amount||0),0);

  $("incomeModuleApproved").textContent=rupiah(approvedMonth);
  $("incomeDraftCount").textContent=incomeRowsCache.filter(x=>x.status==="DRAFT").length;
  $("incomeSubmittedCount").textContent=incomeRowsCache.filter(x=>x.status==="SUBMITTED").length;
}

function renderIncomeRows(){
  const term=($("incomeSearch").value||"").trim().toLowerCase();
  const status=$("incomeStatusFilter").value;

  const rows=incomeRowsCache.filter(x=>{
    const hay=[
      x.transaction_number,
      x.description,
      x.institutions?.name,
      x.fund_sources?.name,
      x.accounts?.account_name
    ].filter(Boolean).join(" ").toLowerCase();
    return (!term || hay.includes(term)) && (status==="ALL" || x.status===status);
  });

  $("incomeTransactionsBody").innerHTML=rows.length?rows.map(row=>{
    const actions=[];
    if(row.status==="DRAFT"){
      actions.push(`<button class="table-action primary" data-income-action="submit" data-id="${row.id}">Ajukan</button>`);
    }
    if(row.status==="SUBMITTED" && isCentralUser()){
      actions.push(`<button class="table-action approve" data-income-action="approve" data-id="${row.id}">Setujui</button>`);
      actions.push(`<button class="table-action reject" data-income-action="reject" data-id="${row.id}">Tolak</button>`);
    }

    return `
      <tr>
        <td>${formatDate(row.transaction_date)}</td>
        <td><strong>${escapeHtml(row.transaction_number||"-")}</strong><span class="account-sub description-cell" title="${escapeHtml(row.description||"")}">${escapeHtml(row.description||"")}</span></td>
        <td>${escapeHtml(row.institutions?.name||"-")}</td>
        <td>${escapeHtml(row.fund_sources?.name||"-")}</td>
        <td>${escapeHtml(row.accounts?.account_name||"-")}</td>
        <td><strong>${rupiah(row.amount)}</strong></td>
        <td><span class="pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td><div class="action-group">${actions.join("") || `<span class="account-sub">—</span>`}</div></td>
      </tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">Belum ada data pemasukan sesuai filter.</td></tr>`;
}

function resetIncomeForm(){
  $("incomeForm").reset();
  $("incomeDate").value=todayISO();
  $("incomeAmountPreview").textContent="Rp0";
  if(!isCentralUser() && currentProfile?.institution_id){
    $("incomeInstitution").value=currentProfile.institution_id;
    $("incomeInstitution").disabled=true;
    refreshIncomeAccountOptions();
  }else{
    $("incomeInstitution").disabled=false;
    $("incomeDestinationAccount").innerHTML=`<option value="">Pilih akun kas/bank</option>`;
    $("incomeDestinationAccount").disabled=true;
  }
}

async function saveIncome(action){
  if(!currentSession?.user?.id) throw new Error("Sesi login tidak ditemukan.");

  const institution_id=$("incomeInstitution").value;
  const fund_source_id=$("incomeFundSource").value;
  const destination_account_id=$("incomeDestinationAccount").value;
  const transaction_date=$("incomeDate").value;
  const amount=Number($("incomeAmount").value);
  const description=($("incomeDescription").value||"").trim();

  if(!transaction_date||!institution_id||!fund_source_id||!destination_account_id||!amount||amount<=0){
    throw new Error("Lengkapi tanggal, lembaga, sumber dana, akun tujuan, dan nominal.");
  }

  const selectedAccount=incomeAccounts.find(a=>a.id===destination_account_id);
  if(!selectedAccount || selectedAccount.institution_id!==institution_id){
    throw new Error("Akun tujuan tidak sesuai dengan lembaga yang dipilih.");
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
    if(row.status==="DRAFT"){
      actions.push(`<button class="table-action primary" data-expense-action="submit" data-id="${row.id}">Ajukan</button>`);
    }
    if(row.status==="SUBMITTED" && isCentralUser()){
      actions.push(`<button class="table-action approve" data-expense-action="approve" data-id="${row.id}">Setujui</button>`);
      actions.push(`<button class="table-action reject" data-expense-action="reject" data-id="${row.id}">Tolak</button>`);
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

function resetExpenseForm(){
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
      actions.push(`<button class="table-action primary" data-transfer-action="submit" data-id="${row.id}">Ajukan</button>`);
    }
    if(row.status==="SUBMITTED" && isCentralUser()){
      actions.push(`<button class="table-action approve" data-transfer-action="approve" data-id="${row.id}">Setujui</button>`);
      actions.push(`<button class="table-action reject" data-transfer-action="reject" data-id="${row.id}">Tolak</button>`);
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

function resetTransferForm(){
  $("transferForm").reset();
  $("transferDate").value=todayISO();
  $("transferAmountPreview").textContent="Rp0";
  fillTransferMasterOptions();
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
    ? usersRowsCache.map(u=>`
      <tr>
        <td><strong>${escapeHtml(u.full_name||'-')}</strong></td>
        <td><span class="role-chip">${escapeHtml(roleLabel(u.role))}</span></td>
        <td>${escapeHtml(u.institutions?.name||'-')}</td>
        <td>${escapeHtml(u.phone||'-')}</td>
        <td><span class="${u.is_active?'active-chip':'inactive-chip'}">${u.is_active?'AKTIF':'NONAKTIF'}</span></td>
        <td><div class="uid-cell" title="${escapeHtml(u.id)}">${escapeHtml(u.id)}</div></td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">Belum ada pengguna.</td></tr>`;
}

function resetUserProfileForm(){
  $("userProfileForm").reset();
}

async function saveUserProfile(){
  if(currentProfile?.role!=="SUPER_ADMIN"){
    throw new Error("Hanya Super Admin yang dapat menambah pengguna.");
  }

  const id=$("profileUserId").value.trim();
  const full_name=$("profileFullName").value.trim();
  const role=$("profileRole").value;
  const institution_id=$("profileInstitution").value;
  const phone=$("profilePhone").value.trim();

  const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!uuidPattern.test(id)) throw new Error("UID tidak valid. Copy UID lengkap dari Supabase Authentication.");
  if(!full_name||!role||!institution_id) throw new Error("Nama, role, dan lembaga wajib diisi.");
  if(role==="SUPER_ADMIN") throw new Error("Penambahan SUPER_ADMIN kedua tidak diizinkan dari form ini.");

  const payload={
    id,
    full_name,
    role,
    institution_id,
    phone:phone||null,
    is_active:true
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
  ["navInstitutions","navUsers","navAudit"].forEach(id=>{
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
  TRANSACTION_VOIDED:"Transaksi dibatalkan",
  TRANSACTION_DELETED:"Transaksi dihapus",
  PROOF_UPLOADED:"Bukti diunggah",
  PROOF_DELETED:"Bukti dihapus",
  USER_PROFILE_CREATED:"Profil pengguna dibuat",
  USER_PROFILE_UPDATED:"Profil pengguna diubah",
  ACCOUNT_CREATED:"Akun keuangan dibuat",
  ACCOUNT_UPDATED:"Akun keuangan diubah",
  APPROVAL_RECORDED:"Approval dicatat"
};

function auditActionLabel(action){
  return AUDIT_ACTION_LABELS[action]||String(action||"Aktivitas").replaceAll("_"," ");
}

function auditCategory(action){
  const a=String(action||"");
  if(a.startsWith("PROOF_")) return "PROOF";
  if(a.startsWith("USER_")) return "USER";
  if(a.startsWith("ACCOUNT_")) return "ACCOUNT";
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
    return `${d.transaction_number||"Transaksi"} dibatalkan/VOID.`;
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
    ["ACCOUNT","Akun Keuangan"]
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
    ["rejection_note","Alasan penolakan"]
  ];

  readableKeys.forEach(([key,label])=>{
    if(d[key]!==undefined && d[key]!==null && d[key]!==""){
      let val=d[key];
      if(key==="amount") val=rupiah(Number(val||0));
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
  const reportVisible=!$("reportSection").classList.contains("hidden");
  const analyticsVisible=!$("analyticsSection").classList.contains("hidden");
  const auditVisible=!$("auditSection").classList.contains("hidden");

  if(incomeVisible) await Promise.all([loadDashboard(),loadIncomeTransactions()]);
  else if(expenseVisible) await Promise.all([loadDashboard(),loadExpenseTransactions()]);
  else if(transferVisible) await Promise.all([loadDashboard(),loadTransferModule()]);
  else if(evidenceVisible) await Promise.all([loadDashboard(),fetchEvidenceTransactions()]);
  else if(reportVisible) await Promise.all([loadDashboard(),fetchReportTransactions()]);
  else if(analyticsVisible) await Promise.all([loadDashboard(),fetchAnalyticsData()]);
  else if(auditVisible) await Promise.all([loadDashboard(),fetchAuditLogs()]);
  else await loadDashboard();

  toast("Data diperbarui.");
});

const meta={
  dashboard:["Dashboard","SIMKEU Yayasan Ar-Raudlah Kapedi"],
  pemasukan:["Pemasukan","Catatan seluruh dana masuk"],
  pengeluaran:["Pengeluaran","Catatan dan approval pengeluaran"],
  transfer:["Transfer Internal","Perpindahan dana antar lembaga"],
  bukti:["Bukti Transaksi","Dokumentasi nota, kuitansi, dan invoice"],
  lembaga:["Lembaga","Kelola unit di bawah Yayasan"],
  laporan:["Laporan","Rekap keuangan dan ekspor"],
  analitik:["Analitik","Diagram, tren, dan persentase"],
  pengguna:["Pengguna","Kelola akun dan hak akses"],
  audit:["Audit Trail","Riwayat aktivitas dan perubahan sistem"]
};

async function switchView(v){
  // Halaman pusat tidak boleh dibuka dari akun lembaga meskipun dipanggil manual.
  if(!isCentralUser() && ["lembaga","pengguna","audit"].includes(v)){
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
  $("reportSection").classList.toggle("hidden",v!=="laporan");
  $("analyticsSection").classList.toggle("hidden",v!=="analitik");
  $("institutionsSection").classList.toggle("hidden",v!=="lembaga");
  $("usersSection").classList.toggle("hidden",v!=="pengguna");
  $("auditSection").classList.toggle("hidden",v!=="audit");
  $("placeholderSection").classList.toggle(
    "hidden",
    ["dashboard","pemasukan","pengeluaran","transfer","bukti","laporan","analitik","lembaga","pengguna","audit"].includes(v)
  );

  if(v==="pemasukan"){
    await loadIncomeModule();
  }else if(v==="pengeluaran"){
    await loadExpenseModule();
  }else if(v==="transfer"){
    await loadTransferModule();
  }else if(v==="bukti"){
    await loadEvidenceModule();
  }else if(v==="laporan"){
    await loadReportModule();
  }else if(v==="analitik"){
    await loadAnalyticsModule();
  }else if(v==="lembaga"){
    await loadInstitutionsModule();
  }else if(v==="pengguna"){
    await loadUsersModule();
  }else if(v==="audit"){
    await loadAuditModule();
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

/* Income events */
$("incomeInstitution").addEventListener("change",refreshIncomeAccountOptions);
$("incomeAmount").addEventListener("input",()=>{
  $("incomeAmountPreview").textContent=rupiah(Number($("incomeAmount").value||0));
});
$("incomeSearch").addEventListener("input",renderIncomeRows);
$("incomeStatusFilter").addEventListener("change",renderIncomeRows);
$("refreshIncomeBtn").addEventListener("click",async()=>{
  await loadIncomeTransactions(); toast("Riwayat pemasukan diperbarui.");
});
$("newIncomeBtn").addEventListener("click",()=>{
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
    if(action==="submit") await submitExistingIncome(id);
    if(action==="approve") await approveIncome(id);
    if(action==="reject") await rejectIncome(id);
  }catch(err){
    console.error(err);
    toast("Aksi gagal: "+(err.message||"error"));
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
  $("userProfileFormCard").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("profileUserId").focus(),300);
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
    if(action==="submit") await submitExistingTransfer(id);
    if(action==="approve") await approveTransfer(id);
    if(action==="reject") await rejectTransfer(id);
  }catch(err){
    console.error(err);
    toast("Aksi transfer gagal: "+(err.message||"error"));
  }finally{
    btn.disabled=false;
  }
});

/* Expense events */
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
    if(action==="submit") await submitExistingExpense(id);
    if(action==="approve") await approveExpense(id);
    if(action==="reject") await rejectExpense(id);
    if(action==="proof") await viewExpenseProof(id);
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
